#include "AuthSession.h"

#include <QLoggingCategory>
#include <QUrl>

#include <limits>

Q_LOGGING_CATEGORY(authLog, "baker.lite.network.auth")

namespace baker::network {

AuthSession::AuthSession(ApiClient *apiClient,
                         security::CredentialStore *credentialStore,
                         QObject *parent)
    : QObject(parent), apiClient_(apiClient),
      credentialStore_(credentialStore) {
  Q_ASSERT(apiClient_);
  Q_ASSERT(credentialStore_);
  qRegisterMetaType<AuthSession::State>();
  qRegisterMetaType<protocol::AuthUser>();

  refreshTimer_.setSingleShot(true);
  connect(&refreshTimer_, &QTimer::timeout, this, &AuthSession::refreshNow);
  connect(apiClient_, &ApiClient::requestSucceeded, this,
          &AuthSession::onRequestSucceeded);
  connect(apiClient_, &ApiClient::requestFailed, this,
          &AuthSession::onRequestFailed);
  connect(apiClient_, &ApiClient::unauthorized, this,
          [this](quint64 requestId, const ApiError &) {
            if (!pending_.contains(requestId) &&
                state_ == State::Authenticated && !refreshToken_.isEmpty()) {
              refreshNow();
            }
          });
  apiClient_->setAccessTokenProvider([this]() { return accessToken_; });
}

AuthSession::State AuthSession::state() const { return state_; }

QString AuthSession::accessToken() const { return accessToken_; }

QString AuthSession::refreshToken() const { return refreshToken_; }

std::optional<protocol::AuthUser> AuthSession::user() const { return user_; }

QDateTime AuthSession::expiresAt() const { return expiresAt_; }

bool AuthSession::remembered() const { return remembered_; }

void AuthSession::login(const QString &email, const QString &password,
                        bool remember) {
  if (state_ == State::Authenticating || state_ == State::Refreshing) {
    return;
  }
  setState(State::Authenticating);
  const auto id = apiClient_->login(email, password);
  pending_.insert(id, {Action::Login, remember, email});
}

void AuthSession::registerUser(const QString &email, const QString &password,
                               const QString &username, bool remember) {
  if (state_ == State::Authenticating || state_ == State::Refreshing) {
    return;
  }
  setState(State::Authenticating);
  const auto id = apiClient_->registerUser(email, password, username);
  pending_.insert(id, {Action::Register, remember, email});
}

bool AuthSession::restoreRememberedSession(QString *error) {
  if (apiClient_->baseUrl().isEmpty()) {
    if (error) {
      *error = QStringLiteral("Server URL has not been configured.");
    }
    return false;
  }
  auto credential = credentialStore_->read(credentialKey(), error);
  if (!credential || credential->secret.isEmpty()) {
    return false;
  }
  remembered_ = true;
  rememberedEmail_ = credential->username;
  refreshToken_ = QString::fromUtf8(credential->secret);
  credential->secret.fill('\0');
  setState(State::Refreshing);
  const auto id = apiClient_->refresh(refreshToken_);
  pending_.insert(id, {Action::Restore, true, rememberedEmail_});
  return true;
}

void AuthSession::refreshNow() {
  if (refreshToken_.isEmpty() || state_ == State::Refreshing ||
      state_ == State::Authenticating) {
    return;
  }
  refreshTimer_.stop();
  setState(State::Refreshing);
  const auto id = apiClient_->refresh(refreshToken_);
  pending_.insert(id, {Action::Refresh, remembered_, rememberedEmail_});
}

void AuthSession::logout() {
  refreshTimer_.stop();
  if (accessToken_.isEmpty()) {
    clearLocalSession();
    emit loggedOut();
    return;
  }
  const auto id = apiClient_->logout();
  pending_.insert(id, {Action::Logout, false, {}});
  clearLocalSession();
  emit loggedOut();
}

void AuthSession::clearLocalSession(
    const bool forgetRememberedCredential) {
  refreshTimer_.stop();
  if (forgetRememberedCredential &&
      (remembered_ || !rememberedEmail_.isEmpty())) {
    QString error;
    if (!credentialStore_->remove(credentialKey(), &error) && !error.isEmpty()) {
      emit persistenceError(error);
    }
  }
  accessToken_.fill(QChar('\0'));
  refreshToken_.fill(QChar('\0'));
  accessToken_.clear();
  refreshToken_.clear();
  rememberedEmail_.clear();
  user_.reset();
  expiresAt_ = {};
  remembered_ = false;
  gatewayRefreshPending_ = false;
  setState(State::LoggedOut);
  emit sessionChanged();
}

void AuthSession::bindGateway(GatewayClient *gateway) {
  if (gateway_ == gateway) {
    return;
  }
  if (gateway_) {
    disconnect(gateway_, nullptr, this, nullptr);
  }
  gateway_ = gateway;
  if (!gateway_) {
    return;
  }
  gateway_->setAccessTokenProvider([this]() { return accessToken_; });
  connect(gateway_, &GatewayClient::authenticationExpired, this, [this]() {
    gatewayRefreshPending_ = true;
    refreshNow();
  });
  connect(gateway_, &GatewayClient::authenticationRequired, this, [this]() {
    if (accessToken_.isEmpty()) {
      emit sessionExpired();
    }
  });
}

void AuthSession::setState(State state) {
  if (state_ == state) {
    return;
  }
  state_ = state;
  emit stateChanged(state_);
}

void AuthSession::onRequestSucceeded(quint64 requestId,
                                     const QJsonValue &payload) {
  const auto iterator = pending_.find(requestId);
  if (iterator == pending_.end()) {
    return;
  }
  const auto action = iterator.value();
  pending_.erase(iterator);
  if (action.action == Action::Logout) {
    return;
  }

  const auto parsed = protocol::parseAuthSession(payload);
  if (!parsed) {
    ApiError error;
    error.code = QStringLiteral("INVALID_RESPONSE");
    error.message = parsed.errorString();
    if (action.action == Action::Login || action.action == Action::Register) {
      setState(accessToken_.isEmpty() ? State::LoggedOut : State::Authenticated);
      emit loginFailed(error);
    } else {
      clearLocalSession();
      emit sessionExpired();
    }
    return;
  }

  applySession(*parsed.value, action.remember, action.email);
  if (action.action == Action::Login || action.action == Action::Register) {
    emit loginSucceeded(parsed.value->user);
  } else {
    emit tokenRefreshed();
  }
  if (gatewayRefreshPending_ && gateway_) {
    gatewayRefreshPending_ = false;
    gateway_->reconnectNow();
  }
}

void AuthSession::onRequestFailed(quint64 requestId, const ApiError &error) {
  const auto iterator = pending_.find(requestId);
  if (iterator == pending_.end()) {
    return;
  }
  const auto action = iterator.value();
  pending_.erase(iterator);

  if (action.action == Action::Login || action.action == Action::Register) {
    setState(accessToken_.isEmpty() ? State::LoggedOut : State::Authenticated);
    emit loginFailed(error);
    return;
  }
  if (action.action == Action::Logout) {
    return;
  }

  const bool terminal =
      error.httpStatus == 401 || error.code == QStringLiteral("TOKEN_EXPIRED") ||
      error.code == QStringLiteral("TOKEN_INVALID") ||
      error.code == QStringLiteral("UNAUTHORIZED") ||
      error.code == QStringLiteral("INVALID_CREDENTIALS");
  if (terminal || accessToken_.isEmpty() ||
      QDateTime::currentDateTimeUtc() >= expiresAt_) {
    clearLocalSession();
    emit sessionExpired();
    return;
  }

  setState(State::Authenticated);
  refreshTimer_.start(30000);
  qCWarning(authLog) << "Token refresh failed; retry scheduled. HTTP status:"
                     << error.httpStatus << "code:" << error.code;
}

void AuthSession::applySession(const protocol::AuthSession &session,
                               bool remember, const QString &email) {
  accessToken_ = session.tokens.accessToken;
  refreshToken_ = session.tokens.refreshToken;
  user_ = session.user;
  expiresAt_ = QDateTime::currentDateTimeUtc().addSecs(
      session.tokens.expiresInSeconds);
  remembered_ = remember;
  rememberedEmail_ = email.isEmpty() ? session.user.email : email;
  setState(State::Authenticated);
  if (remembered_) {
    persistRefreshToken();
  } else {
    QString ignored;
    const bool removed = credentialStore_->remove(credentialKey(), &ignored);
    Q_UNUSED(removed)
  }
  scheduleRefresh();
  emit sessionChanged();
}

void AuthSession::scheduleRefresh() {
  refreshTimer_.stop();
  if (state_ != State::Authenticated || expiresAt_.isNull()) {
    return;
  }
  const auto remainingMs =
      QDateTime::currentDateTimeUtc().msecsTo(expiresAt_);
  const auto refreshInMs = qMax<qint64>(1000, remainingMs - 60000);
  refreshTimer_.start(
      static_cast<int>(qMin<qint64>(refreshInMs,
                                    std::numeric_limits<int>::max())));
}

void AuthSession::persistRefreshToken() {
  QString error;
  if (!credentialStore_->write(credentialKey(), rememberedEmail_,
                               refreshToken_.toUtf8(), &error)) {
    remembered_ = false;
    emit persistenceError(error);
  }
}

QString AuthSession::credentialKey() const {
  const auto normalized =
      apiClient_->baseUrl().adjusted(QUrl::StripTrailingSlash).toString(
          QUrl::FullyEncoded);
  return QStringLiteral("session:%1").arg(normalized);
}

} // namespace baker::network
