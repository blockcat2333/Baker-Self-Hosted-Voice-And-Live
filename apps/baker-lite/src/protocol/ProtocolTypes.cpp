#include "ProtocolTypes.h"

#include <QJsonDocument>
#include <QRegularExpression>
#include <QUuid>

#include <algorithm>
#include <cmath>
#include <limits>

namespace baker::protocol {
namespace {

using Issues = QList<ValidationIssue>;

const QStringList kGatewayCommands = {
    QStringLiteral("channel.subscribe"),
    QStringLiteral("channel.unsubscribe"),
    QStringLiteral("media.signal.answer"),
    QStringLiteral("media.signal.end"),
    QStringLiteral("media.signal.ice_candidate"),
    QStringLiteral("media.signal.offer"),
    QStringLiteral("media.signal.restart_ice"),
    QStringLiteral("media.sfu.close"),
    QStringLiteral("media.sfu.connect_transport"),
    QStringLiteral("media.sfu.consume"),
    QStringLiteral("media.sfu.create_transport"),
    QStringLiteral("media.sfu.produce"),
    QStringLiteral("media.sfu.resume_consumer"),
    QStringLiteral("music.listen"),
    QStringLiteral("music.start"),
    QStringLiteral("music.stop"),
    QStringLiteral("music.unlisten"),
    QStringLiteral("presence.subscribe"),
    QStringLiteral("stream.start"),
    QStringLiteral("stream.stop"),
    QStringLiteral("stream.unwatch"),
    QStringLiteral("stream.watch"),
    QStringLiteral("system.authenticate"),
    QStringLiteral("typing.set"),
    QStringLiteral("voice.join"),
    QStringLiteral("voice.leave"),
    QStringLiteral("voice.network.self_report"),
    QStringLiteral("voice.speaking.updated"),
};

const QStringList kGatewayEvents = {
    QStringLiteral("chat.message.created"),
    QStringLiteral("guild.member.updated"),
    QStringLiteral("media.signal"),
    QStringLiteral("media.mode.updated"),
    QStringLiteral("media.sfu.producer.added"),
    QStringLiteral("media.sfu.producer.removed"),
    QStringLiteral("music.state.updated"),
    QStringLiteral("presence.updated"),
    QStringLiteral("stream.session.updated"),
    QStringLiteral("stream.state.updated"),
    QStringLiteral("stream.viewer.joined"),
    QStringLiteral("stream.viewer.left"),
    QStringLiteral("system.notification"),
    QStringLiteral("system.ready"),
    QStringLiteral("system.resync_required"),
    QStringLiteral("voice.member.updated"),
    QStringLiteral("voice.network.updated"),
    QStringLiteral("voice.roster.updated"),
    QStringLiteral("voice.speaking.updated"),
    QStringLiteral("voice.state.updated"),
};

const QStringList kErrorCodes = {
    QStringLiteral("CHANNEL_NOT_FOUND"),
    QStringLiteral("CHANNEL_NOT_TEXT"),
    QStringLiteral("FORBIDDEN"),
    QStringLiteral("GUILD_NOT_FOUND"),
    QStringLiteral("INTERNAL_SERVER_ERROR"),
    QStringLiteral("INVALID_CREDENTIALS"),
    QStringLiteral("INVALID_PAYLOAD"),
    QStringLiteral("MEDIA_NEGOTIATION_TIMEOUT"),
    QStringLiteral("MUSIC_ALREADY_LISTENING"),
    QStringLiteral("MUSIC_ALREADY_LIVE"),
    QStringLiteral("MUSIC_NOT_FOUND"),
    QStringLiteral("MUSIC_NOT_HOST"),
    QStringLiteral("MUSIC_NOT_LIVE"),
    QStringLiteral("NOT_FOUND"),
    QStringLiteral("PERMISSION_DENIED"),
    QStringLiteral("RATE_LIMITED"),
    QStringLiteral("STREAM_ALREADY_ACTIVE"),
    QStringLiteral("STREAM_ALREADY_LIVE"),
    QStringLiteral("STREAM_ALREADY_WATCHING"),
    QStringLiteral("STREAM_NOT_FOUND"),
    QStringLiteral("STREAM_NOT_HOST"),
    QStringLiteral("STREAM_NOT_LIVE"),
    QStringLiteral("TOKEN_EXPIRED"),
    QStringLiteral("TOKEN_INVALID"),
    QStringLiteral("UNAUTHORIZED"),
    QStringLiteral("UNSUPPORTED_COMMAND"),
    QStringLiteral("VALIDATION_ERROR"),
    QStringLiteral("VOICE_ALREADY_JOINED"),
    QStringLiteral("VOICE_NOT_JOINED"),
};

QString childPath(const QString &base, const QString &key) {
  return base.isEmpty() ? key : QStringLiteral("%1.%2").arg(base, key);
}

void issue(Issues &issues, const QString &path, const QString &message) {
  issues.append({path.isEmpty() ? QStringLiteral("$") : path, message});
}

bool requireObject(const QJsonValue &value, const QString &path, Issues &issues,
                   QJsonObject *out = nullptr) {
  if (!value.isObject()) {
    issue(issues, path, QStringLiteral("expected object"));
    return false;
  }
  if (out) {
    *out = value.toObject();
  }
  return true;
}

bool requireArray(const QJsonValue &value, const QString &path, Issues &issues,
                  QJsonArray *out = nullptr) {
  if (!value.isArray()) {
    issue(issues, path, QStringLiteral("expected array"));
    return false;
  }
  if (out) {
    *out = value.toArray();
  }
  return true;
}

bool requireString(const QJsonObject &object, const QString &key, const QString &path,
                   Issues &issues, QString *out = nullptr, bool nonEmpty = true) {
  const auto value = object.value(key);
  const auto fieldPath = childPath(path, key);
  if (!value.isString()) {
    issue(issues, fieldPath, QStringLiteral("expected string"));
    return false;
  }
  const auto result = value.toString();
  if (nonEmpty && result.isEmpty()) {
    issue(issues, fieldPath, QStringLiteral("must not be empty"));
    return false;
  }
  if (out) {
    *out = result;
  }
  return true;
}

bool optionalString(const QJsonObject &object, const QString &key, const QString &path,
                    Issues &issues, std::optional<QString> *out = nullptr,
                    bool nullable = false) {
  const auto value = object.value(key);
  if (value.isUndefined() || (nullable && value.isNull())) {
    if (out) {
      out->reset();
    }
    return true;
  }
  if (!value.isString()) {
    issue(issues, childPath(path, key),
          nullable ? QStringLiteral("expected string or null")
                   : QStringLiteral("expected string"));
    return false;
  }
  if (out) {
    *out = value.toString();
  }
  return true;
}

bool requireBool(const QJsonObject &object, const QString &key, const QString &path,
                 Issues &issues, bool *out = nullptr) {
  const auto value = object.value(key);
  if (!value.isBool()) {
    issue(issues, childPath(path, key), QStringLiteral("expected boolean"));
    return false;
  }
  if (out) {
    *out = value.toBool();
  }
  return true;
}

bool requireInteger(const QJsonObject &object, const QString &key, const QString &path,
                    Issues &issues, qint64 minimum, qint64 maximum,
                    qint64 *out = nullptr) {
  const auto value = object.value(key);
  const auto fieldPath = childPath(path, key);
  if (!value.isDouble()) {
    issue(issues, fieldPath, QStringLiteral("expected integer"));
    return false;
  }
  const auto number = value.toDouble();
  if (!qIsFinite(number) || std::floor(number) != number ||
      number < static_cast<double>(minimum) ||
      number > static_cast<double>(maximum)) {
    issue(issues, fieldPath,
          QStringLiteral("expected integer in range %1..%2").arg(minimum).arg(maximum));
    return false;
  }
  if (out) {
    *out = static_cast<qint64>(number);
  }
  return true;
}

bool requireNumber(const QJsonObject &object, const QString &key, const QString &path,
                   Issues &issues, double minimum, double maximum,
                   double *out = nullptr, bool nullable = false) {
  const auto value = object.value(key);
  const auto fieldPath = childPath(path, key);
  if (nullable && value.isNull()) {
    return true;
  }
  if (!value.isDouble()) {
    issue(issues, fieldPath,
          nullable ? QStringLiteral("expected number or null")
                   : QStringLiteral("expected number"));
    return false;
  }
  const auto number = value.toDouble();
  if (!qIsFinite(number) || number < minimum || number > maximum) {
    issue(issues, fieldPath,
          QStringLiteral("expected number in range %1..%2").arg(minimum).arg(maximum));
    return false;
  }
  if (out) {
    *out = number;
  }
  return true;
}

bool requireEnum(const QJsonObject &object, const QString &key, const QString &path,
                 const QStringList &allowed, Issues &issues, QString *out = nullptr) {
  QString value;
  if (!requireString(object, key, path, issues, &value)) {
    return false;
  }
  if (!allowed.contains(value)) {
    issue(issues, childPath(path, key),
          QStringLiteral("unsupported value '%1'").arg(value));
    return false;
  }
  if (out) {
    *out = value;
  }
  return true;
}

bool validUuid(const QString &value) {
  static const QRegularExpression pattern(
      QStringLiteral("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
                     "[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"));
  return pattern.match(value).hasMatch() && !QUuid(value).isNull();
}

bool requireUuid(const QJsonObject &object, const QString &key, const QString &path,
                 Issues &issues, QString *out = nullptr) {
  QString value;
  if (!requireString(object, key, path, issues, &value)) {
    return false;
  }
  if (!validUuid(value)) {
    issue(issues, childPath(path, key), QStringLiteral("expected UUID"));
    return false;
  }
  if (out) {
    *out = value;
  }
  return true;
}

bool optionalUuid(const QJsonObject &object, const QString &key, const QString &path,
                  Issues &issues, std::optional<QString> *out = nullptr,
                  bool nullable = false) {
  const auto value = object.value(key);
  if (value.isUndefined() || (nullable && value.isNull())) {
    if (out) {
      out->reset();
    }
    return true;
  }
  if (!value.isString() || !validUuid(value.toString())) {
    issue(issues, childPath(path, key),
          nullable ? QStringLiteral("expected UUID or null")
                   : QStringLiteral("expected UUID"));
    return false;
  }
  if (out) {
    *out = value.toString();
  }
  return true;
}

bool parseDate(const QString &value, QDateTime *out = nullptr) {
  if (!value.endsWith(QLatin1Char('Z'))) {
    return false;
  }
  auto date = QDateTime::fromString(value, Qt::ISODateWithMs);
  if (!date.isValid()) {
    date = QDateTime::fromString(value, Qt::ISODate);
  }
  if (!date.isValid() || value.size() < 20) {
    return false;
  }
  if (out) {
    *out = date.toUTC();
  }
  return true;
}

bool requireDate(const QJsonObject &object, const QString &key, const QString &path,
                 Issues &issues, QDateTime *out = nullptr) {
  QString value;
  if (!requireString(object, key, path, issues, &value)) {
    return false;
  }
  if (!parseDate(value, out)) {
    issue(issues, childPath(path, key), QStringLiteral("expected ISO-8601 datetime"));
    return false;
  }
  return true;
}

bool optionalDate(const QJsonObject &object, const QString &key, const QString &path,
                  Issues &issues, std::optional<QDateTime> *out = nullptr) {
  const auto value = object.value(key);
  if (value.isNull()) {
    if (out) {
      out->reset();
    }
    return true;
  }
  if (!value.isString()) {
    issue(issues, childPath(path, key), QStringLiteral("expected datetime or null"));
    return false;
  }
  QDateTime result;
  if (!parseDate(value.toString(), &result)) {
    issue(issues, childPath(path, key), QStringLiteral("expected ISO-8601 datetime"));
    return false;
  }
  if (out) {
    *out = result;
  }
  return true;
}

void validateLength(const QString &value, int minimum, int maximum,
                    const QString &path, Issues &issues) {
  if (value.size() < minimum || value.size() > maximum) {
    issue(issues, path,
          QStringLiteral("length must be in range %1..%2").arg(minimum).arg(maximum));
  }
}

void validateVoiceParticipant(const QJsonValue &value, const QString &path,
                              Issues &issues, VoiceParticipant *out = nullptr) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  QString userId;
  QString sessionId;
  bool muted = false;
  requireUuid(object, QStringLiteral("userId"), path, issues, &userId);
  requireUuid(object, QStringLiteral("sessionId"), path, issues, &sessionId);
  requireBool(object, QStringLiteral("isMuted"), path, issues, &muted);
  if (out) {
    *out = {userId, sessionId, muted};
  }
}

void validateIceServer(const QJsonValue &value, const QString &path, Issues &issues,
                       IceServer *out = nullptr) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  QStringList urls;
  const auto urlsValue = object.value(QStringLiteral("urls"));
  if (urlsValue.isString()) {
    if (urlsValue.toString().isEmpty()) {
      issue(issues, childPath(path, QStringLiteral("urls")),
            QStringLiteral("must not be empty"));
    } else {
      urls.append(urlsValue.toString());
    }
  } else if (urlsValue.isArray()) {
    const auto array = urlsValue.toArray();
    for (qsizetype index = 0; index < array.size(); ++index) {
      if (!array.at(index).isString() || array.at(index).toString().isEmpty()) {
        issue(issues, QStringLiteral("%1.urls[%2]").arg(path).arg(index),
              QStringLiteral("expected non-empty string"));
      } else {
        urls.append(array.at(index).toString());
      }
    }
  } else {
    issue(issues, childPath(path, QStringLiteral("urls")),
          QStringLiteral("expected string or array of strings"));
  }
  std::optional<QString> username;
  std::optional<QString> credential;
  optionalString(object, QStringLiteral("username"), path, issues, &username);
  optionalString(object, QStringLiteral("credential"), path, issues, &credential);
  if (out) {
    *out = {urls, username, credential};
  }
}

