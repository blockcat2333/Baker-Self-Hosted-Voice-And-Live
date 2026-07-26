#pragma once

#ifdef BAKER_LITE_WITH_WEBRTC

#include "MediaTypes.hpp"
#include "WebRtcQtCompatibility.hpp"

#include "api/scoped_refptr.h"
#include "media/base/adapted_video_track_source.h"
#include "modules/desktop_capture/desktop_capturer.h"

#include <atomic>
#include <memory>
#include <thread>

namespace baker::media {

class DesktopVideoSource
    : public webrtc::AdaptedVideoTrackSource,
      private webrtc::DesktopCapturer::Callback {
 public:
  static webrtc::scoped_refptr<DesktopVideoSource> create(
      StreamSourceType sourceType, const QString& sourceId,
      const StreamQuality& quality);

  bool start();
  void stop();

  [[nodiscard]] SourceState state() const override;
  [[nodiscard]] bool remote() const override { return false; }
  [[nodiscard]] bool is_screencast() const override { return true; }
  [[nodiscard]] std::optional<bool> needs_denoising() const override {
    return false;
  }

 protected:
  ~DesktopVideoSource() override;
  DesktopVideoSource(std::unique_ptr<webrtc::DesktopCapturer> capturer,
                     webrtc::DesktopCapturer::SourceId sourceId,
                     StreamQuality quality);

 private:
  void OnCaptureResult(
      webrtc::DesktopCapturer::Result result,
      std::unique_ptr<webrtc::DesktopFrame> frame) override;
  void captureLoop(std::stop_token token);
  QSize outputSize(const QSize& source) const;

  std::unique_ptr<webrtc::DesktopCapturer> capturer_;
  webrtc::DesktopCapturer::SourceId sourceId_ = 0;
  StreamQuality quality_;
  std::atomic_bool live_ = false;
  std::jthread worker_;
};

}  // namespace baker::media

#endif
