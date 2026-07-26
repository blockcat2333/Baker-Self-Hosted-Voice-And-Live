#include "../../src/protocol/ProtocolTypes.h"
#include "../../src/security/Redaction.h"

#include <QJsonDocument>
#include <QtTest>

using namespace baker;

class ProtocolTypesTest final : public QObject {
  Q_OBJECT

private slots:
  void parsesValidReadyEnvelope();
  void rejectsMissingAndInvalidEnvelopeFields();
  void validatesCommandPayloads();
  void parsesAuthSession();
  void redactsNestedSecrets();
};

void ProtocolTypesTest::parsesValidReadyEnvelope() {
  const QJsonObject envelope{
      {QStringLiteral("data"),
       QJsonObject{
           {QStringLiteral("capabilities"),
            QJsonObject{{QStringLiteral("chat"), true},
                        {QStringLiteral("presence"), true},
                        {QStringLiteral("stream"), true},
                        {QStringLiteral("voice"), true}}},
           {QStringLiteral("connectionId"), QStringLiteral("connection-1")},
           {QStringLiteral("serverTime"),
            QStringLiteral("2026-07-25T12:00:00.000Z")}}},
      {QStringLiteral("event"), QStringLiteral("system.ready")},
      {QStringLiteral("op"), QStringLiteral("event")},
      {QStringLiteral("seq"), 0},
      {QStringLiteral("ts"), QStringLiteral("2026-07-25T12:00:00.000Z")},
      {QStringLiteral("v"), 1},
  };

  const auto result = protocol::parseGatewayEnvelope(envelope);
  QVERIFY2(result, qPrintable(result.errorString()));
  QCOMPARE(result.value->op, protocol::GatewayOp::Event);
  QCOMPARE(result.value->event, QStringLiteral("system.ready"));
  QCOMPARE(result.value->sequence, 0);
}

void ProtocolTypesTest::rejectsMissingAndInvalidEnvelopeFields() {
  QJsonObject envelope{
      {QStringLiteral("data"), QJsonObject{}},
      {QStringLiteral("event"), QStringLiteral("not.an.event")},
      {QStringLiteral("op"), QStringLiteral("event")},
      {QStringLiteral("seq"), -1},
      {QStringLiteral("ts"), QStringLiteral("not-a-date")},
      {QStringLiteral("v"), 2},
  };
  const auto result = protocol::parseGatewayEnvelope(envelope);
  QVERIFY(!result);
  QVERIFY(result.errorString().contains(QStringLiteral("unsupported value")));
  QVERIFY(result.errorString().contains(QStringLiteral("ISO-8601")));
}

void ProtocolTypesTest::validatesCommandPayloads() {
  const QString channelId = QStringLiteral("11111111-1111-4111-8111-111111111111");
  QVERIFY(protocol::validateCommandData(
              QStringLiteral("voice.speaking.updated"),
              QJsonObject{{QStringLiteral("channelId"), channelId},
                          {QStringLiteral("isMuted"), false},
                          {QStringLiteral("isSpeaking"), true}})
              .isEmpty());

  const auto invalid = protocol::validateCommandData(
      QStringLiteral("stream.start"),
      QJsonObject{{QStringLiteral("channelId"), channelId},
                  {QStringLiteral("sourceType"), QStringLiteral("desktop")},
                  {QStringLiteral("quality"),
                   QJsonObject{{QStringLiteral("bitrateKbps"), 1234},
                               {QStringLiteral("frameRate"), 24},
                               {QStringLiteral("resolution"),
                                QStringLiteral("4k")}}}});
  QVERIFY(invalid.size() >= 4);
}

void ProtocolTypesTest::parsesAuthSession() {
  const auto json = QJsonObject{
      {QStringLiteral("tokens"),
       QJsonObject{{QStringLiteral("accessToken"), QStringLiteral("access")},
                   {QStringLiteral("expiresInSeconds"), 900},
                   {QStringLiteral("refreshToken"), QStringLiteral("refresh")}}},
      {QStringLiteral("user"),
       QJsonObject{
           {QStringLiteral("email"), QStringLiteral("baker@example.test")},
           {QStringLiteral("id"),
            QStringLiteral("22222222-2222-4222-8222-222222222222")},
           {QStringLiteral("username"), QStringLiteral("Baker")}}},
  };
  const auto parsed = protocol::parseAuthSession(json);
  QVERIFY2(parsed, qPrintable(parsed.errorString()));
  QCOMPARE(parsed.value->tokens.expiresInSeconds, 900);
  QCOMPARE(parsed.value->user.username, QStringLiteral("Baker"));
}

void ProtocolTypesTest::redactsNestedSecrets() {
  const QJsonObject source{
      {QStringLiteral("accessToken"), QStringLiteral("access-secret")},
      {QStringLiteral("nested"),
       QJsonObject{{QStringLiteral("credential"), QStringLiteral("turn-secret")},
                   {QStringLiteral("safe"), QStringLiteral("visible")}}},
  };
  const auto redacted = security::redactJson(source).toObject();
  QCOMPARE(redacted.value(QStringLiteral("accessToken")).toString(),
           QStringLiteral("[REDACTED]"));
  QCOMPARE(redacted.value(QStringLiteral("nested"))
               .toObject()
               .value(QStringLiteral("credential"))
               .toString(),
           QStringLiteral("[REDACTED]"));
  QCOMPARE(redacted.value(QStringLiteral("nested"))
               .toObject()
               .value(QStringLiteral("safe"))
               .toString(),
           QStringLiteral("visible"));
  const auto text =
      security::redactText(QStringLiteral("Authorization: Bearer abc.def.ghi"));
  QVERIFY(!text.contains(QStringLiteral("abc.def.ghi")));
}

QTEST_MAIN(ProtocolTypesTest)
#include "tst_ProtocolTypes.moc"
