#pragma once

#ifdef BAKER_LITE_WITH_WEBRTC

#include "WebRtcQtCompatibility.hpp"

#include "api/video/video_frame.h"
#include "api/video/video_sink_interface.h"

#include <QImage>

#include <functional>

namespace baker::media {

class QtVideoSink final
    : public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
 public:
  using Callback = std::function<void(QImage)>;

  explicit QtVideoSink(Callback callback);
  void OnFrame(const webrtc::VideoFrame& frame) override;

 private:
  Callback callback_;
};

}  // namespace baker::media

#endif
