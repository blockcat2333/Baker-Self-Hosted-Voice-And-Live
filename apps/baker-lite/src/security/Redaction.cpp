#include "Redaction.h"

#include <QJsonArray>
#include <QRegularExpression>
#include <QSet>

namespace baker::security {
namespace {

const QString kReplacement = QStringLiteral("[REDACTED]");

QString normalizedKey(QString key) {
  key.remove(QRegularExpression(QStringLiteral("[^a-zA-Z0-9]")));
  return key.toLower();
}

} // namespace

bool isSensitiveKey(const QString &key) {
  static const QSet<QString> sensitive = {
      QStringLiteral("accesstoken"),    QStringLiteral("refreshtoken"),
      QStringLiteral("authorization"),  QStringLiteral("proxyauthorization"),
      QStringLiteral("password"),       QStringLiteral("adminpassword"),
      QStringLiteral("credential"),     QStringLiteral("credentials"),
      QStringLiteral("icepwd"),         QStringLiteral("secret"),
      QStringLiteral("clientsecret"),   QStringLiteral("cookie"),
      QStringLiteral("setcookie"),      QStringLiteral("token"),
  };
  return sensitive.contains(normalizedKey(key));
}

QJsonValue redactJson(const QJsonValue &value) {
  if (value.isObject()) {
    QJsonObject redacted;
    const auto object = value.toObject();
    for (auto iterator = object.begin(); iterator != object.end(); ++iterator) {
      redacted.insert(iterator.key(),
                      isSensitiveKey(iterator.key())
                          ? QJsonValue(kReplacement)
                          : redactJson(iterator.value()));
    }
    return redacted;
  }
  if (value.isArray()) {
    QJsonArray redacted;
    for (const auto &item : value.toArray()) {
      redacted.append(redactJson(item));
    }
    return redacted;
  }
  return value;
}

QJsonObject redactHeaders(const QJsonObject &headers) {
  return redactJson(headers).toObject();
}

QString redactText(const QString &text) {
  QString result = text;
  static const QList<QRegularExpression> patterns = {
      QRegularExpression(
          QStringLiteral("(?i)(Bearer\\s+)[A-Za-z0-9._~+/=-]+")),
      QRegularExpression(
          QStringLiteral("(?i)(\"(?:accessToken|refreshToken|password|credential|"
                         "icePwd|secret)\"\\s*:\\s*\")[^\"]*(\")")),
      QRegularExpression(
          QStringLiteral("(?i)((?:accessToken|refreshToken|password|credential|"
                         "icePwd|secret)\\s*[=:]\\s*)[^\\s,;]+")),
  };
  for (const auto &pattern : patterns) {
    result.replace(pattern, QStringLiteral("\\1[REDACTED]\\2"));
  }
  return result;
}

QByteArray redactText(const QByteArray &text) {
  return redactText(QString::fromUtf8(text)).toUtf8();
}

} // namespace baker::security
