#pragma once

#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QList>
#include <QString>
#include <QStringList>

#include <optional>

namespace baker::protocol {

struct ValidationIssue {
  QString path;
  QString message;
};

template <typename T>
struct ParseResult {
  std::optional<T> value;
  QList<ValidationIssue> issues;

  [[nodiscard]] explicit operator bool() const { return value.has_value(); }
  [[nodiscard]] QString errorString() const {
    QStringList parts;
    parts.reserve(issues.size());
    for (const auto &issue : issues) {
      parts.append(QStringLiteral("%1: %2").arg(issue.path, issue.message));
    }
    return parts.join(QStringLiteral("; "));
  }
};

enum class GatewayOp {
  Event,
  Command,
  Ack,
  Error,
  Ping,
  Pong,
};

struct GatewayEnvelope {
  GatewayOp op = GatewayOp::Event;
  int version = 1;
  QDateTime timestamp;
  QString event;
  QString command;
  QString requestId;
  qint64 sequence = -1;
  QString errorCode;
  QString message;
  bool retryable = false;
  QJsonValue data;
  QJsonObject raw;
};

struct AuthTokens {
  QString accessToken;
  QString refreshToken;
  int expiresInSeconds = 0;
};

struct AuthUser {
  QString id;
  QString email;
  QString username;
};

struct AuthSession {
  AuthTokens tokens;
  AuthUser user;
};

struct HealthResponse {
  QString service;
  QString status;
  QDateTime timestamp;
  QString version;
};

struct PublicServerConfig {
  bool allowPublicRegistration = false;
  int appPort = 0;
  QString mediaMode = QStringLiteral("p2p");
  QString serverName;
  bool webEnabled = false;
  int webPort = 0;
};

struct ServiceManifestItem {
  QString description;
  QString name;
  QString url;
};

struct ServiceManifest {
  QDateTime generatedAt;
  QList<ServiceManifestItem> services;
};

struct GuildSummary {
  QString id;
  QString name;
  QString ownerUserId;
  QDateTime createdAt;
};

struct ChannelSummary {
  QString id;
  QString guildId;
  QString name;
  int position = 0;
  std::optional<QString> topic;
  QString type;
  QString voiceQuality;
};

struct Message {
  QString id;
  QString channelId;
  QString authorUserId;
  QString authorUsername;
  QString content;
  QString kind;
  QDateTime createdAt;
  std::optional<QDateTime> editedAt;
};

struct MessagePage {
  QList<Message> items;
  std::optional<QString> nextCursor;
};

struct IceServer {
  QStringList urls;
  std::optional<QString> username;
  std::optional<QString> credential;
};

struct VoiceParticipant {
  QString userId;
  QString sessionId;
  bool isMuted = false;
};

struct VoiceJoinAck {
  QString channelId;
  QString sessionId;
  QString mediaMode = QStringLiteral("p2p");
  QList<IceServer> iceServers;
  QList<VoiceParticipant> participants;
  std::optional<QJsonObject> sfu;
};

[[nodiscard]] const QStringList &gatewayCommandNames();
[[nodiscard]] const QStringList &gatewayEventNames();
[[nodiscard]] const QStringList &errorCodes();
[[nodiscard]] bool isKnownGatewayCommand(const QString &name);
[[nodiscard]] bool isKnownGatewayEvent(const QString &name);
[[nodiscard]] bool isKnownErrorCode(const QString &code);

[[nodiscard]] ParseResult<GatewayEnvelope> parseGatewayEnvelope(const QByteArray &json);
[[nodiscard]] ParseResult<GatewayEnvelope> parseGatewayEnvelope(const QJsonObject &object);
[[nodiscard]] QJsonObject createCommandEnvelope(
    const QString &command,
    const QJsonValue &data,
    const QString &requestId,
    const QDateTime &timestamp = QDateTime::currentDateTimeUtc());
[[nodiscard]] QJsonObject createHeartbeatEnvelope(
    GatewayOp op,
    const QDateTime &timestamp = QDateTime::currentDateTimeUtc());

[[nodiscard]] QList<ValidationIssue> validateCommandData(
    const QString &command, const QJsonValue &data);
[[nodiscard]] QList<ValidationIssue> validateAckData(
    const QString &command, const QJsonValue &data);
[[nodiscard]] QList<ValidationIssue> validateEventData(
    const QString &event, const QJsonValue &data);

[[nodiscard]] ParseResult<AuthUser> parseAuthUser(const QJsonValue &json);
[[nodiscard]] ParseResult<AuthSession> parseAuthSession(const QJsonValue &json);
[[nodiscard]] ParseResult<HealthResponse> parseHealthResponse(const QJsonValue &json);
[[nodiscard]] ParseResult<PublicServerConfig> parsePublicServerConfig(const QJsonValue &json);
[[nodiscard]] ParseResult<ServiceManifest> parseServiceManifest(const QJsonValue &json);
[[nodiscard]] ParseResult<QList<GuildSummary>> parseGuildList(const QJsonValue &json);
[[nodiscard]] ParseResult<QList<ChannelSummary>> parseChannelList(const QJsonValue &json);
[[nodiscard]] ParseResult<Message> parseMessage(const QJsonValue &json);
[[nodiscard]] ParseResult<MessagePage> parseMessagePage(const QJsonValue &json);
[[nodiscard]] ParseResult<VoiceJoinAck> parseVoiceJoinAck(const QJsonValue &json);

[[nodiscard]] QList<ValidationIssue> validateAuthUser(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateAuthSession(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateHealthResponse(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validatePublicServerConfig(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateServiceManifest(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateGuildList(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateChannelList(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateMessage(const QJsonValue &json);
[[nodiscard]] QList<ValidationIssue> validateMessagePage(const QJsonValue &json);

} // namespace baker::protocol
