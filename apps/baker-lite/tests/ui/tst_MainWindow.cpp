#include "../../src/ui/Dialogs.h"
#include "../../src/ui/MainWindow.h"
#include "../../src/ui/ServerTreeModel.h"
#include "../../src/ui/StreamWindow.h"

#include <QAction>
#include <QApplication>
#include <QBrush>
#include <QComboBox>
#include <QDate>
#include <QDateTime>
#include <QEvent>
#include <QLabel>
#include <QMenu>
#include <QProgressBar>
#include <QPushButton>
#include <QSlider>
#include <QSplitter>
#include <QTabWidget>
#include <QTextBrowser>
#include <QTime>
#include <QToolBar>
#include <QToolButton>
#include <QtTest>

using namespace baker::lite::ui;

class MainWindowTest final : public QObject {
  Q_OBJECT

private slots:
  void mediaActionsRequireAuthenticatedSession();
  void loginDialogOffersRegistration();
  void compactInspectorUsesRemainingSpace();
  void hoverOpensVolumeSliders();
  void muteButtonsStillClickAfterHover();
  void mainToolbarUsesLeaveChannelInsteadOfDisconnect();
  void configurableCombinationShortcutTriggersAction();
  void sharedMusicVolumeButtonTogglesMute();
  void volumeShortcutsAdjustAllVolumes();
  void sharedMusicVolumeUsesDistinctIcon();
  void networkProblemAppearsAfterUserName();
  void liveIndicatorsAreRed();
  void chatMessagesIncludeDate();
  void streamDialogUsesProtocolBitrateTiers();
  void musicDialogShowsLiveLevels();
  void liveStreamUsesPopupWindow();
};

void MainWindowTest::mediaActionsRequireAuthenticatedSession() {
  MainWindow window;
  const QList<QString> authenticatedActionNames = {
      QStringLiteral("microphoneMuteAction"),
      QStringLiteral("outputMuteAction"),
  };
  const QList<QString> voiceActionNames = {
      QStringLiteral("musicAction"),
      QStringLiteral("screenAction"),
      QStringLiteral("cameraAction"),
  };
  const QList<QString> actionNames =
      authenticatedActionNames + voiceActionNames;

  window.setConnectionState(ConnectionState::Connected,
                            QStringLiteral("Login required"));
  for (const QString &name : actionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(action, qPrintable(name));
    QVERIFY2(!action->isEnabled(), qPrintable(name));
  }

  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  for (const QString &name : authenticatedActionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(action->isEnabled(), qPrintable(name));
  }
  for (const QString &name : voiceActionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(!action->isEnabled(), qPrintable(name));
  }

  window.setVoiceChannel(QStringLiteral("22222222-2222-4222-8222-222222222222"),
                         QStringLiteral("Voice"));
  for (const QString &name : voiceActionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(action->isEnabled(), qPrintable(name));
  }

  window.setVoiceChannel({}, {});
  for (const QString &name : voiceActionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(!action->isEnabled(), qPrintable(name));
  }

  window.setIdentity({}, {});
  for (const QString &name : actionNames) {
    auto *action = window.findChild<QAction *>(name);
    QVERIFY2(!action->isEnabled(), qPrintable(name));
  }
}

void MainWindowTest::loginDialogOffersRegistration() {
  LoginDialog dialog;
  const auto *button = dialog.findChild<QPushButton *>(
      QStringLiteral("loginCreateAccountButton"));
  QVERIFY(button);
  QSignalSpy spy(&dialog, &LoginDialog::createAccountRequested);
  QTest::mouseClick(const_cast<QPushButton *>(button), Qt::LeftButton);
  QCOMPARE(spy.count(), 1);
}

void MainWindowTest::compactInspectorUsesRemainingSpace() {
  MainWindow window;
  window.resize(1280, 820);
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));

  auto *splitter =
      window.findChild<QSplitter *>(QStringLiteral("workspaceSplitter"));
  auto *navigation =
      window.findChild<QWidget *>(QStringLiteral("navigationPane"));
  auto *inspector =
      window.findChild<QTabWidget *>(QStringLiteral("inspectorTabs"));
  QVERIFY(splitter);
  QVERIFY(navigation);
  QVERIFY(inspector);
  QCOMPARE(splitter->count(), 2);
  QVERIFY(inspector->width() <= 300);
  QVERIFY(navigation->width() >= splitter->width() - 320);
  window.resize(640, 620);
  QTRY_COMPARE(window.width(), 640);
}

