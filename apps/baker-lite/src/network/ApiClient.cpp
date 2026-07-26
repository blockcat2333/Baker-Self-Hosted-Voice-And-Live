#include "ApiClient.h"

#include "../security/Redaction.h"

#include <QJsonDocument>
#include <QLoggingCategory>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSslError>
#include <QTimer>
#include <QUuid>

#include <utility>

Q_LOGGING_CATEGORY(apiLog, "baker.lite.network.api")

namespace baker::network {
namespace {

bool looksLikeEmail(const QString &email) {
  static const QRegularExpression pattern(
      QStringLiteral("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"));
  return pattern.match(email).hasMatch();
}

bool looksLikeUuid(const QString &value) {
  static const QRegularExpression pattern(
      QStringLiteral("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
                     "[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"));
  return pattern.match(value).hasMatch() && !QUuid(value).isNull();
}

QList<protocol::ValidationIssue> validateOk(const QJsonValue &value) {
  if (!value.isObject() ||
      value.toObject().value(QStringLiteral("ok")) != QJsonValue(true)) {
    return {{QStringLiteral("ok"), QStringLiteral("expected literal true")}};
  }
  return {};
}

ApiError parseApiError(int status, QNetworkReply::NetworkError networkError,
                       const QByteArray &body, const QString &fallback) {
  ApiError error;
  error.httpStatus = status;
  error.networkError = networkError;
  error.retryable = status == 408 || status == 425 || status == 429 ||
                    status >= 500 || status == 0;

  QJsonParseError parseError;
  const auto document = QJsonDocument::fromJson(body, &parseError);
  if (parseError.error == QJsonParseError::NoError && document.isObject()) {
    const auto object = document.object();
    error.code = object.value(QStringLiteral("code")).toString();
    error.message = object.value(QStringLiteral("message")).toString();
    error.details = object.value(QStringLiteral("details"));
  }
  if (error.code.isEmpty()) {
    error.code = status > 0 ? QStringLiteral("HTTP_%1").arg(status)
                            : QStringLiteral("NETWORK_ERROR");
  }
  if (error.message.isEmpty()) {
    error.message = fallback;
  }
  return error;
}

} // namespace

ApiClient::ApiClient(QObject *parent) : QObject(parent), network_(this) {
  qRegisterMetaType<ApiError>();
}

ApiClient::ApiClient(const QUrl &baseUrl, QObject *parent) : ApiClient(parent) {
  QString ignored;
  const bool configured = setBaseUrl(baseUrl, &ignored);
  Q_UNUSED(configured)
}

QUrl ApiClient::baseUrl() const { return baseUrl_; }

bool ApiClient::setBaseUrl(const QUrl &baseUrl, QString *error) {
  QUrl normalized = baseUrl.adjusted(QUrl::StripTrailingSlash |
                                     QUrl::NormalizePathSegments);
  const auto scheme = normalized.scheme().toLower();
  if (!normalized.isValid() || normalized.host().isEmpty() ||
      (scheme != QStringLiteral("http") && scheme != QStringLiteral("https"))) {
    if (error) {
      *error = QStringLiteral("Server URL must be an absolute http:// or https:// URL.");
    }
    return false;
  }
  normalized.setFragment({});
  normalized.setQuery(QString());
  baseUrl_ = normalized;
  return true;
}

void ApiClient::setAccessTokenProvider(AccessTokenProvider provider) {
  accessTokenProvider_ = std::move(provider);
}

void ApiClient::setRequestTimeoutMs(int timeoutMs) {
  requestTimeoutMs_ = qBound(1000, timeoutMs, 120000);
}

int ApiClient::requestTimeoutMs() const { return requestTimeoutMs_; }

quint64 ApiClient::getHealth() {
  return sendRequest("GET", QStringLiteral("/health"), {}, false, false,
                     protocol::validateHealthResponse);
}

quint64 ApiClient::getServiceManifest() {
  return sendRequest("GET", QStringLiteral("/v1/meta/services"), {}, false, false,
                     protocol::validateServiceManifest);
}

quint64 ApiClient::getPublicServerConfig() {
  return sendRequest("GET", QStringLiteral("/v1/meta/public-config"), {}, false,
                     false, protocol::validatePublicServerConfig);
}

quint64 ApiClient::registerUser(const QString &email, const QString &password,
                                const QString &username) {
  if (!looksLikeEmail(email)) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("A valid email address is required."));
  }
  if (password.size() < 8 || password.size() > 128) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Password length must be 8 to 128 characters."));
  }
  if (username.size() < 2 || username.size() > 32) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Username length must be 2 to 32 characters."));
  }
  return sendRequest(
      "POST", QStringLiteral("/v1/auth/register"),
      QJsonObject{{QStringLiteral("email"), email},
                  {QStringLiteral("password"), password},
                  {QStringLiteral("username"), username}},
      true, false, protocol::validateAuthSession);
}

