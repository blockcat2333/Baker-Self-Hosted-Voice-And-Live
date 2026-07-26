#include "CameraVideoSource.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include "api/make_ref_counted.h"
#include "modules/video_capture/video_capture_factory.h"

#include <algorithm>

namespace baker::media {
namespace {

QSize requestedSize(const QString& resolution) {
  if (resolution == QStringLiteral("480p")) {
    return QSize(854, 480);
  }
  if (resolution == QStringLiteral("1080p")) {
    return QSize(1920, 1080);
  }
  if (resolution == QStringLiteral("1440p")) {
    return QSize(2560, 1440);
  }
  return QSize(1280, 720);
}

}  // namespace

webrtc::scoped_refptr<CameraVideoSource> CameraVideoSource::create(
    const QString& deviceId, const StreamQuality& quality) {
  const QByteArray id = deviceId.toUtf8();
  auto capture = webrtc::VideoCaptureFactory::Create(id.constData());
  if (!capture) {
    return nullptr;
  }
  return webrtc::make_ref_counted<CameraVideoSource>(std::move(capture),
                                                      quality);
}

CameraVideoSource::CameraVideoSource(
    webrtc::scoped_refptr<webrtc::VideoCaptureModule> captureModule,
    StreamQuality quality)
    : captureModule_(std::move(captureModule)),
      quality_(std::move(quality)) {}

CameraVideoSource::~CameraVideoSource() { stop(); }

bool CameraVideoSource::start() {
  if (!captureModule_ || live_) {
    return false;
  }
  const QSize size = requestedSize(quality_.resolution);
  webrtc::VideoCaptureCapability capability;
  capability.width = size.width();
  capability.height = size.height();
  capability.maxFPS = std::clamp(quality_.frameRate, 1, 60);
  capability.videoType = webrtc::VideoType::kI420;
  captureModule_->RegisterCaptureDataCallback(this);
  if (captureModule_->StartCapture(capability) != 0) {
    captureModule_->DeRegisterCaptureDataCallback();
    return false;
  }
  live_ = true;
  return true;
}

void CameraVideoSource::stop() {
  if (!captureModule_ || !live_) {
    return;
  }
  live_ = false;
  captureModule_->StopCapture();
  captureModule_->DeRegisterCaptureDataCallback();
}

webrtc::MediaSourceInterface::SourceState CameraVideoSource::state() const {
  return live_ ? kLive : kEnded;
}

void CameraVideoSource::OnFrame(const webrtc::VideoFrame& frame) {
  webrtc::AdaptedVideoTrackSource::OnFrame(frame);
}

}  // namespace baker::media

#endif
