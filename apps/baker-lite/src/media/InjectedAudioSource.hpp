#pragma once

#ifdef BAKER_LITE_WITH_WEBRTC

#include "MediaTypes.hpp"
#include "WebRtcQtCompatibility.hpp"

#include "api/media_stream_interface.h"
#include "api/notifier.h"

#include <mutex>
#include <vector>

namespace baker::media {

class InjectedAudioSource
    : public webrtc::Notifier<webrtc::AudioSourceInterface> {
 public:
  InjectedAudioSource() = default;

  [[nodiscard]] SourceState state() const override { return kLive; }
  [[nodiscard]] bool remote() const override { return false; }
  void SetVolume(double volume) override;
  void AddSink(webrtc::AudioTrackSinkInterface* sink) override;
  void RemoveSink(webrtc::AudioTrackSinkInterface* sink) override;

  void pushFloat32(const float* samples, std::size_t frames, int sampleRate,
                   int channels);

 private:
  std::mutex mutex_;
  std::vector<webrtc::AudioTrackSinkInterface*> sinks_;
  std::vector<std::int16_t> converted_;
  double volume_ = 1.0;
};

}  // namespace baker::media

#endif
