#pragma once

#ifdef BAKER_LITE_WITH_WEBRTC

#include "MediaTypes.hpp"
#include "WebRtcQtCompatibility.hpp"

#include "api/scoped_refptr.h"
#include "api/video/video_sink_interface.h"
#include "media/base/adapted_video_track_source.h"
#include "modules/video_capture/video_capture.h"

namespace baker::media {

class CameraVideoSource
    : public webrtc::AdaptedVideoTrackSource,
      public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
 public:
  static webrtc::scoped_refptr<CameraVideoSource> create(
      const QString& deviceId, const StreamQuality& quality);

  bool start();
  void stop();

  [[nodiscard]] SourceState state() const override;
  [[nodiscard]] bool remote() const override { return false; }
  [[nodiscard]] bool is_screencast() const override { return false; }
  [[nodiscard]] std::optional<bool> needs_denoising() const override {
    return true;
  }

  void OnFrame(const webrtc::VideoFrame& frame) override;

 protected:
  ~CameraVideoSource() override;
  CameraVideoSource(
      webrtc::scoped_refptr<webrtc::VideoCaptureModule> captureModule,
      StreamQuality quality);

 private:
  webrtc::scoped_refptr<webrtc::VideoCaptureModule> captureModule_;
  StreamQuality quality_;
  bool live_ = false;
};

}  // namespace baker::media

#endif
