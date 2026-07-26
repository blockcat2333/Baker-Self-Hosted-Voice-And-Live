#include "QtVideoSink.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include "api/video/i420_buffer.h"
#include "third_party/libyuv/include/libyuv/convert_argb.h"

namespace baker::media {

QtVideoSink::QtVideoSink(Callback callback)
    : callback_(std::move(callback)) {}

void QtVideoSink::OnFrame(const webrtc::VideoFrame& frame) {
  const auto buffer = frame.video_frame_buffer()->ToI420();
  if (!buffer || !callback_) {
    return;
  }
  QImage image(buffer->width(), buffer->height(),
               QImage::Format_ARGB32);
  if (image.isNull()) {
    return;
  }
  libyuv::I420ToARGB(
      buffer->DataY(), buffer->StrideY(), buffer->DataU(),
      buffer->StrideU(), buffer->DataV(), buffer->StrideV(), image.bits(),
      image.bytesPerLine(), buffer->width(), buffer->height());
  callback_(std::move(image));
}

}  // namespace baker::media

#endif
