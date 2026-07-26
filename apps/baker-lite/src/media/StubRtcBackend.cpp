#include "RtcBackend.hpp"

#ifndef BAKER_LITE_WITH_WEBRTC

#include <QTimer>

namespace baker::media {
namespace {

class StubRtcBackend final : public RtcBackend {
 public:
  explicit StubRtcBackend(QObject* parent) : RtcBackend(parent) {}

  [[nodiscard]] bool isAvailable() const noexcept override { return false; }
  [[nodiscard]] QString unavailableReason() const override {
    return QStringLiteral(
        "This build was configured without libwebrtc/libmediasoupclient.");
  }

  void initialize() override {}
  void shutdown() override {}

  void startVoice(const SessionConfiguration& configuration) override {
    reject(configuration.descriptor.sessionId, QStringLiteral("voice"));
  }
  void startMusicPublish(const SessionConfiguration& configuration,
                         quint32 processId) override {
    Q_UNUSED(processId)
    reject(configuration.descriptor.sessionId, QStringLiteral("music"));
  }
  void startMusicListen(const SessionConfiguration& configuration) override {
    reject(configuration.descriptor.sessionId, QStringLiteral("music"));
  }
  void startStreamPublish(const SessionConfiguration& configuration,
                          StreamSourceType sourceType, const QString& sourceId,
                          const StreamQuality& quality,
                          bool shareAudio) override {
    Q_UNUSED(sourceType)
    Q_UNUSED(sourceId)
    Q_UNUSED(quality)
    Q_UNUSED(shareAudio)
    reject(configuration.descriptor.sessionId, QStringLiteral("stream"));
  }
  void startStreamWatch(const SessionConfiguration& configuration) override {
    reject(configuration.descriptor.sessionId, QStringLiteral("stream"));
  }
  void stopSession(const QString& sessionId) override {
    emit sessionStateChanged(sessionId, RuntimeState::Idle);
  }
  void stopAll() override {}

  void handleSignal(const QString&, const QJsonObject&) override {}
  void handleGatewayEvent(const QString&, const QJsonObject&) override {}
  void handleSfuProducerAdded(const QJsonObject&) override {}
  void handleSfuProducerRemoved(const QJsonObject&) override {}
  void handleGatewayAck(const QString&, const QJsonObject&) override {}
  void handleGatewayError(const QString&, const QString&,
                          const QString&) override {}
  void setMicrophoneMuted(bool) override {}
  void setOutputMuted(bool) override {}
  void setInputDevice(const QString&) override {}
  void setOutputDevice(const QString&) override {}
  void setMicrophoneVolume(double) override {}
  void setMasterVolume(double) override {}
  void setParticipantVolume(const QString&, double) override {}
  void setSessionVolume(const QString&, double) override {}

 private:
  void reject(const QString& sessionId, const QString& scope) {
    emit sessionStateChanged(sessionId, RuntimeState::Failed);
    emit errorOccurred(scope, unavailableReason());
  }
};

}  // namespace

RtcBackend* createRtcBackend(QObject* parent) {
  return new StubRtcBackend(parent);
}

}  // namespace baker::media

#endif
