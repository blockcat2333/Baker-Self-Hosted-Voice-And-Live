#include "../../src/media/MediaCatalog.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC
#include "../../src/media/DesktopVideoSource.hpp"
#endif

#include <QWidget>
#include <QtTest>

#include <algorithm>

using namespace baker::media;

class CaptureSourcesTest final : public QObject {
  Q_OBJECT

 private slots:
  void listsNamedSourcesWithPreviews();
#ifdef BAKER_LITE_WITH_WEBRTC
  void opensSelectedScreenAndWindow();
#endif
};

void CaptureSourcesTest::listsNamedSourcesWithPreviews() {
  QWidget testWindow;
  testWindow.setWindowTitle(QStringLiteral("Baker Lite capture test window"));
  testWindow.resize(640, 360);
  testWindow.show();
  QVERIFY(QTest::qWaitForWindowExposed(&testWindow));

  const QList<CaptureSourceInfo> sources = MediaCatalog::captureSources();
  const auto screen = std::find_if(
      sources.cbegin(), sources.cend(), [](const CaptureSourceInfo& source) {
        return source.kind == CaptureKind::Screen;
      });
  QVERIFY(screen != sources.cend());
  QVERIFY2(!screen->name.trimmed().isEmpty(), "Screen name is empty");
  QVERIFY2(!screen->thumbnail.isNull(), "Screen preview is empty");

  const auto window = std::find_if(
      sources.cbegin(), sources.cend(), [](const CaptureSourceInfo& source) {
        return source.kind == CaptureKind::Window;
      });
  QVERIFY(window != sources.cend());
  QVERIFY2(!window->name.trimmed().isEmpty(), "Window name is empty");
  QVERIFY2(!window->thumbnail.isNull(), "Window preview is empty");
}

#ifdef BAKER_LITE_WITH_WEBRTC
void CaptureSourcesTest::opensSelectedScreenAndWindow() {
  QWidget testWindow;
  testWindow.setWindowTitle(QStringLiteral("Baker Lite selected source test"));
  testWindow.resize(640, 360);
  testWindow.show();
  QVERIFY(QTest::qWaitForWindowExposed(&testWindow));

  const QList<CaptureSourceInfo> sources = MediaCatalog::captureSources();
  StreamQuality quality;
  quality.resolution = QStringLiteral("480p");
  quality.frameRate = 15;
  quality.bitrateKbps = 800;

  for (const CaptureKind kind :
       {CaptureKind::Screen, CaptureKind::Window}) {
    const auto source = std::find_if(
        sources.cbegin(), sources.cend(),
        [kind](const CaptureSourceInfo& candidate) {
          return candidate.kind == kind;
        });
    QVERIFY(source != sources.cend());
    const StreamSourceType type =
        kind == CaptureKind::Screen ? StreamSourceType::Screen
                                    : StreamSourceType::Window;
    auto capturer =
        DesktopVideoSource::create(type, source->id, quality);
    QVERIFY2(capturer, "The selected desktop source could not be opened");
    QVERIFY(capturer->start());
    QTest::qWait(150);
    QCOMPARE(capturer->state(),
             webrtc::MediaSourceInterface::kLive);
    capturer->stop();
    QCOMPARE(capturer->state(),
             webrtc::MediaSourceInterface::kEnded);
  }
}
#endif

QTEST_MAIN(CaptureSourcesTest)
#include "tst_CaptureSources.moc"
