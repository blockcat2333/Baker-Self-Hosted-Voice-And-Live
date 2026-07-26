#pragma once

#include <QByteArray>
#include <QHash>
#include <QMutex>
#include <QString>

#include <optional>

namespace baker::security {

struct CredentialRecord {
  QString username;
  QByteArray secret;
};

class CredentialStore {
public:
  explicit CredentialStore(QString applicationName = QStringLiteral("BakerLite"));
  ~CredentialStore();

  CredentialStore(const CredentialStore &) = delete;
  CredentialStore &operator=(const CredentialStore &) = delete;

  [[nodiscard]] bool write(const QString &key, const QString &username,
                           const QByteArray &secret, QString *error = nullptr);
  [[nodiscard]] std::optional<CredentialRecord>
  read(const QString &key, QString *error = nullptr) const;
  [[nodiscard]] bool remove(const QString &key, QString *error = nullptr);
  void clearVolatile();

  [[nodiscard]] bool isPersistent() const;

private:
  [[nodiscard]] QString targetName(const QString &key) const;

  QString applicationName_;
#ifndef Q_OS_WIN
  mutable QMutex mutex_;
  QHash<QString, CredentialRecord> volatileCredentials_;
#endif
};

} // namespace baker::security
