#pragma once

#include "../protocol/ProtocolTypes.h"

#include <QElapsedTimer>
#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QQueue>
#include <QTimer>
#include <QUrl>
#include <QWebSocket>

#include <functional>

namespace baker::network {

struct GatewayError {
  QString code;
  QString message;
  QString requestId;
  bool retryable = false;
};

class GatewayClient final : public QObject {
  Q_OBJECT

public:
  enum class State {
    Disconnected,
    Connecting,
    Connected,
    Authenticating,
    Ready,
    Reconnecting,
  };
  Q_ENUM(State)

  struct Options {
    int commandTimeoutMs = 8000;
    int heartbeatIntervalMs = 5000;
    int pongTimeoutMs = 10000;
    int reconnectBaseMs = 500;
    int reconnectMaximumMs = 30000;
    double reconnectJitter = 0.25;
  };

  using AccessTokenProvider = std::function<QString()>;

  explicit GatewayClient(QObject *parent = nullptr);
  explicit GatewayClient(const QUrl &url, QObject *parent = nullptr);
  ~GatewayClient() override;

  [[nodiscard]] QUrl url() const;
  [[nodiscard]] bool setUrl(const QUrl &url, QString *error = nullptr);
  [[nodiscard]] State state() const;
  [[nodiscard]] int reconnectAttempt() const;
  void setOptions(const Options &options);
  [[nodiscard]] Options options() const;
  void setAccessTokenProvider(AccessTokenProvider provider);

  void connectToServer();
  void disconnectFromServer();
  void reconnectNow();

  [[nodiscard]] QString sendCommand(const QString &command,
                                    const QJsonValue &data,
                                    int timeoutMs = -1);
  [[nodiscard]] QString sendCommand(const QString &command,
                                    const QJsonValue &data,
                                    const QString &requestId,
                                    int timeoutMs = -1);

  [[nodiscard]] static int reconnectDelayMs(int attempt, const Options &options,
                                             double randomUnit);

signals:
  void stateChanged(baker::network::GatewayClient::State state);
  void transportConnected();
  void authenticated();
  void authenticationRequired();
  void authenticationExpired();
  void envelopeReceived(const baker::protocol::GatewayEnvelope &envelope);
  void eventReceived(const QString &event, const QJsonValue &data, qint64 sequence);
  void commandSucceeded(const QString &requestId, const QJsonValue &data);
  void commandFailed(const QString &requestId,
                     const baker::network::GatewayError &error);
  void protocolError(const QString &message);
  void transportError(const QString &message);
  void reconnectScheduled(int attempt, int delayMs);
  void latencyUpdated(int roundTripMs);
  void sequenceGapDetected(qint64 expected, qint64 received);
  void resyncRequired();

private:
  struct PendingCommand {
    QString command;
    QJsonObject envelope;
    QTimer *timer = nullptr;
    int timeoutMs = 0;
    bool sent = false;
  };

  void setState(State state);
  void openSocket();
  void handleTextMessage(const QString &message);
  void handleEnvelope(const protocol::GatewayEnvelope &envelope);
  void handleDisconnected();
  void handleSocketError(QAbstractSocket::SocketError error);
  void scheduleReconnect();
  void failPending(const GatewayError &error);
  void sendHeartbeat();
  void sendPong();
  void beginAuthentication();
  void flushQueue();
  void writePending(const QString &requestId);
  QString submitCommand(const QString &command, const QJsonValue &data,
                        const QString &requestId, int timeoutMs,
                        bool allowBeforeAuthentication);

  QWebSocket socket_;
  QUrl url_;
  State state_ = State::Disconnected;
  Options options_;
  AccessTokenProvider accessTokenProvider_;
  QHash<QString, PendingCommand> pending_;
  QQueue<QString> sendQueue_;
  QTimer heartbeatTimer_;
  QTimer pongTimer_;
  QTimer reconnectTimer_;
  QElapsedTimer pingElapsed_;
  bool desiredConnected_ = false;
  bool handlingDisconnect_ = false;
  int reconnectAttempt_ = 0;
  qint64 lastSequence_ = -1;
  QString authenticationRequestId_;
};

} // namespace baker::network

Q_DECLARE_METATYPE(baker::network::GatewayError)
Q_DECLARE_METATYPE(baker::network::GatewayClient::State)
Q_DECLARE_METATYPE(baker::protocol::GatewayEnvelope)
