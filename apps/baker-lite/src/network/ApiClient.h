#pragma once

#include "../protocol/ProtocolTypes.h"

#include <QHash>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <QUrl>
#include <QUrlQuery>

#include <functional>

namespace baker::network {

struct ApiError {
  int httpStatus = 0;
  QNetworkReply::NetworkError networkError = QNetworkReply::NoError;
  QString code;
  QString message;
  QJsonValue details;
  bool retryable = false;
};

class ApiClient final : public QObject {
  Q_OBJECT

public:
  using AccessTokenProvider = std::function<QString()>;
  using Validator =
      std::function<QList<protocol::ValidationIssue>(const QJsonValue &)>;

  explicit ApiClient(QObject *parent = nullptr);
  explicit ApiClient(const QUrl &baseUrl, QObject *parent = nullptr);

  [[nodiscard]] QUrl baseUrl() const;
  [[nodiscard]] bool setBaseUrl(const QUrl &baseUrl, QString *error = nullptr);
  void setAccessTokenProvider(AccessTokenProvider provider);
  void setRequestTimeoutMs(int timeoutMs);
  [[nodiscard]] int requestTimeoutMs() const;

  quint64 getHealth();
  quint64 getServiceManifest();
  quint64 getPublicServerConfig();
  quint64 registerUser(const QString &email, const QString &password,
                       const QString &username);
  quint64 login(const QString &email, const QString &password);
  quint64 refresh(const QString &refreshToken);
  quint64 logout();
  quint64 me();
  quint64 updateMe(const QString &username);
  quint64 listGuilds();
  quint64 listChannels(const QString &guildId);
  quint64 listMessages(const QString &channelId,
                       const std::optional<QString> &before = std::nullopt,
                       int limit = 50);
  quint64 sendMessage(const QString &channelId, const QString &content);

  quint64 sendRequest(const QByteArray &method, const QString &path,
                      const QJsonValue &body, bool hasBody, bool authenticated,
                      Validator validator = {}, const QUrlQuery &query = {});
  void abortAll();

signals:
  void requestSucceeded(quint64 requestId, const QJsonValue &payload);
  void requestFailed(quint64 requestId, const baker::network::ApiError &error);
  void unauthorized(quint64 requestId, const baker::network::ApiError &error);

private:
  struct PendingRequest {
    quint64 id = 0;
    Validator validator;
  };

  quint64 rejectSoon(const QString &code, const QString &message);
  void handleReply(QNetworkReply *reply);
  [[nodiscard]] QUrl buildUrl(const QString &path,
                              const QUrlQuery &query = {}) const;

  QNetworkAccessManager network_;
  QHash<QNetworkReply *, PendingRequest> pending_;
  QUrl baseUrl_;
  AccessTokenProvider accessTokenProvider_;
  quint64 nextRequestId_ = 1;
  int requestTimeoutMs_ = 15000;
};

} // namespace baker::network

Q_DECLARE_METATYPE(baker::network::ApiError)
