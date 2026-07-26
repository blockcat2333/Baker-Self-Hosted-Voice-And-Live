#pragma once

#include "MediaTypes.hpp"

#include <QImage>
#include <QJsonObject>
#include <QObject>

namespace baker::media {

class RtcBackend : public QObject {
  Q_OBJECT

 public:
  explicit RtcBackend(QObject* parent = nullptr) : QObject(parent) {}
  ~RtcBackend() override = default;

  [[nodiscard]] virtual bool isAvailable() const noexcept = 0;
  [[nodiscard]] virtual QString unavailableReason() const = 0;

  virtual void initialize() = 0;
  virtual void shutdown() = 0;

  virtual void startVoice(const SessionConfiguration& configuration) = 0;
  virtual void startMusicPublish(const SessionConfiguration& configuration,
                                 quint32 processId) = 0;
  virtual void startMusicListen(const SessionConfiguration& configuration) = 0;
  virtual void startStreamPublish(const SessionConfiguration& configuration,
                                  StreamSourceType sourceType,
                                  const QString& sourceId,
                                  const StreamQuality& quality,
                                  bool shareAudio) = 0;
  virtual void startStreamWatch(const SessionConfiguration& configuration) = 0;
  virtual void stopSession(const QString& sessionId) = 0;
  virtual void stopAll() = 0;

  virtual void handleSignal(const QString& fromUserId,
                            const QJsonObject& signal) = 0;
  virtual void handleGatewayEvent(const QString& event,
                                  const QJsonObject& data) = 0;
  virtual void handleSfuProducerAdded(const QJsonObject& producer) = 0;
  virtual void handleSfuProducerRemoved(const QJsonObject& producer) = 0;
  virtual void handleGatewayAck(const QString& requestId,
                                const QJsonObject& data) = 0;
  virtual void handleGatewayError(const QString& requestId,
                                  const QString& code,
                                  const QString& message) = 0;

  virtual void setMicrophoneMuted(bool muted) = 0;
  virtual void setOutputMuted(bool muted) = 0;
  virtual void setInputDevice(const QString& deviceId) = 0;
  virtual void setOutputDevice(const QString& deviceId) = 0;
  virtual void setMicrophoneVolume(double volume) = 0;
  virtual void setMasterVolume(double volume) = 0;
  virtual void setParticipantVolume(const QString& userId, double volume) = 0;
  virtual void setSessionVolume(const QString& sessionId, double volume) = 0;

 signals:
  void gatewayCommandRequested(const QString& requestId,
                               const QString& command,
                               const QJsonObject& data);
  void localSpeakingChanged(bool speaking);
  void sessionStateChanged(const QString& sessionId, RuntimeState state);
  void remoteVideoFrameAvailable(const QString& sessionId,
                                 const QImage& image);
  void statisticsUpdated(const QString& sessionId,
                         const MediaStatistics& statistics);
  void errorOccurred(const QString& scope, const QString& message);
};

RtcBackend* createRtcBackend(QObject* parent = nullptr);

}  // namespace baker::media
