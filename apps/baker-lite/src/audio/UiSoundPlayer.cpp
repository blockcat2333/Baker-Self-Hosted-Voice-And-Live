#include "UiSoundPlayer.hpp"

#include <QtGlobal>

#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>
#endif

namespace baker::audio {

void UiSoundPlayer::play(const UiSoundCue cue) {
#ifdef Q_OS_WIN
  const wchar_t* alias = L"SystemNotification";
  switch (cue) {
    case UiSoundCue::JoinedChannel:
    case UiSoundCue::MicrophoneUnmuted:
    case UiSoundCue::OutputUnmuted:
    case UiSoundCue::StreamStarted:
      alias = L"SystemAsterisk";
      break;
    case UiSoundCue::LeftChannel:
    case UiSoundCue::StreamStopped:
      alias = L"SystemExclamation";
      break;
    case UiSoundCue::MicrophoneMuted:
    case UiSoundCue::OutputMuted:
      alias = L"SystemQuestion";
      break;
  }
  PlaySoundW(
      alias,
      nullptr,
      SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
#else
  (void)cue;
#endif
}

}  // namespace baker::audio
