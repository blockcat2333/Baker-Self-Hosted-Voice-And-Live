#include "GatewayClient.h"

#include "../security/Redaction.h"

#include <QJsonDocument>
#include <QLoggingCategory>
#include <QRandomGenerator>
#include <QUuid>

#include <cmath>
#include <utility>

Q_LOGGING_CATEGORY(gatewayLog, "baker.lite.network.gateway")

namespace baker::network {

GatewayClient::GatewayClient(QObject *parent)
    : QObject(parent), socket_(QString(), QWebSocketProtocol::VersionLatest, this) {
  qRegisterMetaType<GatewayError>();
  qRegisterMetaType<GatewayClient::State>();
  qRegisterMetaType<protocol::GatewayEnvelope>();

  heartbeatTimer_.setSingleShot(false);
  pongTimer_.setSingleShot(true);
  reconnectTimer_.setSingleShot(true);

  connect(&socket_, &QWebSocket::connected, this, [this]() {
    handlingDisconnect_ = false;
    reconnectTimer_.stop();
    lastSequence_ = -1;
    setState(State::Connected);
    emit transportConnected();
    heartbeatTimer_.start(options_.heartbeatIntervalMs);
  });
  connect(&socket_, &QWebSocket::textMessageReceived, this,
          &GatewayClient::handleTextMessage);
  connect(&socket_, &QWebSocket::disconnected, this,
          &GatewayClient::handleDisconnected);
  connect(&socket_, &QWebSocket::errorOccurred, this,
          &GatewayClient::handleSocketError);
  connect(&heartbeatTimer_, &QTimer::timeout, this,
          &GatewayClient::sendHeartbeat);
  connect(&pongTimer_, &QTimer::timeout, this, [this]() {
    emit transportError(QStringLiteral("Gateway heartbeat timed out."));
    socket_.abort();
  });
  connect(&reconnectTimer_, &QTimer::timeout, this, &GatewayClient::openSocket);
}

GatewayClient::GatewayClient(const QUrl &url, QObject *parent)
    : GatewayClient(parent) {
  QString ignored;
  const bool configured = setUrl(url, &ignored);
  Q_UNUSED(configured)
}

GatewayClient::~GatewayClient() {
  desiredConnected_ = false;
  failPending({QStringLiteral("CLIENT_DESTROYED"),
               QStringLiteral("Gateway client was destroyed."), {}, false});
}

QUrl GatewayClient::url() const { return url_; }

bool GatewayClient::setUrl(const QUrl &url, QString *error) {
  QUrl normalized = url.adjusted(QUrl::NormalizePathSegments);
  const auto scheme = normalized.scheme().toLower();
  if (!normalized.isValid() || normalized.host().isEmpty() ||
      (scheme != QStringLiteral("ws") && scheme != QStringLiteral("wss"))) {
    if (error) {
      *error =
          QStringLiteral("Gateway URL must be an absolute ws:// or wss:// URL.");
    }
    return false;
  }
  normalized.setFragment({});
  url_ = normalized;
  return true;
}

GatewayClient::State GatewayClient::state() const { return state_; }

int GatewayClient::reconnectAttempt() const { return reconnectAttempt_; }

void GatewayClient::setOptions(const Options &options) {
  options_ = options;
  options_.commandTimeoutMs = qBound(100, options_.commandTimeoutMs, 120000);
  options_.heartbeatIntervalMs =
      qBound(1000, options_.heartbeatIntervalMs, 120000);
  options_.pongTimeoutMs = qBound(500, options_.pongTimeoutMs, 120000);
  options_.reconnectBaseMs = qBound(100, options_.reconnectBaseMs, 60000);
  options_.reconnectMaximumMs =
      qMax(options_.reconnectBaseMs, options_.reconnectMaximumMs);
  options_.reconnectJitter = qBound(0.0, options_.reconnectJitter, 0.9);
  if (heartbeatTimer_.isActive()) {
    heartbeatTimer_.start(options_.heartbeatIntervalMs);
  }
}

GatewayClient::Options GatewayClient::options() const { return options_; }

void GatewayClient::setAccessTokenProvider(AccessTokenProvider provider) {
  accessTokenProvider_ = std::move(provider);
}

void GatewayClient::connectToServer() {
  if (url_.isEmpty()) {
    emit transportError(QStringLiteral("Gateway URL has not been configured."));
    return;
  }
  desiredConnected_ = true;
  if (socket_.state() != QAbstractSocket::UnconnectedState ||
      state_ == State::Connecting || state_ == State::Connected ||
      state_ == State::Authenticating || state_ == State::Ready) {
    return;
  }
  reconnectTimer_.stop();
  reconnectAttempt_ = 0;
  openSocket();
}

void GatewayClient::disconnectFromServer() {
  desiredConnected_ = false;
  reconnectTimer_.stop();
  heartbeatTimer_.stop();
  pongTimer_.stop();
  failPending({QStringLiteral("DISCONNECTED"),
               QStringLiteral("Gateway was disconnected by the client."), {},
               false});
  sendQueue_.clear();
  authenticationRequestId_.clear();
  if (socket_.state() == QAbstractSocket::UnconnectedState) {
    setState(State::Disconnected);
  } else {
    socket_.close(QWebSocketProtocol::CloseCodeNormal,
                  QStringLiteral("Client disconnect"));
  }
}

void GatewayClient::reconnectNow() {
  if (!desiredConnected_) {
    desiredConnected_ = true;
  }
  reconnectTimer_.stop();
  reconnectAttempt_ = 0;
  if (socket_.state() != QAbstractSocket::UnconnectedState) {
    socket_.abort();
    return;
  }
  openSocket();
}

QString GatewayClient::sendCommand(const QString &command,
                                   const QJsonValue &data, int timeoutMs) {
  return sendCommand(command, data, QUuid::createUuid().toString(QUuid::WithoutBraces),
                     timeoutMs);
}

QString GatewayClient::sendCommand(const QString &command,
                                   const QJsonValue &data,
                                   const QString &requestId, int timeoutMs) {
  return submitCommand(command, data, requestId, timeoutMs, false);
}

int GatewayClient::reconnectDelayMs(int attempt, const Options &options,
                                    double randomUnit) {
  const double exponent = std::pow(2.0, qMax(0, attempt));
  const double base = qMin(static_cast<double>(options.reconnectMaximumMs),
                           static_cast<double>(options.reconnectBaseMs) * exponent);
  const double unit = qBound(0.0, randomUnit, 1.0);
  const double jitter = base * options.reconnectJitter * (unit * 2.0 - 1.0);
  return qMax(0, qRound(base + jitter));
}

void GatewayClient::setState(State state) {
  if (state_ == state) {
    return;
  }
  state_ = state;
  emit stateChanged(state_);
}

void GatewayClient::openSocket() {
  if (!desiredConnected_ || url_.isEmpty()) {
    return;
  }
  handlingDisconnect_ = false;
  setState(reconnectAttempt_ > 0 ? State::Reconnecting : State::Connecting);
  socket_.open(url_);
}

void GatewayClient::handleTextMessage(const QString &message) {
  const auto parsed = protocol::parseGatewayEnvelope(message.toUtf8());
  if (!parsed) {
    const auto detail = parsed.errorString();
    qCWarning(gatewayLog).noquote()
        << "Rejected gateway envelope:"
        << security::redactText(detail);
    emit protocolError(detail);
    return;
  }
  emit envelopeReceived(*parsed.value);
  handleEnvelope(*parsed.value);
}

void GatewayClient::handleEnvelope(const protocol::GatewayEnvelope &envelope) {
  if (envelope.op == protocol::GatewayOp::Ping) {
    sendPong();
    return;
  }
  if (envelope.op == protocol::GatewayOp::Pong) {
    if (pongTimer_.isActive()) {
      pongTimer_.stop();
      if (pingElapsed_.isValid()) {
        emit latencyUpdated(static_cast<int>(pingElapsed_.elapsed()));
      }
    }
    return;
  }
  if (envelope.op == protocol::GatewayOp::Ack) {
    auto iterator = pending_.find(envelope.requestId);
    if (iterator == pending_.end()) {
      return;
    }
    const auto command = iterator->command;
    const auto validationIssues =
        protocol::validateAckData(command, envelope.data);
    if (!validationIssues.isEmpty()) {
      QStringList parts;
      for (const auto &issue : validationIssues) {
        parts.append(QStringLiteral("%1: %2").arg(issue.path, issue.message));
      }
      const auto details = QStringLiteral("Invalid ACK for %1: %2")
                               .arg(command, parts.join(QStringLiteral("; ")));
      if (iterator->timer) {
        iterator->timer->stop();
        iterator->timer->deleteLater();
      }
      const bool wasAuthentication =
          envelope.requestId == authenticationRequestId_;
      pending_.erase(iterator);
      emit protocolError(details);
      emit commandFailed(
          envelope.requestId,
          {QStringLiteral("INVALID_RESPONSE"), details, envelope.requestId, false});
      if (wasAuthentication) {
        authenticationRequestId_.clear();
        socket_.abort();
      }
      return;
    }
    if (iterator->timer) {
      iterator->timer->stop();
      iterator->timer->deleteLater();
    }
    const bool wasAuthentication =
        envelope.requestId == authenticationRequestId_;
    pending_.erase(iterator);
    emit commandSucceeded(envelope.requestId, envelope.data);
    if (wasAuthentication) {
      authenticationRequestId_.clear();
      reconnectAttempt_ = 0;
      setState(State::Ready);
      flushQueue();
      emit authenticated();
    }
    return;
  }
  if (envelope.op == protocol::GatewayOp::Error) {
    GatewayError error{envelope.errorCode, envelope.message, envelope.requestId,
                       envelope.retryable};
    if (!envelope.requestId.isEmpty()) {
      auto iterator = pending_.find(envelope.requestId);
      if (iterator != pending_.end()) {
        if (iterator->timer) {
          iterator->timer->stop();
          iterator->timer->deleteLater();
        }
        pending_.erase(iterator);
        emit commandFailed(envelope.requestId, error);
      }
    }
    if (envelope.errorCode == QStringLiteral("TOKEN_EXPIRED")) {
      emit authenticationExpired();
    } else if (envelope.errorCode == QStringLiteral("TOKEN_INVALID") ||
               envelope.errorCode == QStringLiteral("UNAUTHORIZED")) {
      emit authenticationRequired();
    }
    return;
  }
  if (envelope.op != protocol::GatewayOp::Event) {
    return;
  }

  if (lastSequence_ >= 0) {
    const qint64 expected = lastSequence_ + 1;
    if (envelope.sequence > expected) {
      emit sequenceGapDetected(expected, envelope.sequence);
      emit resyncRequired();
    } else if (envelope.sequence <= lastSequence_) {
      qCWarning(gatewayLog) << "Ignored duplicate/out-of-order event sequence"
                            << envelope.sequence << "after" << lastSequence_;
      return;
    }
  }
  lastSequence_ = envelope.sequence;

  if (envelope.event == QStringLiteral("system.ready")) {
    beginAuthentication();
  } else if (envelope.event == QStringLiteral("system.resync_required")) {
    emit resyncRequired();
  }
  emit eventReceived(envelope.event, envelope.data, envelope.sequence);
}

void GatewayClient::handleDisconnected() {
  if (handlingDisconnect_) {
    return;
  }
  handlingDisconnect_ = true;
  heartbeatTimer_.stop();
  pongTimer_.stop();
  authenticationRequestId_.clear();
  sendQueue_.clear();
  failPending({QStringLiteral("CONNECTION_CLOSED"),
               QStringLiteral("Gateway connection closed."), {}, true});
  if (desiredConnected_) {
    scheduleReconnect();
  } else {
    setState(State::Disconnected);
  }
}

void GatewayClient::handleSocketError(QAbstractSocket::SocketError error) {
  Q_UNUSED(error)
  const auto message = socket_.errorString();
  qCWarning(gatewayLog).noquote()
      << "Gateway transport error:" << security::redactText(message);
  emit transportError(message);
  if (desiredConnected_ &&
      socket_.state() == QAbstractSocket::UnconnectedState) {
    handleDisconnected();
  }
}

void GatewayClient::scheduleReconnect() {
  if (!desiredConnected_ || reconnectTimer_.isActive()) {
    return;
  }
  const int attempt = reconnectAttempt_;
  const double randomUnit = QRandomGenerator::global()->generateDouble();
  const int delay = reconnectDelayMs(attempt, options_, randomUnit);
  ++reconnectAttempt_;
  setState(State::Reconnecting);
  reconnectTimer_.start(delay);
  emit reconnectScheduled(reconnectAttempt_, delay);
}

void GatewayClient::failPending(const GatewayError &baseError) {
  const auto requestIds = pending_.keys();
  for (const auto &requestId : requestIds) {
    auto pending = pending_.take(requestId);
    if (pending.timer) {
      pending.timer->stop();
      pending.timer->deleteLater();
    }
    auto error = baseError;
    error.requestId = requestId;
    emit commandFailed(requestId, error);
  }
}

void GatewayClient::sendHeartbeat() {
  if (socket_.state() != QAbstractSocket::ConnectedState ||
      pongTimer_.isActive()) {
    return;
  }
  const auto envelope =
      protocol::createHeartbeatEnvelope(protocol::GatewayOp::Ping);
  socket_.sendTextMessage(
      QString::fromUtf8(QJsonDocument(envelope).toJson(QJsonDocument::Compact)));
  pingElapsed_.restart();
  pongTimer_.start(options_.pongTimeoutMs);
}

void GatewayClient::sendPong() {
  if (socket_.state() != QAbstractSocket::ConnectedState) {
    return;
  }
  const auto envelope =
      protocol::createHeartbeatEnvelope(protocol::GatewayOp::Pong);
  socket_.sendTextMessage(
      QString::fromUtf8(QJsonDocument(envelope).toJson(QJsonDocument::Compact)));
}

void GatewayClient::beginAuthentication() {
  const auto token =
      accessTokenProvider_ ? accessTokenProvider_() : QString();
  if (token.isEmpty()) {
    emit authenticationRequired();
    return;
  }
  setState(State::Authenticating);
  authenticationRequestId_ = QUuid::createUuid().toString(QUuid::WithoutBraces);
  submitCommand(
      QStringLiteral("system.authenticate"),
      QJsonObject{{QStringLiteral("accessToken"), token}},
      authenticationRequestId_, options_.commandTimeoutMs, true);
}

void GatewayClient::flushQueue() {
  if (state_ != State::Ready ||
      socket_.state() != QAbstractSocket::ConnectedState) {
    return;
  }
  while (!sendQueue_.isEmpty()) {
    writePending(sendQueue_.dequeue());
  }
}

void GatewayClient::writePending(const QString &requestId) {
  auto iterator = pending_.find(requestId);
  if (iterator == pending_.end() || iterator->sent) {
    return;
  }
  if (socket_.state() != QAbstractSocket::ConnectedState) {
    return;
  }
  const auto encoded =
      QJsonDocument(iterator->envelope).toJson(QJsonDocument::Compact);
  socket_.sendTextMessage(QString::fromUtf8(encoded));
  iterator->sent = true;
  iterator->timer->start(iterator->timeoutMs);
}

QString GatewayClient::submitCommand(const QString &command,
                                     const QJsonValue &data,
                                     const QString &requestId, int timeoutMs,
                                     bool allowBeforeAuthentication) {
  const QString id = requestId.isEmpty()
                         ? QUuid::createUuid().toString(QUuid::WithoutBraces)
                         : requestId;
  if (!protocol::isKnownGatewayCommand(command)) {
    QTimer::singleShot(0, this, [this, id, command]() {
      emit commandFailed(
          id, {QStringLiteral("UNSUPPORTED_COMMAND"),
               QStringLiteral("Unknown gateway command: %1").arg(command), id,
               false});
    });
    return id;
  }
  const auto issues = protocol::validateCommandData(command, data);
  if (!issues.isEmpty()) {
    QStringList parts;
    for (const auto &issue : issues) {
      parts.append(QStringLiteral("%1: %2").arg(issue.path, issue.message));
    }
    QTimer::singleShot(0, this, [this, id, parts]() {
      emit commandFailed(
          id, {QStringLiteral("VALIDATION_ERROR"), parts.join(QStringLiteral("; ")),
               id, false});
    });
    return id;
  }
  if (pending_.contains(id)) {
    QTimer::singleShot(0, this, [this, id]() {
      emit commandFailed(
          id, {QStringLiteral("DUPLICATE_REQUEST_ID"),
               QStringLiteral("Gateway request ID is already pending."), id,
               false});
    });
    return id;
  }
  if (!desiredConnected_) {
    QTimer::singleShot(0, this, [this, id]() {
      emit commandFailed(
          id, {QStringLiteral("NOT_CONNECTED"),
               QStringLiteral("Gateway is not connected."), id, true});
    });
    return id;
  }

  auto *timer = new QTimer(this);
  timer->setSingleShot(true);
  const int effectiveTimeout =
      timeoutMs > 0 ? qBound(100, timeoutMs, 120000)
                    : options_.commandTimeoutMs;
  pending_.insert(id, {command,
                       protocol::createCommandEnvelope(command, data, id),
                       timer, effectiveTimeout, false});
  connect(timer, &QTimer::timeout, this, [this, id, command]() {
    auto iterator = pending_.find(id);
    if (iterator == pending_.end()) {
      return;
    }
    iterator->timer->deleteLater();
    pending_.erase(iterator);
    emit commandFailed(
        id, {QStringLiteral("COMMAND_TIMEOUT"),
             QStringLiteral("Gateway command %1 timed out.").arg(command), id,
             true});
    if (id == authenticationRequestId_) {
      authenticationRequestId_.clear();
      emit transportError(QStringLiteral("Gateway authentication timed out."));
      socket_.abort();
    }
  });

  const bool canWrite =
      socket_.state() == QAbstractSocket::ConnectedState &&
      (state_ == State::Ready || allowBeforeAuthentication);
  if (canWrite) {
    writePending(id);
  } else {
    sendQueue_.enqueue(id);
  }
  return id;
}

} // namespace baker::network
