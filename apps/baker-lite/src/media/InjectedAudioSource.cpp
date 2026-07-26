#include "InjectedAudioSource.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include <algorithm>
#include <cmath>
#include <optional>

namespace baker::media {

void InjectedAudioSource::SetVolume(double volume) {
  std::scoped_lock lock(mutex_);
  volume_ = std::clamp(volume, 0.0, 10.0);
}

void InjectedAudioSource::AddSink(
    webrtc::AudioTrackSinkInterface* sink) {
  if (sink == nullptr) {
    return;
  }
  std::scoped_lock lock(mutex_);
  if (std::find(sinks_.begin(), sinks_.end(), sink) == sinks_.end()) {
    sinks_.push_back(sink);
  }
}

void InjectedAudioSource::RemoveSink(
    webrtc::AudioTrackSinkInterface* sink) {
  std::scoped_lock lock(mutex_);
  std::erase(sinks_, sink);
}

void InjectedAudioSource::pushFloat32(const float* samples,
                                      std::size_t frames, int sampleRate,
                                      int channels) {
  if (samples == nullptr || frames == 0 || sampleRate <= 0 || channels <= 0) {
    return;
  }

  std::vector<webrtc::AudioTrackSinkInterface*> sinks;
  {
    std::scoped_lock lock(mutex_);
    const std::size_t sampleCount =
        frames * static_cast<std::size_t>(channels);
    converted_.resize(sampleCount);
    for (std::size_t index = 0; index < sampleCount; ++index) {
      const float scaled = std::clamp(
          samples[index] * static_cast<float>(volume_), -1.0F, 1.0F);
      converted_[index] =
          static_cast<std::int16_t>(std::lrint(scaled * 32767.0F));
    }
    sinks = sinks_;
  }

  for (webrtc::AudioTrackSinkInterface* sink : sinks) {
    sink->OnData(converted_.data(), 16, sampleRate,
                 static_cast<std::size_t>(channels), frames, std::nullopt);
  }
}

}  // namespace baker::media

#endif
