#pragma once

#include "MediaTypes.hpp"

#include <QHash>
#include <QImage>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QTimer>

namespace baker::media {

class RtcBackend;

class MediaCoordinator final : public QObject {
  Q_OBJECT

 public:
  explicit MediaCoordinator(QObject* parent = nullptr);
  ~MediaCoordinator() override;

  [[nodiscard]] RtcBackend* backend() const noexcept;
  [[nodiscard]] QString voiceChannelId() const;
  [[nodiscard]] RuntimeState voiceState() const noexcept;
  [[nodiscard]] bool microphoneMuted() const noexcept;
  [[nodiscard]] bool outputMuted() const noexcept;
  [[nodiscard]] bool hasOwnedStream() const noexcept;
  [[nodiscard]] QString streamIdForSession(const QString& sessionId) const;

 public slots:
  void initialize();
  void shutdown();
  void setLocalUserId(const QString& userId);

  void joinVoice(const QString& channelId);
  void leaveVoice();
  void setMicrophoneMuted(bool muted);
  void setOutputMuted(bool muted);
  void setInputDevice(const QString& deviceId);
  void setOutputDevice(const QString& deviceId);
  void setMicrophoneVolume(double volume);
  void setMasterVolume(double volume);
  void setParticipantVolume(const QString& userId, double volume);

  void startMusicShare(const QString& channelId, quint32 processId);
  void stopMusicShare();
  void stopAllMusic();
  void listenToMusic(const QString& channelId, const QString& musicId);
  void stopListeningToMusic(const QString& musicId);
  void setMusicVolume(const QString& musicId, double volume);
  void setMusicPlaybackVolume(double volume);

  void startStream(const QString& channelId, StreamSourceType sourceType,
                   const QString& sourceId, const StreamQuality& quality,
                   bool shareAudio);
  void stopOwnedStream();
  void watchStream(const QString& channelId, const QString& streamId);
  void unwatchStream(const QString& streamId);
  void setStreamVolume(const QString& streamId, double volume);

  void handleGatewayAck(const QString& requestId, const QJsonObject& data);
  void handleGatewayError(const QString& requestId, const QString& code,
                          const QString& message);
  void handleGatewayEvent(const QString& event, const QJsonObject& data);
  void recoverActiveSessions();

 signals:
  void gatewayCommandRequested(const QString& requestId,
                               const QString& command,
                               const QJsonObject& data);
  void voiceStateChanged(RuntimeState state, const QString& channelId);
  void voiceParticipantsChanged(
      const QHash<QString, VoiceParticipant>& participants);
  void musicStateChanged();
  void streamStateChanged();
  void streamStartFailed(const QString& message);
  void streamWatchEnded(const QString& streamId);
  void microphoneMutedChanged(bool muted);
  void outputMutedChanged(bool muted);
  void localSpeakingChanged(bool speaking);
  void remoteVideoFrameAvailable(const QString& sessionId,
                                 const QImage& image);
  void statisticsUpdated(const QString& sessionId,
                         const MediaStatistics& statistics);
  void notificationRequested(const QString& level, const QString& message);
  void mediaError(const QString& scope, const QString& message);

 private:
  enum class Operation {
    VoiceJoin,
    VoiceLeave,
    VoiceSpeaking,
    MusicStart,
    MusicStop,
    MusicListen,
    MusicUnlisten,
    StreamStart,
    StreamStop,
    StreamWatch,
    StreamUnwatch,
    Backend,
  };

  struct PendingCommand {
    Operation operation = Operation::Backend;
    QJsonObject context;
  };

  QString send(Operation operation, const QString& command,
               const QJsonObject& data, const QJsonObject& context = {});
  void startConfiguredSession(Operation operation, const QJsonObject& ack,
                              const QJsonObject& context);
  void replaceVoiceParticipants(const QJsonArray& participants);
  void patchVoiceParticipant(const QJsonObject& participant);
  void clearVoiceState(RuntimeState nextState = RuntimeState::Idle);
  SessionConfiguration sessionConfiguration(
      SessionMode mode, const QJsonObject& ack,
      const QJsonObject& context = {}) const;

  RtcBackend* backend_ = nullptr;
  QHash<QString, PendingCommand> pending_;
  QHash<QString, VoiceParticipant> participants_;
  QHash<QString, QString> watchedSessionByStream_;
  QHash<QString, QString> listenedSessionByMusic_;
  QString voiceChannelId_;
  QString localUserId_;
  QString voiceSessionId_;
  QString ownedMusicId_;
  QString ownedMusicSessionId_;
  QString ownedStreamId_;
  QString ownedStreamSessionId_;
  RuntimeState voiceState_ = RuntimeState::Idle;
  bool microphoneMuted_ = false;
  bool outputMuted_ = false;
  double musicPlaybackVolume_ = 1.0;
  QTimer speakingDebounce_;
};

}  // namespace baker::media