quint64 ApiClient::login(const QString &email, const QString &password) {
  if (!looksLikeEmail(email)) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("A valid email address is required."));
  }
  if (password.size() < 8 || password.size() > 128) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Password length must be 8 to 128 characters."));
  }
  return sendRequest("POST", QStringLiteral("/v1/auth/login"),
                     QJsonObject{{QStringLiteral("email"), email},
                                 {QStringLiteral("password"), password}},
                     true, false, protocol::validateAuthSession);
}

quint64 ApiClient::refresh(const QString &refreshToken) {
  if (refreshToken.isEmpty()) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Refresh token is required."));
  }
  return sendRequest(
      "POST", QStringLiteral("/v1/auth/refresh"),
      QJsonObject{{QStringLiteral("refreshToken"), refreshToken}}, true, false,
      protocol::validateAuthSession);
}

quint64 ApiClient::logout() {
  return sendRequest("POST", QStringLiteral("/v1/auth/logout"), QJsonObject{}, true,
                     true, validateOk);
}

quint64 ApiClient::me() {
  return sendRequest("GET", QStringLiteral("/v1/auth/me"), {}, false, true,
                     protocol::validateAuthUser);
}

quint64 ApiClient::updateMe(const QString &username) {
  if (username.size() < 2 || username.size() > 32) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Username length must be 2 to 32 characters."));
  }
  return sendRequest(
      "PATCH", QStringLiteral("/v1/auth/me"),
      QJsonObject{{QStringLiteral("username"), username}}, true, true,
      protocol::validateAuthUser);
}

quint64 ApiClient::listGuilds() {
  return sendRequest("GET", QStringLiteral("/v1/guilds"), {}, false, true,
                     protocol::validateGuildList);
}

quint64 ApiClient::listChannels(const QString &guildId) {
  if (!looksLikeUuid(guildId)) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Guild ID must be a UUID."));
  }
  return sendRequest(
      "GET", QStringLiteral("/v1/guilds/%1/channels").arg(guildId), {}, false,
      true, protocol::validateChannelList);
}

quint64 ApiClient::listMessages(const QString &channelId,
                                const std::optional<QString> &before, int limit) {
  if (!looksLikeUuid(channelId) || (before && !looksLikeUuid(*before))) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Channel and cursor IDs must be UUIDs."));
  }
  if (limit < 1 || limit > 100) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Message limit must be 1 to 100."));
  }
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("limit"), QString::number(limit));
  if (before) {
    query.addQueryItem(QStringLiteral("before"), *before);
  }
  return sendRequest(
      "GET", QStringLiteral("/v1/channels/%1/messages").arg(channelId), {}, false,
      true, protocol::validateMessagePage, query);
}

quint64 ApiClient::sendMessage(const QString &channelId,
                               const QString &content) {
  if (!looksLikeUuid(channelId)) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Channel ID must be a UUID."));
  }
  if (content.isEmpty() || content.size() > 4000) {
    return rejectSoon(QStringLiteral("VALIDATION_ERROR"),
                      QStringLiteral("Message length must be 1 to 4000 characters."));
  }
  return sendRequest(
      "POST", QStringLiteral("/v1/channels/%1/messages").arg(channelId),
      QJsonObject{{QStringLiteral("content"), content}}, true, true,
      protocol::validateMessage);
}

