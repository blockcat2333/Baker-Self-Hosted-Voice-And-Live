#include "../../src/network/ApiClient.h"
#include "../../src/network/GatewayClient.h"

#include <QJsonDocument>
#include <QPointer>
#include <QSignalSpy>
#include <QTcpServer>
#include <QTcpSocket>
#include <QWebSocket>
#include <QWebSocketServer>
#include <QtTest>

using namespace baker;

class NetworkClientsTest final : public QObject {
  Q_OBJECT

private slots:
  void apiClientValidatesResponse();
  void gatewayAuthenticatesAndCorrelatesAck();
  void gatewayCommandTimesOut();
  void reconnectDelayIsBounded();
};

void NetworkClientsTest::apiClientValidatesResponse() {
  QTcpServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost, 0));
  connect(&server, &QTcpServer::newConnection, &server, [&server]() {
    auto *socket = server.nextPendingConnection();
    QObject::connect(socket, &QTcpSocket::readyRead, socket, [socket]() {
      const auto request = socket->readAll();
      if (!request.contains("\r\n\r\n")) {
        return;
      }
      const QByteArray body =
          R"({"service":"api","status":"ok","timestamp":"2026-07-25T12:00:00.000Z","version":"1.2.3"})";
      const QByteArray response =
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
          QByteArray::number(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
      socket->write(response);
      socket->disconnectFromHost();
    });
  });

  network::ApiClient client(
      QUrl(QStringLiteral("http://127.0.0.1:%1").arg(server.serverPort())));
  QSignalSpy succeeded(&client, &network::ApiClient::requestSucceeded);
  QSignalSpy failed(&client, &network::ApiClient::requestFailed);
  const auto requestId = client.getHealth();
  QTRY_COMPARE_WITH_TIMEOUT(succeeded.count(), 1, 3000);
  QCOMPARE(failed.count(), 0);
  QCOMPARE(succeeded.at(0).at(0).toULongLong(), requestId);

  const auto parsed =
      protocol::parseHealthResponse(succeeded.at(0).at(1).toJsonValue());
  QVERIFY(parsed);
  QCOMPARE(parsed.value->version, QStringLiteral("1.2.3"));
}

namespace {

QJsonObject readyEnvelope(qint64 sequence = 0) {
  return {
      {QStringLiteral("data"),
       QJsonObject{
           {QStringLiteral("capabilities"),
            QJsonObject{{QStringLiteral("chat"), true},
                        {QStringLiteral("presence"), true},
                        {QStringLiteral("stream"), true},
                        {QStringLiteral("voice"), true}}},
           {QStringLiteral("connectionId"), QStringLiteral("connection-test")},
           {QStringLiteral("serverTime"),
            QStringLiteral("2026-07-25T12:00:00.000Z")}}},
      {QStringLiteral("event"), QStringLiteral("system.ready")},
      {QStringLiteral("op"), QStringLiteral("event")},
      {QStringLiteral("seq"), sequence},
      {QStringLiteral("ts"), QStringLiteral("2026-07-25T12:00:00.000Z")},
      {QStringLiteral("v"), 1},
  };
}

QJsonObject ackEnvelope(const QString &requestId,
                        const QJsonValue &data = QJsonObject{}) {
  return {
      {QStringLiteral("data"), data},
      {QStringLiteral("op"), QStringLiteral("ack")},
      {QStringLiteral("reqId"), requestId},
      {QStringLiteral("ts"), QStringLiteral("2026-07-25T12:00:00.000Z")},
      {QStringLiteral("v"), 1},
  };
}

void sendJson(QWebSocket *socket, const QJsonObject &object) {
  socket->sendTextMessage(QString::fromUtf8(
      QJsonDocument(object).toJson(QJsonDocument::Compact)));
}

} // namespace