void validateSessionDescriptor(const QJsonObject &object, const QString &path,
                               Issues &issues, bool includesUserId) {
  requireUuid(object, QStringLiteral("channelId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  requireEnum(object, QStringLiteral("mode"), path,
              {QStringLiteral("music_listen"), QStringLiteral("music_publish"),
               QStringLiteral("stream_publish"), QStringLiteral("stream_watch"),
               QStringLiteral("voice")},
              issues);
  optionalUuid(object, QStringLiteral("streamId"), path, issues);
  if (includesUserId) {
    requireUuid(object, QStringLiteral("userId"), path, issues);
    if (object.contains(QStringLiteral("transportMode"))) {
      requireEnum(object, QStringLiteral("transportMode"), path,
                  {QStringLiteral("p2p"), QStringLiteral("sfu")}, issues);
    }
  }
  if (object.contains(QStringLiteral("mediaRegionId"))) {
    requireString(object, QStringLiteral("mediaRegionId"), path, issues);
  }
}

void validateSignalPayload(const QJsonValue &value, const QString &path,
                           Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  const QStringList types = {QStringLiteral("answer"), QStringLiteral("end"),
                             QStringLiteral("ice_candidate"), QStringLiteral("offer"),
                             QStringLiteral("restart_ice")};
  QString type;
  requireEnum(object, QStringLiteral("type"), path, types, issues, &type);
  QJsonObject session;
  if (requireObject(object.value(QStringLiteral("session")),
                    childPath(path, QStringLiteral("session")), issues, &session)) {
    validateSessionDescriptor(session, childPath(path, QStringLiteral("session")),
                              issues, true);
  }
  if (object.contains(QStringLiteral("sdp")) &&
      !object.value(QStringLiteral("sdp")).isString()) {
    issue(issues, childPath(path, QStringLiteral("sdp")),
          QStringLiteral("expected string"));
  }
  if (object.contains(QStringLiteral("candidate"))) {
    QJsonObject candidate;
    const auto candidatePath = childPath(path, QStringLiteral("candidate"));
    if (requireObject(object.value(QStringLiteral("candidate")), candidatePath,
                      issues, &candidate)) {
      requireString(candidate, QStringLiteral("candidate"), candidatePath, issues);
      const auto line = candidate.value(QStringLiteral("sdpMLineIndex"));
      if (!line.isNull()) {
        qint64 unused = 0;
        requireInteger(candidate, QStringLiteral("sdpMLineIndex"), candidatePath,
                       issues, 0, std::numeric_limits<int>::max(), &unused);
      }
      const auto mid = candidate.value(QStringLiteral("sdpMid"));
      if (!mid.isNull() && !mid.isString()) {
        issue(issues, childPath(candidatePath, QStringLiteral("sdpMid")),
              QStringLiteral("expected string or null"));
      }
    }
  }
}

void validateStreamSession(const QJsonValue &value, const QString &path,
                           Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireUuid(object, QStringLiteral("hostUserId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  optionalUuid(object, QStringLiteral("streamId"), path, issues);
  requireEnum(object, QStringLiteral("sourceType"), path,
              {QStringLiteral("screen"), QStringLiteral("camera")}, issues);
  requireEnum(object, QStringLiteral("status"), path,
              {QStringLiteral("failed"), QStringLiteral("idle"),
               QStringLiteral("live"), QStringLiteral("starting"),
               QStringLiteral("stopping")},
              issues);
}

void validateStreamViewer(const QJsonValue &value, const QString &path,
                          Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  requireUuid(object, QStringLiteral("userId"), path, issues);
}

void validateStreamPublication(const QJsonValue &value, const QString &path,
                               Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireUuid(object, QStringLiteral("channelId"), path, issues);
  requireUuid(object, QStringLiteral("hostUserId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  requireUuid(object, QStringLiteral("streamId"), path, issues);
  requireEnum(object, QStringLiteral("sourceType"), path,
              {QStringLiteral("screen"), QStringLiteral("camera")}, issues);
  requireEnum(object, QStringLiteral("status"), path,
              {QStringLiteral("failed"), QStringLiteral("idle"),
               QStringLiteral("live"), QStringLiteral("starting"),
               QStringLiteral("stopping")},
              issues);
  QJsonArray viewers;
  const auto viewersPath = childPath(path, QStringLiteral("viewers"));
  if (requireArray(object.value(QStringLiteral("viewers")), viewersPath, issues,
                   &viewers)) {
    for (qsizetype index = 0; index < viewers.size(); ++index) {
      validateStreamViewer(viewers.at(index),
                           QStringLiteral("%1[%2]").arg(viewersPath).arg(index),
                           issues);
    }
  }
}

void validateMusicPublication(const QJsonValue &value, const QString &path,
                              Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireUuid(object, QStringLiteral("channelId"), path, issues);
  requireUuid(object, QStringLiteral("hostUserId"), path, issues);
  requireUuid(object, QStringLiteral("musicId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  requireEnum(object, QStringLiteral("status"), path,
              {QStringLiteral("live"), QStringLiteral("starting"),
               QStringLiteral("stopping")},
              issues);
  QJsonArray listeners;
  const auto listenersPath = childPath(path, QStringLiteral("listeners"));
  if (requireArray(object.value(QStringLiteral("listeners")), listenersPath,
                   issues, &listeners)) {
    for (qsizetype index = 0; index < listeners.size(); ++index) {
      validateStreamViewer(
          listeners.at(index),
          QStringLiteral("%1[%2]").arg(listenersPath).arg(index), issues);
    }
  }
}

void validateSfuProducer(const QJsonValue &value, const QString &path,
                         Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireString(object, QStringLiteral("id"), path, issues);
  requireUuid(object, QStringLiteral("channelId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  requireUuid(object, QStringLiteral("userId"), path, issues);
  optionalUuid(object, QStringLiteral("streamId"), path, issues);
  requireEnum(object, QStringLiteral("kind"), path,
              {QStringLiteral("audio"), QStringLiteral("video")}, issues);
  requireEnum(object, QStringLiteral("source"), path,
              {QStringLiteral("music"), QStringLiteral("stream"), QStringLiteral("voice")},
              issues);
}

void validateSfuInfo(const QJsonValue &value, const QString &path,
                     Issues &issues) {
  QJsonObject object;
  if (!requireObject(value, path, issues, &object)) {
    return;
  }
  requireObject(object.value(QStringLiteral("routerRtpCapabilities")),
                childPath(path, QStringLiteral("routerRtpCapabilities")), issues);
  QJsonArray producers;
  const auto producersPath = childPath(path, QStringLiteral("producers"));
  if (requireArray(object.value(QStringLiteral("producers")), producersPath,
                   issues, &producers)) {
    for (qsizetype index = 0; index < producers.size(); ++index) {
      validateSfuProducer(
          producers.at(index),
          QStringLiteral("%1[%2]").arg(producersPath).arg(index), issues);
    }
  }
}

void validateMediaSessionAck(const QJsonObject &object, const QString &path,
                             Issues &issues) {
  requireUuid(object, QStringLiteral("channelId"), path, issues);
  requireUuid(object, QStringLiteral("sessionId"), path, issues);
  if (object.contains(QStringLiteral("mediaMode"))) {
    requireEnum(object, QStringLiteral("mediaMode"), path,
                {QStringLiteral("p2p"), QStringLiteral("sfu")}, issues);
  }
  QJsonArray iceServers;
  const auto icePath = childPath(path, QStringLiteral("iceServers"));
  if (requireArray(object.value(QStringLiteral("iceServers")), icePath, issues,
                   &iceServers)) {
    for (qsizetype index = 0; index < iceServers.size(); ++index) {
      validateIceServer(
          iceServers.at(index),
          QStringLiteral("%1[%2]").arg(icePath).arg(index), issues);
    }
  }
  if (object.contains(QStringLiteral("sfu"))) {
    validateSfuInfo(object.value(QStringLiteral("sfu")),
                    childPath(path, QStringLiteral("sfu")), issues);
  }
}

template <typename T, typename Validator, typename Builder>
ParseResult<T> parseWith(const QJsonValue &json, Validator validator,
                         Builder builder) {
  ParseResult<T> result;
  result.issues = validator(json);
  if (result.issues.isEmpty()) {
    result.value = builder(json.toObject());
  }
  return result;
}

Issues validateAuthTokens(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("tokens"), issues, &object)) {
    return issues;
  }
  requireString(object, QStringLiteral("accessToken"), QStringLiteral("tokens"), issues);
  requireString(object, QStringLiteral("refreshToken"), QStringLiteral("tokens"), issues);
  qint64 expires = 0;
  requireInteger(object, QStringLiteral("expiresInSeconds"), QStringLiteral("tokens"),
                 issues, 1, std::numeric_limits<int>::max(), &expires);
  return issues;
}

} // namespace

const QStringList &gatewayCommandNames() { return kGatewayCommands; }
const QStringList &gatewayEventNames() { return kGatewayEvents; }
const QStringList &errorCodes() { return kErrorCodes; }

bool isKnownGatewayCommand(const QString &name) {
  return kGatewayCommands.contains(name);
}

bool isKnownGatewayEvent(const QString &name) {
  return kGatewayEvents.contains(name);
}

bool isKnownErrorCode(const QString &code) { return kErrorCodes.contains(code); }

ParseResult<GatewayEnvelope> parseGatewayEnvelope(const QByteArray &json) {
  ParseResult<GatewayEnvelope> result;
  QJsonParseError error;
  const auto document = QJsonDocument::fromJson(json, &error);
  if (error.error != QJsonParseError::NoError) {
    result.issues.append(
        {QStringLiteral("$"), QStringLiteral("invalid JSON at offset %1: %2")
                                  .arg(error.offset)
                                  .arg(error.errorString())});
    return result;
  }
  if (!document.isObject()) {
    result.issues.append({QStringLiteral("$"), QStringLiteral("expected object")});
    return result;
  }
  return parseGatewayEnvelope(document.object());
}

ParseResult<GatewayEnvelope> parseGatewayEnvelope(const QJsonObject &object) {
  ParseResult<GatewayEnvelope> result;
  Issues &issues = result.issues;
  qint64 version = 0;
  requireInteger(object, QStringLiteral("v"), QString(), issues, 1, 1, &version);
  QDateTime timestamp;
  requireDate(object, QStringLiteral("ts"), QString(), issues, &timestamp);
  QString op;
  requireEnum(object, QStringLiteral("op"), QString(),
              {QStringLiteral("event"), QStringLiteral("command"),
               QStringLiteral("ack"), QStringLiteral("error"),
               QStringLiteral("ping"), QStringLiteral("pong")},
              issues, &op);

  GatewayEnvelope envelope;
  envelope.version = static_cast<int>(version);
  envelope.timestamp = timestamp;
  envelope.raw = object;

  if (op == QStringLiteral("event")) {
    envelope.op = GatewayOp::Event;
    requireEnum(object, QStringLiteral("event"), QString(), kGatewayEvents, issues,
                &envelope.event);
    requireInteger(object, QStringLiteral("seq"), QString(), issues, 0,
                   std::numeric_limits<qint64>::max(), &envelope.sequence);
    if (!object.contains(QStringLiteral("data"))) {
      issue(issues, QStringLiteral("data"), QStringLiteral("field is required"));
    } else {
      envelope.data = object.value(QStringLiteral("data"));
      issues.append(validateEventData(envelope.event, envelope.data));
    }
  } else if (op == QStringLiteral("command")) {
    envelope.op = GatewayOp::Command;
    requireEnum(object, QStringLiteral("command"), QString(), kGatewayCommands,
                issues, &envelope.command);
    requireString(object, QStringLiteral("reqId"), QString(), issues,
                  &envelope.requestId);
    if (!object.contains(QStringLiteral("data"))) {
      issue(issues, QStringLiteral("data"), QStringLiteral("field is required"));
    } else {
      envelope.data = object.value(QStringLiteral("data"));
      issues.append(validateCommandData(envelope.command, envelope.data));
    }
  } else if (op == QStringLiteral("ack")) {
    envelope.op = GatewayOp::Ack;
    requireString(object, QStringLiteral("reqId"), QString(), issues,
                  &envelope.requestId);
    envelope.data = object.value(QStringLiteral("data"));
  } else if (op == QStringLiteral("error")) {
    envelope.op = GatewayOp::Error;
    requireEnum(object, QStringLiteral("code"), QString(), kErrorCodes, issues,
                &envelope.errorCode);
    requireString(object, QStringLiteral("message"), QString(), issues,
                  &envelope.message);
    requireBool(object, QStringLiteral("retryable"), QString(), issues,
                &envelope.retryable);
    if (object.contains(QStringLiteral("reqId"))) {
      requireString(object, QStringLiteral("reqId"), QString(), issues,
                    &envelope.requestId);
    }
  } else {
    envelope.op = op == QStringLiteral("pong") ? GatewayOp::Pong : GatewayOp::Ping;
  }

  if (issues.isEmpty()) {
    result.value = envelope;
  }
  return result;
}

QJsonObject createCommandEnvelope(const QString &command, const QJsonValue &data,
                                  const QString &requestId,
                                  const QDateTime &timestamp) {
  return {
      {QStringLiteral("command"), command},
      {QStringLiteral("data"), data},
      {QStringLiteral("op"), QStringLiteral("command")},
      {QStringLiteral("reqId"), requestId},
      {QStringLiteral("ts"), timestamp.toUTC().toString(Qt::ISODateWithMs)},
      {QStringLiteral("v"), 1},
  };
}

QJsonObject createHeartbeatEnvelope(GatewayOp op, const QDateTime &timestamp) {
  Q_ASSERT(op == GatewayOp::Ping || op == GatewayOp::Pong);
  return {
      {QStringLiteral("op"),
       op == GatewayOp::Ping ? QStringLiteral("ping") : QStringLiteral("pong")},
      {QStringLiteral("ts"), timestamp.toUTC().toString(Qt::ISODateWithMs)},
      {QStringLiteral("v"), 1},
  };
}

QList<ValidationIssue> validateCommandData(const QString &command,
                                           const QJsonValue &data) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(data, QStringLiteral("data"), issues, &object)) {
    return issues;
  }
  const auto path = QStringLiteral("data");

  if (command == QStringLiteral("system.authenticate")) {
    requireString(object, QStringLiteral("accessToken"), path, issues);
  } else if (command == QStringLiteral("channel.subscribe") ||
             command == QStringLiteral("channel.unsubscribe") ||
             command == QStringLiteral("voice.join") ||
             command == QStringLiteral("voice.leave") ||
             command == QStringLiteral("music.start")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
  } else if (command.startsWith(QStringLiteral("media.signal."))) {
    requireUuid(object, QStringLiteral("targetUserId"), path, issues);
    validateSignalPayload(object.value(QStringLiteral("signal")),
                          childPath(path, QStringLiteral("signal")), issues);
  } else if (command.startsWith(QStringLiteral("media.sfu."))) {
    validateSessionDescriptor(object, path, issues, false);
    if (command == QStringLiteral("media.sfu.create_transport")) {
      requireEnum(object, QStringLiteral("direction"), path,
                  {QStringLiteral("recv"), QStringLiteral("send")}, issues);
    } else if (command == QStringLiteral("media.sfu.connect_transport")) {
      requireString(object, QStringLiteral("transportId"), path, issues);
      requireObject(object.value(QStringLiteral("dtlsParameters")),
                    childPath(path, QStringLiteral("dtlsParameters")), issues);
    } else if (command == QStringLiteral("media.sfu.produce")) {
      requireString(object, QStringLiteral("transportId"), path, issues);
      requireEnum(object, QStringLiteral("kind"), path,
                  {QStringLiteral("audio"), QStringLiteral("video")}, issues);
      requireObject(object.value(QStringLiteral("rtpParameters")),
                    childPath(path, QStringLiteral("rtpParameters")), issues);
    } else if (command == QStringLiteral("media.sfu.consume")) {
      requireString(object, QStringLiteral("transportId"), path, issues);
      requireString(object, QStringLiteral("producerId"), path, issues);
      requireObject(object.value(QStringLiteral("rtpCapabilities")),
                    childPath(path, QStringLiteral("rtpCapabilities")), issues);
    } else if (command == QStringLiteral("media.sfu.resume_consumer")) {
      requireString(object, QStringLiteral("consumerId"), path, issues);
    }
  } else if (command == QStringLiteral("music.listen") ||
             command == QStringLiteral("music.unlisten")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireUuid(object, QStringLiteral("musicId"), path, issues);
  } else if (command == QStringLiteral("music.stop")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    optionalUuid(object, QStringLiteral("musicId"), path, issues);
  } else if (command == QStringLiteral("stream.start")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireEnum(object, QStringLiteral("sourceType"), path,
                {QStringLiteral("screen"), QStringLiteral("camera")}, issues);
    if (object.contains(QStringLiteral("quality"))) {
      QJsonObject quality;
      const auto qualityPath = childPath(path, QStringLiteral("quality"));
      if (requireObject(object.value(QStringLiteral("quality")), qualityPath,
                        issues, &quality)) {
        qint64 frameRate = 0;
        qint64 bitrate = 0;
        requireInteger(quality, QStringLiteral("frameRate"), qualityPath, issues,
                       15, 60, &frameRate);
        if (frameRate != 15 && frameRate != 30 && frameRate != 60) {
          issue(issues, childPath(qualityPath, QStringLiteral("frameRate")),
                QStringLiteral("expected 15, 30, or 60"));
        }
        requireInteger(quality, QStringLiteral("bitrateKbps"), qualityPath, issues,
                       2000, 16000, &bitrate);
        const QList<qint64> allowed = {2000, 4000, 6000, 10000, 16000};
        if (!allowed.contains(bitrate)) {
          issue(issues, childPath(qualityPath, QStringLiteral("bitrateKbps")),
                QStringLiteral("unsupported bitrate"));
        }
        requireEnum(quality, QStringLiteral("resolution"), qualityPath,
                    {QStringLiteral("480p"), QStringLiteral("720p"),
                     QStringLiteral("1080p"), QStringLiteral("1440p")},
                    issues);
      }
    }
  } else if (command == QStringLiteral("stream.stop") ||
             command == QStringLiteral("stream.watch") ||
             command == QStringLiteral("stream.unwatch")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    optionalUuid(object, QStringLiteral("streamId"), path, issues);
  } else if (command == QStringLiteral("voice.speaking.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireBool(object, QStringLiteral("isMuted"), path, issues);
    requireBool(object, QStringLiteral("isSpeaking"), path, issues);
  } else if (command == QStringLiteral("voice.network.self_report")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireNumber(object, QStringLiteral("mediaSelfLossPct"), path, issues, 0, 100);
  }
  return issues;
}

QList<ValidationIssue> validateAckData(const QString &command,
                                       const QJsonValue &data) {
  Issues issues;
  QJsonObject object;
  const auto path = QStringLiteral("data");
  if (!requireObject(data, path, issues, &object)) {
    return issues;
  }

  if (command == QStringLiteral("system.authenticate")) {
    requireString(object, QStringLiteral("connectionId"), path, issues);
    requireUuid(object, QStringLiteral("userId"), path, issues);
  } else if (command == QStringLiteral("channel.subscribe") ||
             command == QStringLiteral("channel.unsubscribe")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireBool(object, QStringLiteral("subscribed"), path, issues);
  } else if (command == QStringLiteral("voice.join")) {
    const auto parsed = parseVoiceJoinAck(data);
    issues.append(parsed.issues);
  } else if (command == QStringLiteral("voice.leave")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
  } else if (command == QStringLiteral("voice.network.self_report")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireBool(object, QStringLiteral("accepted"), path, issues);
  } else if (command == QStringLiteral("voice.speaking.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireBool(object, QStringLiteral("isSpeaking"), path, issues);
  } else if (command == QStringLiteral("music.start")) {
    validateMediaSessionAck(object, path, issues);
    requireUuid(object, QStringLiteral("musicId"), path, issues);
  } else if (command == QStringLiteral("music.listen")) {
    validateMediaSessionAck(object, path, issues);
    requireUuid(object, QStringLiteral("musicId"), path, issues);
    requireUuid(object, QStringLiteral("hostSessionId"), path, issues);
    requireUuid(object, QStringLiteral("hostUserId"), path, issues);
  } else if (command == QStringLiteral("music.stop")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    optionalUuid(object, QStringLiteral("musicId"), path, issues);
  } else if (command == QStringLiteral("music.unlisten")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireUuid(object, QStringLiteral("musicId"), path, issues);
  } else if (command == QStringLiteral("stream.start")) {
    validateMediaSessionAck(object, path, issues);
    optionalUuid(object, QStringLiteral("streamId"), path, issues);
  } else if (command == QStringLiteral("stream.watch")) {
    validateMediaSessionAck(object, path, issues);
    requireUuid(object, QStringLiteral("hostSessionId"), path, issues);
    requireUuid(object, QStringLiteral("hostUserId"), path, issues);
    optionalUuid(object, QStringLiteral("streamId"), path, issues);
  } else if (command == QStringLiteral("stream.stop") ||
             command == QStringLiteral("stream.unwatch")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    optionalUuid(object, QStringLiteral("streamId"), path, issues);
  } else if (command == QStringLiteral("media.sfu.create_transport")) {
    requireEnum(object, QStringLiteral("direction"), path,
                {QStringLiteral("recv"), QStringLiteral("send")}, issues);
    QJsonObject transport;
    const auto transportPath =
        childPath(path, QStringLiteral("transportOptions"));
    if (requireObject(object.value(QStringLiteral("transportOptions")),
                      transportPath, issues, &transport)) {
      requireString(transport, QStringLiteral("id"), transportPath, issues);
      requireObject(transport.value(QStringLiteral("dtlsParameters")),
                    childPath(transportPath, QStringLiteral("dtlsParameters")),
                    issues);
      requireObject(transport.value(QStringLiteral("iceParameters")),
                    childPath(transportPath, QStringLiteral("iceParameters")),
                    issues);
      requireArray(transport.value(QStringLiteral("iceCandidates")),
                   childPath(transportPath, QStringLiteral("iceCandidates")),
                   issues);
      if (transport.contains(QStringLiteral("sctpParameters"))) {
        requireObject(
            transport.value(QStringLiteral("sctpParameters")),
            childPath(transportPath, QStringLiteral("sctpParameters")), issues);
      }
    }
  } else if (command == QStringLiteral("media.sfu.produce")) {
    requireString(object, QStringLiteral("producerId"), path, issues);
    validateSfuProducer(object.value(QStringLiteral("producer")),
                        childPath(path, QStringLiteral("producer")), issues);
  } else if (command == QStringLiteral("media.sfu.consume")) {
    requireString(object, QStringLiteral("consumerId"), path, issues);
    requireString(object, QStringLiteral("id"), path, issues);
    requireString(object, QStringLiteral("producerId"), path, issues);
    requireBool(object, QStringLiteral("producerPaused"), path, issues);
    requireString(object, QStringLiteral("type"), path, issues);
    requireEnum(object, QStringLiteral("kind"), path,
                {QStringLiteral("audio"), QStringLiteral("video")}, issues);
    requireObject(object.value(QStringLiteral("rtpParameters")),
                  childPath(path, QStringLiteral("rtpParameters")), issues);
  }
  return issues;
}

QList<ValidationIssue> validateEventData(const QString &event,
                                         const QJsonValue &data) {
  Issues issues;
  const bool hasTypedSchema =
      event == QStringLiteral("system.ready") ||
      event == QStringLiteral("presence.updated") ||
      event == QStringLiteral("chat.message.created") ||
      event == QStringLiteral("voice.state.updated") ||
      event == QStringLiteral("voice.roster.updated") ||
      event == QStringLiteral("voice.member.updated") ||
      event == QStringLiteral("voice.speaking.updated") ||
      event == QStringLiteral("voice.network.updated") ||
      event == QStringLiteral("media.signal") ||
      event == QStringLiteral("media.sfu.producer.added") ||
      event == QStringLiteral("media.sfu.producer.removed") ||
      event == QStringLiteral("media.mode.updated") ||
      event == QStringLiteral("system.notification") ||
      event == QStringLiteral("stream.session.updated") ||
      event == QStringLiteral("stream.state.updated") ||
      event == QStringLiteral("stream.viewer.joined") ||
      event == QStringLiteral("stream.viewer.left") ||
      event == QStringLiteral("music.state.updated");
  if (!hasTypedSchema) {
    return issues;
  }
  QJsonObject object;
  if (!requireObject(data, QStringLiteral("data"), issues, &object)) {
    return issues;
  }
  const auto path = QStringLiteral("data");

  if (event == QStringLiteral("system.ready")) {
    requireString(object, QStringLiteral("connectionId"), path, issues);
    requireDate(object, QStringLiteral("serverTime"), path, issues);
    QJsonObject capabilities;
    const auto capabilityPath = childPath(path, QStringLiteral("capabilities"));
    if (requireObject(object.value(QStringLiteral("capabilities")), capabilityPath,
                      issues, &capabilities)) {
      for (const auto &key : {QStringLiteral("chat"), QStringLiteral("presence"),
                              QStringLiteral("stream"), QStringLiteral("voice")}) {
        requireBool(capabilities, key, capabilityPath, issues);
      }
    }
  } else if (event == QStringLiteral("presence.updated")) {
    requireUuid(object, QStringLiteral("userId"), path, issues);
    qint64 unused = 0;
    requireInteger(object, QStringLiteral("connectionCount"), path, issues, 0,
                   std::numeric_limits<int>::max(), &unused);
    requireEnum(object, QStringLiteral("status"), path,
                {QStringLiteral("idle"), QStringLiteral("offline"),
                 QStringLiteral("online")},
                issues);
    if (!object.contains(QStringLiteral("username"))) {
      issue(issues, childPath(path, QStringLiteral("username")),
            QStringLiteral("field is required"));
    } else {
      optionalString(object, QStringLiteral("username"), path, issues, nullptr, true);
    }
  } else if (event == QStringLiteral("chat.message.created")) {
    auto realtimeMessage = object;
    realtimeMessage.insert(QStringLiteral("editedAt"), QJsonValue::Null);
    issues.append(validateMessage(realtimeMessage));
  } else if (event == QStringLiteral("voice.state.updated") ||
             event == QStringLiteral("voice.roster.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    QJsonArray participants;
    if (requireArray(object.value(QStringLiteral("participants")),
                     childPath(path, QStringLiteral("participants")), issues,
                     &participants)) {
      for (qsizetype index = 0; index < participants.size(); ++index) {
        validateVoiceParticipant(
            participants.at(index),
            QStringLiteral("%1.participants[%2]").arg(path).arg(index), issues);
      }
    }
  } else if (event == QStringLiteral("voice.member.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    validateVoiceParticipant(object.value(QStringLiteral("participant")),
                             childPath(path, QStringLiteral("participant")), issues);
  } else if (event == QStringLiteral("voice.speaking.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireUuid(object, QStringLiteral("userId"), path, issues);
    requireBool(object, QStringLiteral("isSpeaking"), path, issues);
  } else if (event == QStringLiteral("voice.network.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    QJsonArray participants;
    const auto participantsPath = childPath(path, QStringLiteral("participants"));
    if (requireArray(object.value(QStringLiteral("participants")), participantsPath,
                     issues, &participants)) {
      for (qsizetype index = 0; index < participants.size(); ++index) {
        const auto itemPath =
            QStringLiteral("%1[%2]").arg(participantsPath).arg(index);
        QJsonObject item;
        if (!requireObject(participants.at(index), itemPath, issues, &item)) {
          continue;
        }
        requireUuid(item, QStringLiteral("userId"), itemPath, issues);
        requireBool(item, QStringLiteral("stale"), itemPath, issues);
        requireDate(item, QStringLiteral("updatedAt"), itemPath, issues);
        requireNumber(item, QStringLiteral("gatewayLossPct"), itemPath, issues, 0,
                      100, nullptr, true);
        const auto rtt = item.value(QStringLiteral("gatewayRttMs"));
        if (!rtt.isNull()) {
          qint64 unused = 0;
          requireInteger(item, QStringLiteral("gatewayRttMs"), itemPath, issues, 0,
                         std::numeric_limits<int>::max(), &unused);
        }
        requireNumber(item, QStringLiteral("mediaSelfLossPct"), itemPath, issues, 0,
                      100, nullptr, true);
      }
    }
  } else if (event == QStringLiteral("media.signal")) {
    requireUuid(object, QStringLiteral("fromUserId"), path, issues);
    validateSignalPayload(object.value(QStringLiteral("signal")),
                          childPath(path, QStringLiteral("signal")), issues);
  } else if (event == QStringLiteral("media.sfu.producer.added") ||
             event == QStringLiteral("media.sfu.producer.removed")) {
    validateSfuProducer(object.value(QStringLiteral("producer")),
                        childPath(path, QStringLiteral("producer")), issues);
  } else if (event == QStringLiteral("media.mode.updated")) {
    requireEnum(object, QStringLiteral("mediaMode"), path,
                {QStringLiteral("p2p"), QStringLiteral("sfu")}, issues);
    requireEnum(object, QStringLiteral("reason"), path,
                {QStringLiteral("admin_changed")}, issues);
    QJsonArray channels;
    if (requireArray(object.value(QStringLiteral("affectedChannelIds")),
                     childPath(path, QStringLiteral("affectedChannelIds")), issues,
                     &channels)) {
      for (qsizetype index = 0; index < channels.size(); ++index) {
        if (!channels.at(index).isString() ||
            !validUuid(channels.at(index).toString())) {
          issue(issues,
                QStringLiteral("%1.affectedChannelIds[%2]").arg(path).arg(index),
                QStringLiteral("expected UUID"));
        }
      }
    }
  } else if (event == QStringLiteral("system.notification")) {
    requireEnum(object, QStringLiteral("level"), path,
                {QStringLiteral("error"), QStringLiteral("info"),
                 QStringLiteral("warning")},
                issues);
    requireString(object, QStringLiteral("message"), path, issues);
  } else if (event == QStringLiteral("stream.session.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    const auto session = object.value(QStringLiteral("session"));
    if (!session.isUndefined() && !session.isNull()) {
      validateStreamSession(session, childPath(path, QStringLiteral("session")),
                            issues);
    }
  } else if (event == QStringLiteral("stream.state.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    const auto session = object.value(QStringLiteral("session"));
    if (!session.isUndefined() && !session.isNull()) {
      validateStreamSession(session, childPath(path, QStringLiteral("session")),
                            issues);
    }
    const auto streamsValue = object.value(QStringLiteral("streams"));
    if (!streamsValue.isUndefined()) {
      QJsonArray streams;
      const auto streamsPath = childPath(path, QStringLiteral("streams"));
      if (requireArray(streamsValue, streamsPath, issues, &streams)) {
        for (qsizetype index = 0; index < streams.size(); ++index) {
          validateStreamPublication(
              streams.at(index),
              QStringLiteral("%1[%2]").arg(streamsPath).arg(index), issues);
        }
      }
    }
    const auto viewersValue = object.value(QStringLiteral("viewers"));
    if (!viewersValue.isUndefined()) {
      QJsonArray viewers;
      const auto viewersPath = childPath(path, QStringLiteral("viewers"));
      if (requireArray(viewersValue, viewersPath, issues, &viewers)) {
        for (qsizetype index = 0; index < viewers.size(); ++index) {
          validateStreamViewer(
              viewers.at(index),
              QStringLiteral("%1[%2]").arg(viewersPath).arg(index), issues);
        }
      }
    }
  } else if (event == QStringLiteral("music.state.updated")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    const auto publicationsValue =
        object.value(QStringLiteral("publications"));
    if (!publicationsValue.isUndefined()) {
      QJsonArray publications;
      const auto publicationsPath =
          childPath(path, QStringLiteral("publications"));
      if (requireArray(publicationsValue, publicationsPath, issues,
                       &publications)) {
        for (qsizetype index = 0; index < publications.size(); ++index) {
          validateMusicPublication(
              publications.at(index),
              QStringLiteral("%1[%2]").arg(publicationsPath).arg(index), issues);
        }
      }
    }
  } else if (event == QStringLiteral("stream.viewer.joined")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireUuid(object, QStringLiteral("sessionId"), path, issues);
    requireUuid(object, QStringLiteral("userId"), path, issues);
  } else if (event == QStringLiteral("stream.viewer.left")) {
    requireUuid(object, QStringLiteral("channelId"), path, issues);
    requireUuid(object, QStringLiteral("userId"), path, issues);
  }
  return issues;
}

QList<ValidationIssue> validateAuthUser(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  requireUuid(object, QStringLiteral("id"), QString(), issues);
  QString email;
  if (requireString(object, QStringLiteral("email"), QString(), issues, &email)) {
    static const QRegularExpression emailPattern(
        QStringLiteral("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"));
    if (!emailPattern.match(email).hasMatch()) {
      issue(issues, QStringLiteral("email"), QStringLiteral("expected email"));
    }
  }
  requireString(object, QStringLiteral("username"), QString(), issues, nullptr, false);
  return issues;
}

QList<ValidationIssue> validateAuthSession(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  auto tokenIssues = validateAuthTokens(object.value(QStringLiteral("tokens")));
  for (auto &tokenIssue : tokenIssues) {
    if (!tokenIssue.path.startsWith(QStringLiteral("tokens"))) {
      tokenIssue.path = childPath(QStringLiteral("tokens"), tokenIssue.path);
    }
  }
  issues.append(tokenIssues);
  auto userIssues = validateAuthUser(object.value(QStringLiteral("user")));
  for (auto &userIssue : userIssues) {
    userIssue.path = childPath(QStringLiteral("user"), userIssue.path);
  }
  issues.append(userIssues);
  return issues;
}

QList<ValidationIssue> validateHealthResponse(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  requireEnum(object, QStringLiteral("service"), QString(),
              {QStringLiteral("api"), QStringLiteral("gateway"),
               QStringLiteral("media"), QStringLiteral("web"),
               QStringLiteral("desktop")},
              issues);
  requireEnum(object, QStringLiteral("status"), QString(),
              {QStringLiteral("ok")}, issues);
  requireDate(object, QStringLiteral("timestamp"), QString(), issues);
  requireString(object, QStringLiteral("version"), QString(), issues);
  return issues;
}

QList<ValidationIssue> validatePublicServerConfig(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  requireBool(object, QStringLiteral("allowPublicRegistration"), QString(), issues);
  requireBool(object, QStringLiteral("webEnabled"), QString(), issues);
  qint64 unused = 0;
  requireInteger(object, QStringLiteral("appPort"), QString(), issues, 1, 65535,
                 &unused);
  requireInteger(object, QStringLiteral("webPort"), QString(), issues, 1, 65535,
                 &unused);
  QString serverName;
  if (requireString(object, QStringLiteral("serverName"), QString(), issues,
                    &serverName)) {
    validateLength(serverName, 1, 100, QStringLiteral("serverName"), issues);
  }
  if (object.contains(QStringLiteral("mediaMode"))) {
    requireEnum(object, QStringLiteral("mediaMode"), QString(),
                {QStringLiteral("p2p"), QStringLiteral("sfu")}, issues);
  }
  return issues;
}

QList<ValidationIssue> validateServiceManifest(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  requireDate(object, QStringLiteral("generatedAt"), QString(), issues);
  QJsonArray services;
  if (!requireArray(object.value(QStringLiteral("services")),
                    QStringLiteral("services"), issues, &services)) {
    return issues;
  }
  for (qsizetype index = 0; index < services.size(); ++index) {
    const auto path = QStringLiteral("services[%1]").arg(index);
    QJsonObject service;
    if (!requireObject(services.at(index), path, issues, &service)) {
      continue;
    }
    requireString(service, QStringLiteral("description"), path, issues);
    requireEnum(service, QStringLiteral("name"), path,
                {QStringLiteral("api"), QStringLiteral("gateway"),
                 QStringLiteral("media"), QStringLiteral("web"),
                 QStringLiteral("desktop")},
                issues);
    requireString(service, QStringLiteral("url"), path, issues);
  }
  return issues;
}

QList<ValidationIssue> validateGuildList(const QJsonValue &json) {
  Issues issues;
  QJsonArray items;
  if (!requireArray(json, QStringLiteral("$"), issues, &items)) {
    return issues;
  }
  for (qsizetype index = 0; index < items.size(); ++index) {
    const auto path = QStringLiteral("[%1]").arg(index);
    QJsonObject object;
    if (!requireObject(items.at(index), path, issues, &object)) {
      continue;
    }
    requireUuid(object, QStringLiteral("id"), path, issues);
    requireUuid(object, QStringLiteral("ownerUserId"), path, issues);
    QString name;
    if (requireString(object, QStringLiteral("name"), path, issues, &name)) {
      validateLength(name, 1, 100, childPath(path, QStringLiteral("name")), issues);
    }
    requireDate(object, QStringLiteral("createdAt"), path, issues);
  }
  return issues;
}

QList<ValidationIssue> validateChannelList(const QJsonValue &json) {
  Issues issues;
  QJsonArray items;
  if (!requireArray(json, QStringLiteral("$"), issues, &items)) {
    return issues;
  }
  for (qsizetype index = 0; index < items.size(); ++index) {
    const auto path = QStringLiteral("[%1]").arg(index);
    QJsonObject object;
    if (!requireObject(items.at(index), path, issues, &object)) {
      continue;
    }
    requireUuid(object, QStringLiteral("id"), path, issues);
    requireUuid(object, QStringLiteral("guildId"), path, issues);
    QString name;
    if (requireString(object, QStringLiteral("name"), path, issues, &name)) {
      validateLength(name, 1, 100, childPath(path, QStringLiteral("name")), issues);
    }
    qint64 unused = 0;
    requireInteger(object, QStringLiteral("position"), path, issues, 0,
                   std::numeric_limits<int>::max(), &unused);
    if (!object.contains(QStringLiteral("topic"))) {
      issue(issues, childPath(path, QStringLiteral("topic")),
            QStringLiteral("field is required"));
    } else {
      optionalString(object, QStringLiteral("topic"), path, issues, nullptr, true);
    }
    requireEnum(object, QStringLiteral("type"), path,
                {QStringLiteral("text"), QStringLiteral("voice")}, issues);
    requireEnum(object, QStringLiteral("voiceQuality"), path,
                {QStringLiteral("high"), QStringLiteral("standard")}, issues);
  }
  return issues;
}

QList<ValidationIssue> validateMessage(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  requireUuid(object, QStringLiteral("id"), QString(), issues);
  requireUuid(object, QStringLiteral("channelId"), QString(), issues);
  requireUuid(object, QStringLiteral("authorUserId"), QString(), issues);
  requireString(object, QStringLiteral("authorUsername"), QString(), issues, nullptr,
                false);
  QString content;
  if (requireString(object, QStringLiteral("content"), QString(), issues, &content)) {
    validateLength(content, 1, 4000, QStringLiteral("content"), issues);
  }
  requireEnum(object, QStringLiteral("kind"), QString(),
              {QStringLiteral("system"), QStringLiteral("text")}, issues);
  requireDate(object, QStringLiteral("createdAt"), QString(), issues);
  optionalDate(object, QStringLiteral("editedAt"), QString(), issues);
  return issues;
}

QList<ValidationIssue> validateMessagePage(const QJsonValue &json) {
  Issues issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return issues;
  }
  QJsonArray items;
  if (requireArray(object.value(QStringLiteral("items")), QStringLiteral("items"),
                   issues, &items)) {
    for (qsizetype index = 0; index < items.size(); ++index) {
      auto itemIssues = validateMessage(items.at(index));
      for (auto &itemIssue : itemIssues) {
        itemIssue.path =
            QStringLiteral("items[%1].%2").arg(index).arg(itemIssue.path);
      }
      issues.append(itemIssues);
    }
  }
  if (!object.contains(QStringLiteral("nextCursor"))) {
    issue(issues, QStringLiteral("nextCursor"),
          QStringLiteral("field is required"));
  } else {
    optionalUuid(object, QStringLiteral("nextCursor"), QString(), issues, nullptr,
                 true);
  }
  return issues;
}

ParseResult<AuthUser> parseAuthUser(const QJsonValue &json) {
  return parseWith<AuthUser>(
      json, validateAuthUser, [](const QJsonObject &object) {
        return AuthUser{object.value(QStringLiteral("id")).toString(),
                        object.value(QStringLiteral("email")).toString(),
                        object.value(QStringLiteral("username")).toString()};
      });
}

ParseResult<AuthSession> parseAuthSession(const QJsonValue &json) {
  return parseWith<AuthSession>(
      json, validateAuthSession, [](const QJsonObject &object) {
        const auto tokens = object.value(QStringLiteral("tokens")).toObject();
        const auto user = object.value(QStringLiteral("user")).toObject();
        return AuthSession{
            {tokens.value(QStringLiteral("accessToken")).toString(),
             tokens.value(QStringLiteral("refreshToken")).toString(),
             tokens.value(QStringLiteral("expiresInSeconds")).toInt()},
            {user.value(QStringLiteral("id")).toString(),
             user.value(QStringLiteral("email")).toString(),
             user.value(QStringLiteral("username")).toString()}};
      });
}

ParseResult<HealthResponse> parseHealthResponse(const QJsonValue &json) {
  return parseWith<HealthResponse>(
      json, validateHealthResponse, [](const QJsonObject &object) {
        QDateTime timestamp;
        parseDate(object.value(QStringLiteral("timestamp")).toString(), &timestamp);
        return HealthResponse{
            object.value(QStringLiteral("service")).toString(),
            object.value(QStringLiteral("status")).toString(), timestamp,
            object.value(QStringLiteral("version")).toString()};
      });
}

ParseResult<PublicServerConfig> parsePublicServerConfig(const QJsonValue &json) {
  return parseWith<PublicServerConfig>(
      json, validatePublicServerConfig, [](const QJsonObject &object) {
        return PublicServerConfig{
            object.value(QStringLiteral("allowPublicRegistration")).toBool(),
            object.value(QStringLiteral("appPort")).toInt(),
            object.value(QStringLiteral("mediaMode"))
                .toString(QStringLiteral("p2p")),
            object.value(QStringLiteral("serverName")).toString(),
            object.value(QStringLiteral("webEnabled")).toBool(),
            object.value(QStringLiteral("webPort")).toInt()};
      });
}

ParseResult<ServiceManifest> parseServiceManifest(const QJsonValue &json) {
  return parseWith<ServiceManifest>(
      json, validateServiceManifest, [](const QJsonObject &object) {
        ServiceManifest result;
        parseDate(object.value(QStringLiteral("generatedAt")).toString(),
                  &result.generatedAt);
        const auto services = object.value(QStringLiteral("services")).toArray();
        result.services.reserve(services.size());
        for (const auto &value : services) {
          const auto item = value.toObject();
          result.services.append(
              {item.value(QStringLiteral("description")).toString(),
               item.value(QStringLiteral("name")).toString(),
               item.value(QStringLiteral("url")).toString()});
        }
        return result;
      });
}

ParseResult<QList<GuildSummary>> parseGuildList(const QJsonValue &json) {
  ParseResult<QList<GuildSummary>> result;
  result.issues = validateGuildList(json);
  if (!result.issues.isEmpty()) {
    return result;
  }
  QList<GuildSummary> guilds;
  for (const auto &value : json.toArray()) {
    const auto object = value.toObject();
    QDateTime createdAt;
    parseDate(object.value(QStringLiteral("createdAt")).toString(), &createdAt);
    guilds.append({object.value(QStringLiteral("id")).toString(),
                   object.value(QStringLiteral("name")).toString(),
                   object.value(QStringLiteral("ownerUserId")).toString(),
                   createdAt});
  }
  result.value = guilds;
  return result;
}

ParseResult<QList<ChannelSummary>> parseChannelList(const QJsonValue &json) {
  ParseResult<QList<ChannelSummary>> result;
  result.issues = validateChannelList(json);
  if (!result.issues.isEmpty()) {
    return result;
  }
  QList<ChannelSummary> channels;
  for (const auto &value : json.toArray()) {
    const auto object = value.toObject();
    std::optional<QString> topic;
    if (!object.value(QStringLiteral("topic")).isNull()) {
      topic = object.value(QStringLiteral("topic")).toString();
    }
    channels.append(
        {object.value(QStringLiteral("id")).toString(),
         object.value(QStringLiteral("guildId")).toString(),
         object.value(QStringLiteral("name")).toString(),
         object.value(QStringLiteral("position")).toInt(), topic,
         object.value(QStringLiteral("type")).toString(),
         object.value(QStringLiteral("voiceQuality")).toString()});
  }
  result.value = channels;
  return result;
}

ParseResult<Message> parseMessage(const QJsonValue &json) {
  return parseWith<Message>(json, validateMessage, [](const QJsonObject &object) {
    QDateTime createdAt;
    parseDate(object.value(QStringLiteral("createdAt")).toString(), &createdAt);
    std::optional<QDateTime> editedAt;
    if (object.contains(QStringLiteral("editedAt")) &&
        !object.value(QStringLiteral("editedAt")).isNull()) {
      QDateTime parsedEditedAt;
      parseDate(object.value(QStringLiteral("editedAt")).toString(),
                &parsedEditedAt);
      editedAt = parsedEditedAt;
    }
    return Message{
        object.value(QStringLiteral("id")).toString(),
        object.value(QStringLiteral("channelId")).toString(),
        object.value(QStringLiteral("authorUserId")).toString(),
        object.value(QStringLiteral("authorUsername")).toString(),
        object.value(QStringLiteral("content")).toString(),
        object.value(QStringLiteral("kind")).toString(), createdAt, editedAt};
  });
}

ParseResult<MessagePage> parseMessagePage(const QJsonValue &json) {
  return parseWith<MessagePage>(
      json, validateMessagePage, [](const QJsonObject &object) {
        MessagePage page;
        for (const auto &value : object.value(QStringLiteral("items")).toArray()) {
          const auto parsed = parseMessage(value);
          if (parsed.value) {
            page.items.append(*parsed.value);
          }
        }
        if (!object.value(QStringLiteral("nextCursor")).isNull()) {
          page.nextCursor =
              object.value(QStringLiteral("nextCursor")).toString();
        }
        return page;
      });
}

ParseResult<VoiceJoinAck> parseVoiceJoinAck(const QJsonValue &json) {
  ParseResult<VoiceJoinAck> result;
  Issues &issues = result.issues;
  QJsonObject object;
  if (!requireObject(json, QStringLiteral("$"), issues, &object)) {
    return result;
  }
  VoiceJoinAck ack;
  requireUuid(object, QStringLiteral("channelId"), QString(), issues,
              &ack.channelId);
  requireUuid(object, QStringLiteral("sessionId"), QString(), issues,
              &ack.sessionId);
  if (object.contains(QStringLiteral("mediaMode"))) {
    requireEnum(object, QStringLiteral("mediaMode"), QString(),
                {QStringLiteral("p2p"), QStringLiteral("sfu")}, issues,
                &ack.mediaMode);
  }
  QJsonArray iceServers;
  if (requireArray(object.value(QStringLiteral("iceServers")),
                   QStringLiteral("iceServers"), issues, &iceServers)) {
    for (qsizetype index = 0; index < iceServers.size(); ++index) {
      IceServer server;
      validateIceServer(iceServers.at(index),
                        QStringLiteral("iceServers[%1]").arg(index), issues,
                        &server);
      ack.iceServers.append(server);
    }
  }
  QJsonArray participants;
  if (requireArray(object.value(QStringLiteral("participants")),
                   QStringLiteral("participants"), issues, &participants)) {
    for (qsizetype index = 0; index < participants.size(); ++index) {
      VoiceParticipant participant;
      validateVoiceParticipant(
          participants.at(index), QStringLiteral("participants[%1]").arg(index),
          issues, &participant);
      ack.participants.append(participant);
    }
  }
  if (object.contains(QStringLiteral("sfu"))) {
    if (object.value(QStringLiteral("sfu")).isObject()) {
      ack.sfu = object.value(QStringLiteral("sfu")).toObject();
      validateSfuInfo(object.value(QStringLiteral("sfu")),
                      QStringLiteral("sfu"), issues);
    } else {
      issue(issues, QStringLiteral("sfu"), QStringLiteral("expected object"));
    }
  }
  if (issues.isEmpty()) {
    result.value = ack;
  }
  return result;
}

} // namespace baker::protocol
