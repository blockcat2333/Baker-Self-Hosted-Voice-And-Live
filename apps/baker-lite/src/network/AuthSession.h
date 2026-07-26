#pragma once

#include "ApiClient.h"
#include "GatewayClient.h"
#include "../security/CredentialStore.h"

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QTimer>

namespace baker::network {

class AuthSession final : public QObject {
  Q_OBJECT

public:
  enum class State {
    LoggedOut,
    Authenticating,
    Refreshing,
    Authenticated,
  };
  Q_ENUM(State)

  explicit AuthSession(ApiClient *apiClient,
                       security::CredentialStore *credentialStore,
                       QObject *parent = nullptr);

  [[nodiscard]] State state() const;
  [[nodiscard]] QString accessToken() const;
  [[nodiscard]] QString refreshToken() const;
  [[nodiscard]] std::optional<protocol::AuthUser> user() const;
  [[nodiscard]] QDateTime expiresAt() const;
  [[nodiscard]] bool remembered() const;

  void login(const QString &email, const QString &password, bool remember);
  void registerUser(const QString &email, const QString &password,
                    const QString &username, bool remember);
  [[nodiscard]] bool restoreRememberedSession(QString *error = nullptr);
  void refreshNow();
  void logout();
  void clearLocalSession(bool forgetRememberedCredential = true);
  void bindGateway(GatewayClient *gateway);

signals:
  void stateChanged(baker::network::AuthSession::State state);
  void sessionChanged();
  void loginSucceeded(const baker::protocol::AuthUser &user);
  void loginFailed(const baker::network::ApiError &error);
  void tokenRefreshed();
  void sessionExpired();
  void loggedOut();
  void persistenceError(const QString &message);

private:
  enum class Action {
    Login,
    Register,
    Refresh,
    Restore,
    Logout,
  };

  struct PendingAction {
    Action action;
    bool remember = false;
    QString email;
  };

  void setState(State state);
  void onRequestSucceeded(quint64 requestId, const QJsonValue &payload);
  void onRequestFailed(quint64 requestId, const ApiError &error);
  void applySession(const protocol::AuthSession &session, bool remember,
                    const QString &email);
  void scheduleRefresh();
  void persistRefreshToken();
  [[nodiscard]] QString credentialKey() const;

  ApiClient *apiClient_;
  security::CredentialStore *credentialStore_;
  QPointer<GatewayClient> gateway_;
  QHash<quint64, PendingAction> pending_;
  QTimer refreshTimer_;
  State state_ = State::LoggedOut;
  std::optional<protocol::AuthUser> user_;
  QString accessToken_;
  QString refreshToken_;
  QString rememberedEmail_;
  QDateTime expiresAt_;
  bool remembered_ = false;
  bool gatewayRefreshPending_ = false;
};

} // namespace baker::network

Q_DECLARE_METATYPE(baker::network::AuthSession::State)
Q_DECLARE_METATYPE(baker::protocol::AuthUser)
