#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QString>

namespace baker::security {

[[nodiscard]] bool isSensitiveKey(const QString &key);
[[nodiscard]] QJsonValue redactJson(const QJsonValue &value);
[[nodiscard]] QJsonObject redactHeaders(const QJsonObject &headers);
[[nodiscard]] QString redactText(const QString &text);
[[nodiscard]] QByteArray redactText(const QByteArray &text);

} // namespace baker::security
