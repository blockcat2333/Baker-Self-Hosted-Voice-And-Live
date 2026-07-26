#include "DesktopVideoSource.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include "api/make_ref_counted.h"
#include "api/video/i420_buffer.h"
#include "api/video/video_frame.h"
#include "modules/desktop_capture/desktop_capture_options.h"
#include "rtc_base/time_utils.h"
#include "third_party/libyuv/include/libyuv/convert.h"
#include "third_party/libyuv/include/libyuv/scale.h"

#include <chrono>

namespace baker::media {

webrtc::scoped_refptr<DesktopVideoSource> DesktopVideoSource::create(
    StreamSourceType sourceType, const QString& sourceId,
    const StreamQuality& quality) {
  webrtc::DesktopCaptureOptions options =
      webrtc::DesktopCaptureOptions::CreateDefault();
  options.set_allow_directx_capturer(true);
#if defined(RTC_ENABLE_WIN_WGC)
  options.set_allow_wgc_screen_capturer(true);
  options.set_allow_wgc_window_capturer(true);
  options.set_allow_wgc_capturer_fallback(true);
#endif

  std::unique_ptr<webrtc::DesktopCapturer> capturer =
      sourceType == StreamSourceType::Screen
          ? webrtc::DesktopCapturer::CreateScreenCapturer(options)
          : webrtc::DesktopCapturer::CreateWindowCapturer(options);
  if (!capturer) {
    return nullptr;
  }

  bool ok = false;
  const auto nativeId = static_cast<webrtc::DesktopCapturer::SourceId>(
      sourceId.toLongLong(&ok));
  if (!ok || !capturer->SelectSource(nativeId)) {
    return nullptr;
  }
  return webrtc::make_ref_counted<DesktopVideoSource>(
      std::move(capturer), nativeId, quality);
}

DesktopVideoSource::DesktopVideoSource(
    std::unique_ptr<webrtc::DesktopCapturer> capturer,
    webrtc::DesktopCapturer::SourceId sourceId, StreamQuality quality)
    : capturer_(std::move(capturer)),
      sourceId_(sourceId),
      quality_(std::move(quality)) {}

DesktopVideoSource::~DesktopVideoSource() { stop(); }

bool DesktopVideoSource::start() {
  if (!capturer_ || live_.exchange(true)) {
    return false;
  }
  capturer_->Start(this);
  worker_ = std::jthread(
      [this](std::stop_token token) { captureLoop(token); });
  return true;
}

void DesktopVideoSource::stop() {
  live_.store(false);
  if (worker_.joinable()) {
    worker_.request_stop();
    worker_.join();
  }
}

webrtc::MediaSourceInterface::SourceState DesktopVideoSource::state() const {
  return live_.load() ? kLive : kEnded;
}

void DesktopVideoSource::OnCaptureResult(
    webrtc::DesktopCapturer::Result result,
    std::unique_ptr<webrtc::DesktopFrame> frame) {
  if (result != webrtc::DesktopCapturer::Result::SUCCESS || !frame) {
    return;
  }

  const QSize target = outputSize(
      QSize(frame->size().width(), frame->size().height()));
  auto sourceBuffer = webrtc::I420Buffer::Create(frame->size().width(),
                                                 frame->size().height());
  libyuv::ARGBToI420(
      frame->data(), frame->stride(), sourceBuffer->MutableDataY(),
      sourceBuffer->StrideY(), sourceBuffer->MutableDataU(),
      sourceBuffer->StrideU(), sourceBuffer->MutableDataV(),
      sourceBuffer->StrideV(), frame->size().width(), frame->size().height());

  webrtc::scoped_refptr<webrtc::I420Buffer> output = sourceBuffer;
  if (target.width() != sourceBuffer->width() ||
      target.height() != sourceBuffer->height()) {
    output = webrtc::I420Buffer::Create(target.width(), target.height());
    output->ScaleFrom(*sourceBuffer);
  }

  OnFrame(webrtc::VideoFrame::Builder()
              .set_video_frame_buffer(output)
              .set_timestamp_us(webrtc::TimeMicros())
              .set_rotation(webrtc::kVideoRotation_0)
              .build());
}

void DesktopVideoSource::captureLoop(std::stop_token token) {
  const int frameRate = std::clamp(quality_.frameRate, 1, 60);
  const auto interval =
      std::chrono::microseconds(1'000'000 / frameRate);
  auto next = std::chrono::steady_clock::now();
  while (!token.stop_requested() && live_.load()) {
    capturer_->CaptureFrame();
    next += interval;
    std::this_thread::sleep_until(next);
  }
}

QSize DesktopVideoSource::outputSize(const QSize& source) const {
  QSize bound;
  if (quality_.resolution == QStringLiteral("480p")) {
    bound = QSize(854, 480);
  } else if (quality_.resolution == QStringLiteral("1080p")) {
    bound = QSize(1920, 1080);
  } else if (quality_.resolution == QStringLiteral("1440p")) {
    bound = QSize(2560, 1440);
  } else {
    bound = QSize(1280, 720);
  }
  QSize output = source;
  output.scale(bound, Qt::KeepAspectRatio);
  output.setWidth(std::max(2, output.width() & ~1));
  output.setHeight(std::max(2, output.height() & ~1));
  return output;
}

}  // namespace baker::media

#endif