void MainWindowTest::hoverOpensVolumeSliders() {
  MainWindow window;
  window.setConnectionState(ConnectionState::Connected);
  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));

  auto *toolbar = window.findChild<QToolBar *>(QStringLiteral("mainToolBar"));
  QVERIFY(toolbar);
  const QList<QPair<QString, QString>> controls = {
      {QStringLiteral("microphoneMuteAction"),
       QStringLiteral("microphoneVolumeMenu")},
      {QStringLiteral("outputMuteAction"), QStringLiteral("outputVolumeMenu")},
      {QStringLiteral("musicPlaybackVolumeAction"),
       QStringLiteral("musicPlaybackVolumeMenu")},
  };
  for (const auto &[actionName, menuName] : controls) {
    auto *action = window.findChild<QAction *>(actionName);
    auto *button =
        qobject_cast<QToolButton *>(toolbar->widgetForAction(action));
    auto *menu = window.findChild<QMenu *>(menuName);
    QVERIFY(action);
    QVERIFY(button);
    QVERIFY(menu);
    QEvent enterEvent(QEvent::Enter);
    QApplication::sendEvent(button, &enterEvent);
    QTRY_VERIFY(menu->isVisible());
    QVERIFY(menu->findChild<QSlider *>());
    menu->hide();
  }
}

void MainWindowTest::muteButtonsStillClickAfterHover() {
  MainWindow window;
  window.setConnectionState(ConnectionState::Connected);
  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));

  auto *toolbar = window.findChild<QToolBar *>(QStringLiteral("mainToolBar"));
  auto *action =
      window.findChild<QAction *>(QStringLiteral("microphoneMuteAction"));
  auto *button = qobject_cast<QToolButton *>(toolbar->widgetForAction(action));
  auto *menu =
      window.findChild<QMenu *>(QStringLiteral("microphoneVolumeMenu"));
  QVERIFY(button);
  QVERIFY(menu);
  QSignalSpy spy(&window, &MainWindow::microphoneMuteRequested);

  QEvent enterEvent(QEvent::Enter);
  QApplication::sendEvent(button, &enterEvent);
  QTRY_VERIFY(menu->isVisible());
  QTest::mouseClick(button, Qt::LeftButton);
  QTRY_COMPARE(spy.count(), 1);
  QCOMPARE(spy.first().first().toBool(), true);
  QVERIFY(action->isChecked());
}

void MainWindowTest::mainToolbarUsesLeaveChannelInsteadOfDisconnect() {
  MainWindow window;
  auto *toolbar = window.findChild<QToolBar *>(QStringLiteral("mainToolBar"));
  auto *disconnect =
      window.findChild<QAction *>(QStringLiteral("disconnectAction"));
  auto *leave = window.findChild<QAction *>(QStringLiteral("leaveVoiceAction"));
  QVERIFY(toolbar);
  QVERIFY(disconnect);
  QVERIFY(leave);
  QVERIFY(toolbar->widgetForAction(disconnect) == nullptr);
  QVERIFY(toolbar->widgetForAction(leave) != nullptr);
}

void MainWindowTest::configurableCombinationShortcutTriggersAction() {
  MainWindow window;
  ClientSettings settings;
  settings.toggleMicrophoneShortcut = QStringLiteral("Ctrl+Alt+M");
  window.setClientSettings(settings);
  window.setConnectionState(ConnectionState::Connected);
  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));
  QSignalSpy spy(&window, &MainWindow::microphoneMuteRequested);

  QTest::keyClick(&window, Qt::Key_M, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(spy.count(), 1);
  QCOMPARE(spy.first().first().toBool(), true);
}

void MainWindowTest::sharedMusicVolumeButtonTogglesMute() {
  MainWindow window;
  window.setConnectionState(ConnectionState::Connected);
  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  window.setMusicPlaybackVolume(80);
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));

  auto *toolbar = window.findChild<QToolBar *>(QStringLiteral("mainToolBar"));
  auto *action =
      window.findChild<QAction *>(QStringLiteral("musicPlaybackVolumeAction"));
  auto *button = qobject_cast<QToolButton *>(toolbar->widgetForAction(action));
  QVERIFY(button);
  QSignalSpy spy(&window, &MainWindow::musicPlaybackVolumeRequested);

  QTest::mouseClick(button, Qt::LeftButton);
  QTRY_COMPARE(spy.count(), 1);
  QCOMPARE(spy.at(0).at(0).toInt(), 0);
  QVERIFY(action->isChecked());

  QTest::mouseClick(button, Qt::LeftButton);
  QTRY_COMPARE(spy.count(), 2);
  QCOMPARE(spy.at(1).at(0).toInt(), 80);
  QVERIFY(!action->isChecked());
}