quint64 ApiClient::sendRequest(const QByteArray &method, const QString &path,
                               const QJsonValue &body, bool hasBody,
                               bool authenticated, Validator validator,
                               const QUrlQuery &query) {
  if (baseUrl_.isEmpty()) {
    return rejectSoon(QStringLiteral("INVALID_SERVER_URL"),
                      QStringLiteral("Server URL has not been configured."));
  }

  const quint64 id = nextRequestId_++;
  QNetworkRequest request(buildUrl(path, query));
  request.setHeader(QNetworkRequest::UserAgentHeader,
                    QStringLiteral("Baker-Lite/1"));
  request.setRawHeader("Accept", "application/json");
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                       QNetworkRequest::NoLessSafeRedirectPolicy);
  request.setTransferTimeout(requestTimeoutMs_);
  if (hasBody) {
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                      QStringLiteral("application/json"));
  }
  if (authenticated) {
    const auto token = accessTokenProvider_ ? accessTokenProvider_() : QString();
    if (token.isEmpty()) {
      QTimer::singleShot(0, this, [this, id]() {
        ApiError error;
        error.code = QStringLiteral("UNAUTHORIZED");
        error.message = QStringLiteral("No access token is available.");
        emit requestFailed(id, error);
        emit unauthorized(id, error);
      });
      return id;
    }
    request.setRawHeader("Authorization",
                         QByteArrayLiteral("Bearer ") + token.toUtf8());
  }

  QByteArray encodedBody;
  if (hasBody) {
    encodedBody = body.isObject()
                      ? QJsonDocument(body.toObject()).toJson(QJsonDocument::Compact)
                      : QJsonDocument(body.toArray()).toJson(QJsonDocument::Compact);
  }
  auto *reply = network_.sendCustomRequest(request, method, encodedBody);
  pending_.insert(reply, {id, std::move(validator)});
  connect(reply, &QNetworkReply::finished, this,
          [this, reply]() { handleReply(reply); });
  connect(reply, &QNetworkReply::sslErrors, this,
          [id](const QList<QSslError> &errors) {
            QStringList messages;
            for (const auto &error : errors) {
              messages.append(error.errorString());
            }
            qCWarning(apiLog).noquote()
                << "TLS validation failed for request" << id << ":"
                << security::redactText(messages.join(QStringLiteral("; ")));
          });
  return id;
}

void ApiClient::abortAll() {
  const auto replies = pending_.keys();
  for (auto *reply : replies) {
    reply->abort();
  }
}

quint64 ApiClient::rejectSoon(const QString &code, const QString &message) {
  const quint64 id = nextRequestId_++;
  QTimer::singleShot(0, this, [this, id, code, message]() {
    ApiError error;
    error.code = code;
    error.message = message;
    emit requestFailed(id, error);
  });
  return id;
}

void ApiClient::handleReply(QNetworkReply *reply) {
  const auto pending = pending_.take(reply);
  const auto status =
      reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  const auto networkError = reply->error();
  const auto body = reply->readAll();
  const auto networkMessage = reply->errorString();
  reply->deleteLater();

  if (status < 200 || status >= 300 || networkError != QNetworkReply::NoError) {
    auto error = parseApiError(
        status, networkError, body,
        status > 0 ? QStringLiteral("HTTP request failed with status %1.").arg(status)
                   : networkMessage);
    qCWarning(apiLog).noquote()
        << "API request" << pending.id << "failed:"
        << security::redactText(error.code + QStringLiteral(": ") + error.message);
    emit requestFailed(pending.id, error);
    if (status == 401 || error.code == QStringLiteral("TOKEN_EXPIRED") ||
        error.code == QStringLiteral("TOKEN_INVALID") ||
        error.code == QStringLiteral("UNAUTHORIZED")) {
      emit unauthorized(pending.id, error);
    }
    return;
  }
  if (body.trimmed().isEmpty()) {
    ApiError error;
    error.httpStatus = status;
    error.code = QStringLiteral("INVALID_RESPONSE");
    error.message = QStringLiteral("Server returned an empty response.");
    emit requestFailed(pending.id, error);
    return;
  }

  QJsonParseError parseError;
  const auto document = QJsonDocument::fromJson(body, &parseError);
  if (parseError.error != QJsonParseError::NoError ||
      (!document.isObject() && !document.isArray())) {
    ApiError error;
    error.httpStatus = status;
    error.code = QStringLiteral("INVALID_RESPONSE");
    error.message =
        QStringLiteral("Server returned invalid JSON: %1").arg(parseError.errorString());
    emit requestFailed(pending.id, error);
    return;
  }
  const QJsonValue payload =
      document.isObject() ? QJsonValue(document.object()) : QJsonValue(document.array());
  if (pending.validator) {
    const auto issues = pending.validator(payload);
    if (!issues.isEmpty()) {
      QStringList details;
      for (const auto &issue : issues) {
        details.append(QStringLiteral("%1: %2").arg(issue.path, issue.message));
      }
      ApiError error;
      error.httpStatus = status;
      error.code = QStringLiteral("INVALID_RESPONSE");
      error.message =
          QStringLiteral("Response did not match the Baker protocol: %1")
              .arg(details.join(QStringLiteral("; ")));
      emit requestFailed(pending.id, error);
      return;
    }
  }
  emit requestSucceeded(pending.id, payload);
}

QUrl ApiClient::buildUrl(const QString &path, const QUrlQuery &query) const {
  QUrl relative(path);
  auto result = baseUrl_.resolved(relative);
  if (!query.isEmpty()) {
    result.setQuery(query);
  }
  return result;
}

} // namespace baker::network
