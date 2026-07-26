#include "CredentialStore.h"

#include <QCryptographicHash>
#include <QMutexLocker>

#include <utility>

#ifdef Q_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <wincred.h>
#endif

namespace baker::security {
namespace {

void setError(QString *destination, const QString &message) {
  if (destination) {
    *destination = message;
  }
}

#ifdef Q_OS_WIN
QString windowsErrorMessage(DWORD code) {
  wchar_t *buffer = nullptr;
  const DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, code, 0, reinterpret_cast<wchar_t *>(&buffer), 0, nullptr);
  const QString message =
      length > 0 ? QString::fromWCharArray(buffer, static_cast<qsizetype>(length)).trimmed()
                 : QStringLiteral("Windows error %1").arg(code);
  if (buffer) {
    LocalFree(buffer);
  }
  return message;
}
#endif

} // namespace

CredentialStore::CredentialStore(QString applicationName)
    : applicationName_(std::move(applicationName)) {}

CredentialStore::~CredentialStore() { clearVolatile(); }

QString CredentialStore::targetName(const QString &key) const {
  const auto digest =
      QCryptographicHash::hash(key.toUtf8(), QCryptographicHash::Sha256).toHex();
  return QStringLiteral("%1:%2").arg(applicationName_, QString::fromLatin1(digest));
}

bool CredentialStore::write(const QString &key, const QString &username,
                            const QByteArray &secret, QString *error) {
  if (key.isEmpty()) {
    setError(error, QStringLiteral("Credential key must not be empty."));
    return false;
  }
  if (secret.isEmpty()) {
    setError(error, QStringLiteral("Credential secret must not be empty."));
    return false;
  }
#ifdef Q_OS_WIN
  if (secret.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
    setError(error, QStringLiteral("Credential secret is too large."));
    return false;
  }

  const auto target = targetName(key).toStdWString();
  const auto user = username.toStdWString();
  QByteArray blob = secret;
  CREDENTIALW credential{};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = const_cast<LPWSTR>(target.c_str());
  credential.UserName = const_cast<LPWSTR>(user.c_str());
  credential.CredentialBlobSize = static_cast<DWORD>(blob.size());
  credential.CredentialBlob =
      reinterpret_cast<LPBYTE>(blob.data());
  credential.Persist = CRED_PERSIST_LOCAL_MACHINE;

  const BOOL written = CredWriteW(&credential, 0);
  SecureZeroMemory(blob.data(), static_cast<SIZE_T>(blob.size()));
  if (!written) {
    setError(error, windowsErrorMessage(GetLastError()));
    return false;
  }
  return true;
#else
  QMutexLocker lock(&mutex_);
  volatileCredentials_.insert(targetName(key), {username, secret});
  return true;
#endif
}

std::optional<CredentialRecord>
CredentialStore::read(const QString &key, QString *error) const {
  if (key.isEmpty()) {
    setError(error, QStringLiteral("Credential key must not be empty."));
    return std::nullopt;
  }
#ifdef Q_OS_WIN
  const auto target = targetName(key).toStdWString();
  PCREDENTIALW credential = nullptr;
  if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
    const auto code = GetLastError();
    if (code != ERROR_NOT_FOUND) {
      setError(error, windowsErrorMessage(code));
    }
    return std::nullopt;
  }

  CredentialRecord result;
  if (credential->UserName) {
    result.username = QString::fromWCharArray(credential->UserName);
  }
  if (credential->CredentialBlob && credential->CredentialBlobSize > 0) {
    result.secret =
        QByteArray(reinterpret_cast<const char *>(credential->CredentialBlob),
                   static_cast<qsizetype>(credential->CredentialBlobSize));
  }
  CredFree(credential);
  return result;
#else
  QMutexLocker lock(&mutex_);
  const auto iterator = volatileCredentials_.constFind(targetName(key));
  if (iterator == volatileCredentials_.constEnd()) {
    return std::nullopt;
  }
  return iterator.value();
#endif
}

bool CredentialStore::remove(const QString &key, QString *error) {
  if (key.isEmpty()) {
    setError(error, QStringLiteral("Credential key must not be empty."));
    return false;
  }
#ifdef Q_OS_WIN
  const auto target = targetName(key).toStdWString();
  if (!CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0)) {
    const auto code = GetLastError();
    if (code != ERROR_NOT_FOUND) {
      setError(error, windowsErrorMessage(code));
      return false;
    }
  }
  return true;
#else
  QMutexLocker lock(&mutex_);
  auto iterator = volatileCredentials_.find(targetName(key));
  if (iterator != volatileCredentials_.end()) {
    iterator->secret.fill('\0');
    volatileCredentials_.erase(iterator);
  }
  return true;
#endif
}

void CredentialStore::clearVolatile() {
#ifndef Q_OS_WIN
  QMutexLocker lock(&mutex_);
  for (auto &credential : volatileCredentials_) {
    credential.secret.fill('\0');
  }
  volatileCredentials_.clear();
#endif
}

bool CredentialStore::isPersistent() const {
#ifdef Q_OS_WIN
  return true;
#else
  return false;
#endif
}

} // namespace baker::security