void MainWindowTest::volumeShortcutsAdjustAllVolumes() {
  MainWindow window;
  ClientSettings settings;
  settings.toggleMusicMuteShortcut = QStringLiteral("Ctrl+Alt+0");
  settings.microphoneVolumeUpShortcut = QStringLiteral("Ctrl+Alt+1");
  settings.outputVolumeDownShortcut = QStringLiteral("Ctrl+Alt+2");
  settings.musicVolumeUpShortcut = QStringLiteral("Ctrl+Alt+3");
  window.setClientSettings(settings);
  window.setConnectionState(ConnectionState::Connected);
  window.setIdentity(QStringLiteral("11111111-1111-4111-8111-111111111111"),
                     QStringLiteral("Test user"));
  window.setMicrophoneVolume(50);
  window.setOutputVolume(100);
  window.setMusicPlaybackVolume(100);
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));

  QSignalSpy microphoneSpy(&window, &MainWindow::microphoneVolumeRequested);
  QSignalSpy outputSpy(&window, &MainWindow::outputVolumeRequested);
  QSignalSpy musicSpy(&window, &MainWindow::musicPlaybackVolumeRequested);

  QTest::keyClick(&window, Qt::Key_0, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(musicSpy.count(), 1);
  QCOMPARE(musicSpy.first().first().toInt(), 0);
  QTest::keyClick(&window, Qt::Key_0, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(musicSpy.count(), 2);
  QCOMPARE(musicSpy.at(1).first().toInt(), 100);
  musicSpy.clear();

  QTest::keyClick(&window, Qt::Key_1, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(microphoneSpy.count(), 1);
  QCOMPARE(microphoneSpy.first().first().toInt(), 55);

  QTest::keyClick(&window, Qt::Key_2, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(outputSpy.count(), 1);
  QCOMPARE(outputSpy.first().first().toInt(), 95);

  QTest::keyClick(&window, Qt::Key_3, Qt::ControlModifier | Qt::AltModifier);
  QTRY_COMPARE(musicSpy.count(), 1);
  QCOMPARE(musicSpy.first().first().toInt(), 105);
}

void MainWindowTest::sharedMusicVolumeUsesDistinctIcon() {
  MainWindow window;
  auto *shareAction =
      window.findChild<QAction *>(QStringLiteral("musicAction"));
  auto *volumeAction =
      window.findChild<QAction *>(QStringLiteral("musicPlaybackVolumeAction"));
  QVERIFY(shareAction);
  QVERIFY(volumeAction);
  QVERIFY(!shareAction->icon().isNull());
  QVERIFY(!volumeAction->icon().isNull());
  QVERIFY(shareAction->icon().cacheKey() != volumeAction->icon().cacheKey());
}

void MainWindowTest::networkProblemAppearsAfterUserName() {
  ServerTreeModel model;
  model.setItems({
      {QStringLiteral("server"),
       {},
       QStringLiteral("Server"),
       {},
       TreeItemKind::Server,
       true},
      {QStringLiteral("voice"),
       QStringLiteral("server"),
       QStringLiteral("Voice"),
       {},
       TreeItemKind::VoiceChannel,
       true},
      {QStringLiteral("user"),
       QStringLiteral("voice"),
       QStringLiteral("Alice"),
       {},
       TreeItemKind::User,
       true,
       false,
       false,
       false,
       false,
       1},
  });
  const QModelIndex user = model.indexForId(QStringLiteral("user"));
  QVERIFY(user.isValid());
  QVERIFY(model.data(user, Qt::DisplayRole)
              .toString()
              .contains(QStringLiteral("(network issue)")));
}

void MainWindowTest::liveIndicatorsAreRed() {
  ServerTreeModel model;
  model.setItems({
      {QStringLiteral("server"),
       {},
       QStringLiteral("Server"),
       {},
       TreeItemKind::Server,
       true},
      {QStringLiteral("voice"),
       QStringLiteral("server"),
       QStringLiteral("Voice"),
       {},
       TreeItemKind::VoiceChannel,
       true},
      {QStringLiteral("user"),
       QStringLiteral("voice"),
       QStringLiteral("Alice"),
       {},
       TreeItemKind::User,
       true,
       false,
       false,
       false,
       true},
  });
  const QModelIndex user = model.indexForId(QStringLiteral("user"));
  QVERIFY(user.isValid());
  QVERIFY(model.data(user, Qt::DisplayRole)
              .toString()
              .contains(QStringLiteral("LIVE")));
  const QBrush foreground =
      qvariant_cast<QBrush>(model.data(user, Qt::ForegroundRole));
  QCOMPARE(foreground.color(), QColor(QStringLiteral("#ef626c")));

  MainWindow window;
  window.setAvailableStreams({
      {QStringLiteral("stream"), QStringLiteral("user"),
       QStringLiteral("Alice"), QStringLiteral("Voice")},
  });
  auto *liveStatus = window.findChild<QLabel *>(QStringLiteral("liveStatus"));
  QVERIFY(liveStatus);
  QVERIFY(liveStatus->styleSheet().contains(QStringLiteral("#ef626c")));
}

void MainWindowTest::chatMessagesIncludeDate() {
  MainWindow window;
  ChatMessage message;
  message.id = QStringLiteral("message");
  message.authorName = QStringLiteral("Alice");
  message.body = QStringLiteral("Hello");
  message.timestamp =
      QDateTime(QDate(2026, 7, 26), QTime(14, 5), Qt::LocalTime);
  window.setChatMessages({message});

  auto *browser =
      window.findChild<QTextBrowser *>(QStringLiteral("chatBrowser"));
  QVERIFY(browser);
  QVERIFY(browser->toPlainText().contains(QStringLiteral("2026-07-26 14:05")));
}

void MainWindowTest::streamDialogUsesProtocolBitrateTiers() {
  ScreenSourceDialog dialog;
  dialog.setSources({
      {QStringLiteral("1"),
       QStringLiteral("Screen 1"),
       CaptureSourceKind::Screen,
       {}},
  });
  CaptureSelection legacySelection;
  legacySelection.sourceId = QStringLiteral("1");
  legacySelection.bitrateKbps = 2500;
  dialog.setSelection(legacySelection);
  QCOMPARE(dialog.selection().bitrateKbps, 4000);

  auto *bitrate =
      dialog.findChild<QComboBox *>(QStringLiteral("streamBitrateCombo"));
  QVERIFY(bitrate);
  const QList<int> expected{2000, 4000, 6000, 10000, 16000};
  QList<int> actual;
  for (int index = 0; index < bitrate->count(); ++index) {
    actual.append(bitrate->itemData(index).toInt());
  }
  QCOMPARE(actual, expected);
}

void MainWindowTest::musicDialogShowsLiveLevels() {
  MusicSourceDialog dialog;
  MusicSourceOption source;
  source.id = QStringLiteral("42");
  source.name = QStringLiteral("Music player");
  source.peakLevelPercent = 37;
  dialog.setSources({source});
  auto *level =
      dialog.findChild<QProgressBar *>(QStringLiteral("musicSourceLevel"));
  QVERIFY(level);
  QCOMPARE(level->value(), 37);

  source.peakLevelPercent = 81;
  dialog.setSources({source});
  QCOMPARE(level->value(), 81);
}

void MainWindowTest::liveStreamUsesPopupWindow() {
  MainWindow window;
  window.show();
  QVERIFY(QTest::qWaitForWindowExposed(&window));
  auto *renderer = new QWidget;
  QSignalSpy released(&window, &MainWindow::streamRendererReleased);

  window.setStreamRenderer(QStringLiteral("stream-1"),
                           QStringLiteral("Alice — Live"), renderer);
  auto *popup =
      window.findChild<StreamWindow *>(QStringLiteral("streamWindow"));
  auto *embedded =
      window.findChild<QTabWidget *>(QStringLiteral("streamsTabs"));
  QVERIFY(popup);
  QTRY_VERIFY(popup->isVisible());
  QCOMPARE(popup->videoWidget(), renderer);
  QVERIFY(embedded);
  QVERIFY(!embedded->isVisible());

  window.removeStreamRenderer(QStringLiteral("stream-1"));
  QCOMPARE(released.count(), 1);
  delete renderer;
}

QTEST_MAIN(MainWindowTest)
#include "tst_MainWindow.moc"
