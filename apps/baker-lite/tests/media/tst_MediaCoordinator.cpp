#include "../../src/media/MediaCoordinator.hpp"

#include <QJsonObject>
#include <QSignalSpy>
#include <QtTest>

using namespace baker::media;

class MediaCoordinatorTest final : public QObject {
  Q_OBJECT

 private slots:
  void windowStreamUsesScreenProtocolType();
};

void MediaCoordinatorTest::windowStreamUsesScreenProtocolType() {
  MediaCoordinator coordinator;
  QSignalSpy commandSpy(
      &coordinator, &MediaCoordinator::gatewayCommandRequested);
  StreamQuality quality;
  quality.resolution = QStringLiteral("720p");
  quality.frameRate = 30;
  quality.bitrateKbps = 4000;
  quality.codec = VideoCodec::H264;

  coordinator.startStream(
      QStringLiteral("22222222-2222-4222-8222-222222222222"),
      StreamSourceType::Window,
      QStringLiteral("1234"),
      quality,
      true,
      1.0);

  QCOMPARE(commandSpy.count(), 1);
  const QList<QVariant> command = commandSpy.takeFirst();
  QCOMPARE(command.at(1).toString(), QStringLiteral("stream.start"));
  const QJsonObject data = command.at(2).toJsonObject();
  QCOMPARE(
      data.value(QStringLiteral("sourceType")).toString(),
      QStringLiteral("screen"));
  QCOMPARE(
      data.value(QStringLiteral("quality"))
          .toObject()
          .value(QStringLiteral("bitrateKbps"))
          .toInt(),
      4000);
}

QTEST_MAIN(MediaCoordinatorTest)
#include "tst_MediaCoordinator.moc"