void NetworkClientsTest::gatewayAuthenticatesAndCorrelatesAck() {
  QWebSocketServer server(QStringLiteral("Baker test"),
                          QWebSocketServer::NonSecureMode);
  QVERIFY(server.listen(QHostAddress::LocalHost, 0));
  QPointer<QWebSocket> peer;
  connect(&server, &QWebSocketServer::newConnection, &server, [&]() {
    peer = server.nextPendingConnection();
    connect(peer, &QWebSocket::textMessageReceived, peer,
            [peer](const QString &message) {
              const auto document = QJsonDocument::fromJson(message.toUtf8());
              const auto object = document.object();
              if (object.value(QStringLiteral("op")).toString() !=
                  QStringLiteral("command")) {
                return;
              }
              const auto command =
                  object.value(QStringLiteral("command")).toString();
              const auto requestId =
                  object.value(QStringLiteral("reqId")).toString();
              if (command == QStringLiteral("system.authenticate")) {
                QCOMPARE(object.value(QStringLiteral("data"))
                             .toObject()
                             .value(QStringLiteral("accessToken"))
                             .toString(),
                         QStringLiteral("test-access-token"));
                sendJson(
                    peer,
                    ackEnvelope(
                        requestId,
                        QJsonObject{
                            {QStringLiteral("connectionId"),
                             QStringLiteral("connection-test")},
                            {QStringLiteral("userId"),
                             QStringLiteral(
                                 "22222222-2222-4222-8222-222222222222")}}));
                return;
              }
              sendJson(peer, ackEnvelope(requestId,
                                         QJsonObject{
                                             {QStringLiteral("channelId"),
                                              QStringLiteral(
                                                  "11111111-1111-4111-8111-"
                                                  "111111111111")},
                                             {QStringLiteral("subscribed"),
                                              true}}));
            });
    sendJson(peer, readyEnvelope());
  });

  network::GatewayClient client(
      QUrl(QStringLiteral("ws://127.0.0.1:%1").arg(server.serverPort())));
  network::GatewayClient::Options options;
  options.heartbeatIntervalMs = 60000;
  client.setOptions(options);
  client.setAccessTokenProvider(
      []() { return QStringLiteral("test-access-token"); });
  QSignalSpy authenticated(&client, &network::GatewayClient::authenticated);
  QSignalSpy succeeded(&client, &network::GatewayClient::commandSucceeded);
  client.connectToServer();
  QTRY_COMPARE_WITH_TIMEOUT(authenticated.count(), 1, 3000);

  const auto requestId = client.sendCommand(
      QStringLiteral("channel.subscribe"),
      QJsonObject{
          {QStringLiteral("channelId"),
           QStringLiteral("11111111-1111-4111-8111-111111111111")}});
  QTRY_VERIFY_WITH_TIMEOUT(succeeded.count() >= 2, 3000);
  bool found = false;
  for (const auto &arguments : succeeded) {
    if (arguments.at(0).toString() == requestId) {
      found = true;
      break;
    }
  }
  QVERIFY(found);
  client.disconnectFromServer();
}

void NetworkClientsTest::gatewayCommandTimesOut() {
  QWebSocketServer server(QStringLiteral("Baker timeout test"),
                          QWebSocketServer::NonSecureMode);
  QVERIFY(server.listen(QHostAddress::LocalHost, 0));
  QPointer<QWebSocket> peer;
  connect(&server, &QWebSocketServer::newConnection, &server, [&]() {
    peer = server.nextPendingConnection();
    connect(peer, &QWebSocket::textMessageReceived, peer,
            [peer](const QString &message) {
              const auto object =
                  QJsonDocument::fromJson(message.toUtf8()).object();
              if (object.value(QStringLiteral("command")).toString() ==
                  QStringLiteral("system.authenticate")) {
                sendJson(
                    peer,
                    ackEnvelope(
                        object.value(QStringLiteral("reqId")).toString(),
                        QJsonObject{
                            {QStringLiteral("connectionId"),
                             QStringLiteral("connection-test")},
                            {QStringLiteral("userId"),
                             QStringLiteral(
                                 "22222222-2222-4222-8222-222222222222")}}));
              }
            });
    sendJson(peer, readyEnvelope());
  });

  network::GatewayClient client(
      QUrl(QStringLiteral("ws://127.0.0.1:%1").arg(server.serverPort())));
  network::GatewayClient::Options options;
  options.commandTimeoutMs = 100;
  options.heartbeatIntervalMs = 60000;
  client.setOptions(options);
  client.setAccessTokenProvider([]() { return QStringLiteral("token"); });
  QSignalSpy authenticated(&client, &network::GatewayClient::authenticated);
  QSignalSpy failed(&client, &network::GatewayClient::commandFailed);
  client.connectToServer();
  QTRY_COMPARE_WITH_TIMEOUT(authenticated.count(), 1, 3000);

  const auto requestId = client.sendCommand(
      QStringLiteral("voice.join"),
      QJsonObject{
          {QStringLiteral("channelId"),
           QStringLiteral("11111111-1111-4111-8111-111111111111")}});
  QTRY_VERIFY_WITH_TIMEOUT(failed.count() >= 1, 3000);
  QCOMPARE(failed.last().at(0).toString(), requestId);
  const auto error =
      qvariant_cast<network::GatewayError>(failed.last().at(1));
  QCOMPARE(error.code, QStringLiteral("COMMAND_TIMEOUT"));
  client.disconnectFromServer();
}

void NetworkClientsTest::reconnectDelayIsBounded() {
  network::GatewayClient::Options options;
  options.reconnectBaseMs = 1000;
  options.reconnectMaximumMs = 30000;
  options.reconnectJitter = 0.25;
  QCOMPARE(network::GatewayClient::reconnectDelayMs(0, options, 0.0), 750);
  QCOMPARE(network::GatewayClient::reconnectDelayMs(0, options, 1.0), 1250);
  QCOMPARE(network::GatewayClient::reconnectDelayMs(10, options, 0.5), 30000);
}

QTEST_MAIN(NetworkClientsTest)
#include "tst_NetworkClients.moc"
