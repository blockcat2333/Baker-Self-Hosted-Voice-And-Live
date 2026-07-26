#pragma once

namespace baker::audio {

enum class UiSoundCue {
  JoinedChannel,
  LeftChannel,
  MicrophoneMuted,
  MicrophoneUnmuted,
  OutputMuted,
  OutputUnmuted,
  StreamStarted,
  StreamStopped,
};

class UiSoundPlayer final {
 public:
  static void play(UiSoundCue cue);
};

}  // namespace baker::audio
