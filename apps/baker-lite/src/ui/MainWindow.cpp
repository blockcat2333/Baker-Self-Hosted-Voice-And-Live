#include "ui/MainWindow.h"

#include "ui/Dialogs.h"
#include "ui/ServerTreeModel.h"
#include "ui/StreamWindow.h"

#include <QAction>
#include <QApplication>
#include <QCloseEvent>
#include <QCoreApplication>
#include <QDesktopServices>
#include <QDialog>
#include <QDir>
#include <QEvent>
#include <QFile>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QIcon>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QModelIndex>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollBar>
#include <QSettings>
#include <QSignalBlocker>
#include <QSlider>
#include <QSplitter>
#include <QStandardPaths>
#include <QStatusBar>
#include <QStyle>
#include <QTabBar>
#include <QTabWidget>
#include <QTextBrowser>
#include <QTextCursor>
#include <QTextDocument>
#include <QTimer>
#include <QToolBar>
#include <QToolButton>
#include <QToolTip>
#include <QTranslator>
#include <QTreeView>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>
#include <QWidgetAction>

namespace baker::lite::ui {
namespace {

constexpr auto kSettingsGroup = "MainWindow";

QString iconPath(const char *name) {
  return QStringLiteral(":/icons/") + QString::fromLatin1(name) +
         QStringLiteral(".svg");
}

QString connectionProperty(const ConnectionState state) {
  switch (state) {
  case ConnectionState::Disconnected:
    return QStringLiteral("disconnected");
  case ConnectionState::Connecting:
  case ConnectionState::Reconnecting:
    return QStringLiteral("connecting");
  case ConnectionState::Connected:
    return QStringLiteral("connected");
  case ConnectionState::Error:
    return QStringLiteral("error");
  }
  return QStringLiteral("disconnected");
}

} // namespace

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
  qRegisterMetaType<ServerBookmark>();
  qRegisterMetaType<LoginCredentials>();
  qRegisterMetaType<RegistrationData>();
  qRegisterMetaType<ClientSettings>();
  qRegisterMetaType<DeviceSelection>();
  qRegisterMetaType<CaptureSelection>();
  qRegisterMetaType<MusicSourceSelection>();
  qRegisterMetaType<UpdateRelease>();

  setObjectName(QStringLiteral("bakerLiteMainWindow"));
  setMinimumSize(640, 520);
  resize(1280, 820);
  setWindowIcon(QIcon(QStringLiteral(":/icons/baker.png")));

  translator_ = new QTranslator(this);
  treeModel_ = new ServerTreeModel(this);

  createActions();
  createMenus();
  createToolBar();
  buildUi();
  createStatusBar();
  connectUi();
  loadStyleSheet();
  restoreUiState();

  QSettings settings;
  const auto storedLanguage =
      static_cast<UiLanguage>(settings
                                  .value(QStringLiteral("ui/language"),
                                         static_cast<int>(UiLanguage::English))
                                  .toInt());
  setUiLanguage(storedLanguage);
  setConnectionState(ConnectionState::Disconnected);
  setVoiceChannel({}, {});
  setNetworkMetrics({});
  setLiveStatus(tr("No live streams"));
}

MainWindow::~MainWindow() = default;

ServerTreeModel *MainWindow::serverTreeModel() const { return treeModel_; }

UiLanguage MainWindow::uiLanguage() const { return language_; }

QString MainWindow::currentServerUrl() const { return currentServerUrl_; }

void MainWindow::createActions() {
  connectAction_ = new QAction(QIcon(iconPath("connect")), {}, this);
  connectAction_->setObjectName(QStringLiteral("connectAction"));
  disconnectAction_ = new QAction(QIcon(iconPath("disconnect")), {}, this);
  disconnectAction_->setObjectName(QStringLiteral("disconnectAction"));
  disconnectAction_->setEnabled(false);
  serverManagerAction_ = new QAction(QIcon(iconPath("server")), {}, this);
  loginAction_ = new QAction({}, this);
  registerAction_ = new QAction({}, this);
  logoutAction_ = new QAction({}, this);
  logoutAction_->setEnabled(false);
  changeNameAction_ = new QAction({}, this);
  changeNameAction_->setEnabled(false);
  leaveVoiceAction_ = new QAction(QIcon(iconPath("disconnect")), {}, this);
  leaveVoiceAction_->setObjectName(QStringLiteral("leaveVoiceAction"));
  leaveVoiceAction_->setEnabled(false);

  microphoneMuteAction_ = new QAction(QIcon(iconPath("microphone")), {}, this);
  microphoneMuteAction_->setObjectName(QStringLiteral("microphoneMuteAction"));
  microphoneMuteAction_->setCheckable(true);
  outputMuteAction_ = new QAction(QIcon(iconPath("speaker")), {}, this);
  outputMuteAction_->setObjectName(QStringLiteral("outputMuteAction"));
  outputMuteAction_->setCheckable(true);
  musicPlaybackVolumeAction_ =
      new QAction(QIcon(iconPath("music-volume")), {}, this);
  musicPlaybackVolumeAction_->setObjectName(
      QStringLiteral("musicPlaybackVolumeAction"));
  musicPlaybackVolumeAction_->setCheckable(true);
  auto createVolumeShortcutAction = [this](const QString &objectName) {
    auto *action = new QAction(this);
    action->setObjectName(objectName);
    addAction(action);
    return action;
  };
  microphoneVolumeDownAction_ =
      createVolumeShortcutAction(QStringLiteral("microphoneVolumeDownAction"));
  microphoneVolumeUpAction_ =
      createVolumeShortcutAction(QStringLiteral("microphoneVolumeUpAction"));
  outputVolumeDownAction_ =
      createVolumeShortcutAction(QStringLiteral("outputVolumeDownAction"));
  outputVolumeUpAction_ =
      createVolumeShortcutAction(QStringLiteral("outputVolumeUpAction"));
  musicVolumeDownAction_ =
      createVolumeShortcutAction(QStringLiteral("musicVolumeDownAction"));
  musicVolumeUpAction_ =
      createVolumeShortcutAction(QStringLiteral("musicVolumeUpAction"));
  devicesAction_ = new QAction(QIcon(iconPath("devices")), {}, this);

  musicAction_ = new QAction(QIcon(iconPath("music")), {}, this);
  musicAction_->setObjectName(QStringLiteral("musicAction"));
  stopMusicAction_ = new QAction({}, this);
  stopMusicAction_->setEnabled(false);
  screenAction_ = new QAction(QIcon(iconPath("screen")), {}, this);
  screenAction_->setObjectName(QStringLiteral("screenAction"));
  cameraAction_ = new QAction(QIcon(iconPath("camera")), {}, this);
  cameraAction_->setObjectName(QStringLiteral("cameraAction"));
  stopCaptureAction_ =
      new QAction(QIcon(iconPath("stop-live")), {}, this);
  stopCaptureAction_->setObjectName(QStringLiteral("stopCaptureAction"));
  stopCaptureAction_->setEnabled(false);
  stopCaptureAction_->setVisible(false);
  watchLiveAction_ = new QAction(QIcon(iconPath("screen")), {}, this);
  watchLiveAction_->setEnabled(false);

  settingsAction_ = new QAction(QIcon(iconPath("settings")), {}, this);
  settingsAction_->setShortcut(QKeySequence::Preferences);
  updatesAction_ = new QAction(QIcon(iconPath("update")), {}, this);
  openLogsAction_ = new QAction({}, this);
  quitAction_ = new QAction({}, this);
  quitAction_->setShortcut(QKeySequence::Quit);

  fullScreenAction_ = new QAction({}, this);
  fullScreenAction_->setCheckable(true);
  fullScreenAction_->setShortcut(QKeySequence::FullScreen);
  restoreLayoutAction_ = new QAction({}, this);
  restoreLayoutAction_->setObjectName(QStringLiteral("restoreLayoutAction"));
  aboutAction_ = new QAction({}, this);
}

void MainWindow::createMenus() {
  connectionsMenu_ = menuBar()->addMenu(QString());
  connectionsMenu_->addAction(connectAction_);
  connectionsMenu_->addAction(disconnectAction_);
  connectionsMenu_->addSeparator();
  connectionsMenu_->addAction(loginAction_);
  connectionsMenu_->addAction(registerAction_);
  connectionsMenu_->addAction(logoutAction_);
  connectionsMenu_->addSeparator();
  connectionsMenu_->addAction(quitAction_);

  bookmarksMenu_ = menuBar()->addMenu(QString());
  rebuildBookmarksMenu();

  selfMenu_ = menuBar()->addMenu(QString());
  selfMenu_->addAction(microphoneMuteAction_);
  selfMenu_->addAction(outputMuteAction_);
  selfMenu_->addSeparator();
  selfMenu_->addAction(changeNameAction_);
  selfMenu_->addAction(leaveVoiceAction_);
  selfMenu_->addSeparator();
  selfMenu_->addAction(musicAction_);
  selfMenu_->addAction(stopMusicAction_);
  selfMenu_->addSeparator();
  selfMenu_->addAction(screenAction_);
  selfMenu_->addAction(cameraAction_);
  selfMenu_->addAction(stopCaptureAction_);

  viewMenu_ = menuBar()->addMenu(QString());
  viewMenu_->addAction(fullScreenAction_);
  viewMenu_->addAction(restoreLayoutAction_);
  viewMenu_->addSeparator();
  liveStreamsMenu_ = viewMenu_->addMenu(QIcon(iconPath("screen")), QString());
  watchLiveAction_->setMenu(liveStreamsMenu_);

  toolsMenu_ = menuBar()->addMenu(QString());
  toolsMenu_->addAction(settingsAction_);
  toolsMenu_->addSeparator();
  toolsMenu_->addAction(updatesAction_);
  toolsMenu_->addAction(openLogsAction_);

  helpMenu_ = menuBar()->addMenu(QString());
  helpMenu_->addAction(aboutAction_);
}

void MainWindow::createToolBar() {
  mainToolBar_ = addToolBar(QString());
  mainToolBar_->setObjectName(QStringLiteral("mainToolBar"));
  mainToolBar_->setMovable(false);
  mainToolBar_->setFloatable(false);
  mainToolBar_->setIconSize(QSize(18, 18));
  mainToolBar_->setToolButtonStyle(Qt::ToolButtonIconOnly);

  mainToolBar_->addAction(connectAction_);
  mainToolBar_->addAction(leaveVoiceAction_);
  mainToolBar_->addSeparator();
  mainToolBar_->addAction(microphoneMuteAction_);
  mainToolBar_->addAction(outputMuteAction_);
  mainToolBar_->addAction(musicPlaybackVolumeAction_);
  mainToolBar_->addSeparator();
  mainToolBar_->addAction(musicAction_);
  mainToolBar_->addAction(screenAction_);
  mainToolBar_->addAction(cameraAction_);
  mainToolBar_->addAction(stopCaptureAction_);
  if (auto *stopButton = qobject_cast<QToolButton *>(
          mainToolBar_->widgetForAction(stopCaptureAction_))) {
    stopButton->setObjectName(QStringLiteral("stopCaptureToolButton"));
    stopButton->setAccessibleName(tr("Stop live stream"));
    stopButton->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    stopButton->setStyleSheet(
        QStringLiteral(
            "QToolButton { color: white; background: #b63c45; "
            "border: 1px solid #ef626c; border-radius: 3px; "
            "padding: 4px 8px; }"
            "QToolButton:hover { background: #d34d57; }"
            "QToolButton:pressed { background: #8f3038; }"));
  }
  mainToolBar_->addAction(watchLiveAction_);
  mainToolBar_->addSeparator();
  mainToolBar_->addAction(settingsAction_);

  auto createVolumeMenu = [this](const QString &accessibleName,
                                 QSlider **sliderOut, QLabel **labelOut) {
    auto *menu = new QMenu(this);
    menu->setWindowFlags(Qt::Tool | Qt::FramelessWindowHint |
                         Qt::WindowDoesNotAcceptFocus);
    menu->setAttribute(Qt::WA_ShowWithoutActivating);
    auto *action = new QWidgetAction(menu);
    auto *panel = new QWidget(menu);
    auto *label = new QLabel(panel);
    auto *slider = new QSlider(Qt::Horizontal, panel);
    slider->setAccessibleName(accessibleName);
    slider->setRange(0, 200);
    slider->setValue(100);
    slider->setMinimumWidth(180);
    auto *layout = new QVBoxLayout(panel);
    layout->setContentsMargins(10, 8, 10, 8);
    layout->addWidget(label);
    layout->addWidget(slider);
    action->setDefaultWidget(panel);
    menu->addAction(action);
    *sliderOut = slider;
    *labelOut = label;
    return menu;
  };
  microphoneVolumeMenu_ =
      createVolumeMenu(tr("Microphone volume"), &microphoneVolumeSlider_,
                       &microphoneVolumeLabel_);
  microphoneVolumeMenu_->setObjectName(QStringLiteral("microphoneVolumeMenu"));
  microphoneVolumeSlider_->setObjectName(
      QStringLiteral("microphoneVolumeSlider"));
  microphoneVolumeSlider_->setMaximum(100);
  outputVolumeMenu_ = createVolumeMenu(
      tr("Speaker volume"), &outputVolumeSlider_, &outputVolumeLabel_);
  outputVolumeMenu_->setObjectName(QStringLiteral("outputVolumeMenu"));
  outputVolumeSlider_->setObjectName(QStringLiteral("outputVolumeSlider"));
  musicPlaybackVolumeMenu_ =
      createVolumeMenu(tr("Shared music playback volume"),
                       &musicPlaybackVolumeSlider_, &musicPlaybackVolumeLabel_);
  musicPlaybackVolumeMenu_->setObjectName(
      QStringLiteral("musicPlaybackVolumeMenu"));
  musicPlaybackVolumeSlider_->setObjectName(
      QStringLiteral("musicPlaybackVolumeSlider"));
  microphoneToolButton_ = qobject_cast<QToolButton *>(
      mainToolBar_->widgetForAction(microphoneMuteAction_));
  outputToolButton_ = qobject_cast<QToolButton *>(
      mainToolBar_->widgetForAction(outputMuteAction_));
  musicPlaybackVolumeToolButton_ = qobject_cast<QToolButton *>(
      mainToolBar_->widgetForAction(musicPlaybackVolumeAction_));
  if (microphoneToolButton_ != nullptr) {
    microphoneToolButton_->installEventFilter(this);
  }
  if (outputToolButton_ != nullptr) {
    outputToolButton_->installEventFilter(this);
  }
  if (musicPlaybackVolumeToolButton_ != nullptr) {
    musicPlaybackVolumeToolButton_->installEventFilter(this);
  }
  microphoneVolumeMenu_->installEventFilter(this);
  outputVolumeMenu_->installEventFilter(this);
  musicPlaybackVolumeMenu_->installEventFilter(this);
  connect(microphoneVolumeSlider_, &QSlider::valueChanged, this,
          [this](const int value) {
            microphoneVolumeLabel_->setText(
                tr("Microphone volume: %1%").arg(value));
            emit microphoneVolumeRequested(value);
          });
  connect(outputVolumeSlider_, &QSlider::valueChanged, this,
          [this](const int value) {
            outputVolumeLabel_->setText(tr("Speaker volume: %1%").arg(value));
            emit outputVolumeRequested(value);
          });
  connect(musicPlaybackVolumeSlider_, &QSlider::valueChanged, this,
          [this](const int value) {
            if (value > 0) {
              musicPlaybackVolumeBeforeMute_ = value;
            }
            musicPlaybackVolumeLabel_->setText(
                tr("Shared music playback volume: %1%").arg(value));
            updateMusicPlaybackMuteUi();
            emit musicPlaybackVolumeRequested(value);
          });
  setMicrophoneVolume(100);
  setOutputVolume(100);
  setMusicPlaybackVolume(100);
}

void MainWindow::buildUi() {
  verticalSplitter_ = new QSplitter(Qt::Vertical, this);
  verticalSplitter_->setObjectName(QStringLiteral("verticalSplitter"));
  verticalSplitter_->setChildrenCollapsible(false);

  workspaceSplitter_ = new QSplitter(Qt::Horizontal, verticalSplitter_);
  workspaceSplitter_->setObjectName(QStringLiteral("workspaceSplitter"));
  workspaceSplitter_->setChildrenCollapsible(false);

  auto *navigationPane = new QWidget(workspaceSplitter_);
  navigationPane->setObjectName(QStringLiteral("navigationPane"));
  auto *navigationHeading = new QLabel(navigationPane);
  navigationHeading->setObjectName(QStringLiteral("navigationHeading"));
  treeView_ = new QTreeView(navigationPane);
  treeView_->setObjectName(QStringLiteral("serverTree"));
  treeView_->setModel(treeModel_);
  treeView_->setHeaderHidden(true);
  treeView_->setUniformRowHeights(true);
  treeView_->setAnimated(true);
  treeView_->setIndentation(16);
  treeView_->setContextMenuPolicy(Qt::CustomContextMenu);
  treeView_->setSelectionBehavior(QAbstractItemView::SelectRows);
  auto *navigationLayout = new QVBoxLayout(navigationPane);
  navigationLayout->setContentsMargins(0, 0, 0, 0);
  navigationLayout->setSpacing(0);
  navigationLayout->addWidget(navigationHeading);
  navigationLayout->addWidget(treeView_, 1);

  inspectorTabs_ = new QTabWidget(workspaceSplitter_);
  inspectorTabs_->setObjectName(QStringLiteral("inspectorTabs"));
  inspectorTabs_->setDocumentMode(true);
  inspectorTabs_->setMaximumWidth(300);

  detailBrowser_ = new QTextBrowser(inspectorTabs_);
  detailBrowser_->setObjectName(QStringLiteral("detailBrowser"));
  detailBrowser_->setOpenExternalLinks(true);
  inspectorTabs_->addTab(detailBrowser_, QIcon(iconPath("info")), QString());

  streamsTabs_ = new QTabWidget(inspectorTabs_);
  streamsTabs_->setObjectName(QStringLiteral("streamsTabs"));
  streamsTabs_->setDocumentMode(true);
  streamsTabs_->setTabsClosable(true);
  streamsTabs_->setMovable(true);
  streamsTabs_->setContextMenuPolicy(Qt::CustomContextMenu);
  auto *emptyStreams = new QLabel(streamsTabs_);
  emptyStreams->setObjectName(QStringLiteral("emptyStreamsLabel"));
  emptyStreams->setAlignment(Qt::AlignCenter);
  streamsTabs_->addTab(emptyStreams, QString());
  streamsTabs_->setTabEnabled(0, false);
  streamsTabs_->hide();

  workspaceSplitter_->addWidget(navigationPane);
  workspaceSplitter_->addWidget(inspectorTabs_);
  workspaceSplitter_->setStretchFactor(0, 1);
  workspaceSplitter_->setStretchFactor(1, 0);

  activityTabs_ = new QTabWidget(verticalSplitter_);
  activityTabs_->setObjectName(QStringLiteral("activityTabs"));
  activityTabs_->setDocumentMode(true);
  activityTabs_->setMovable(true);

  chatPage_ = new QWidget(activityTabs_);
  chatPage_->setObjectName(QStringLiteral("chatPage"));
  chatTitleLabel_ = new QLabel(chatPage_);
  chatTitleLabel_->setObjectName(QStringLiteral("chatTitle"));
  loadOlderButton_ = new QPushButton(chatPage_);
  loadOlderButton_->setObjectName(QStringLiteral("loadOlderButton"));
  chatSearchEdit_ = new QLineEdit(chatPage_);
  chatSearchEdit_->setObjectName(QStringLiteral("chatSearchEdit"));
  chatSearchEdit_->setClearButtonEnabled(true);
  auto *searchButton = new QPushButton(chatPage_);
  searchButton->setObjectName(QStringLiteral("searchButton"));
  chatSearchStatusLabel_ = new QLabel(chatPage_);
  chatSearchStatusLabel_->setObjectName(QStringLiteral("chatSearchStatus"));

  auto *chatHeader = new QHBoxLayout();
  chatHeader->setContentsMargins(0, 0, 0, 0);
  chatHeader->addWidget(chatTitleLabel_);
  chatHeader->addWidget(loadOlderButton_);
  chatHeader->addStretch();
  chatHeader->addWidget(chatSearchStatusLabel_);
  chatHeader->addWidget(chatSearchEdit_);
  chatHeader->addWidget(searchButton);

  chatBrowser_ = new QTextBrowser(chatPage_);
  chatBrowser_->setObjectName(QStringLiteral("chatBrowser"));
  chatBrowser_->setOpenExternalLinks(true);
  chatEdit_ = new QLineEdit(chatPage_);
  chatEdit_->setObjectName(QStringLiteral("chatEdit"));
  sendButton_ = new QPushButton(chatPage_);
  sendButton_->setObjectName(QStringLiteral("sendButton"));
  auto *composer = new QHBoxLayout();
  composer->setContentsMargins(0, 0, 0, 0);
  composer->addWidget(chatEdit_, 1);
  composer->addWidget(sendButton_);

  auto *chatLayout = new QVBoxLayout(chatPage_);
  chatLayout->setContentsMargins(8, 6, 8, 8);
  chatLayout->setSpacing(6);
  chatLayout->addLayout(chatHeader);
  chatLayout->addWidget(chatBrowser_, 1);
  chatLayout->addLayout(composer);
  activityTabs_->addTab(chatPage_, QIcon(iconPath("chat")), QString());

  serverLogPage_ = new QWidget(activityTabs_);
  serverLog_ = new QPlainTextEdit(serverLogPage_);
  serverLog_->setObjectName(QStringLiteral("serverLog"));
  serverLog_->setReadOnly(true);
  serverLog_->setMaximumBlockCount(5000);
  auto *serverLogLayout = new QVBoxLayout(serverLogPage_);
  serverLogLayout->setContentsMargins(4, 4, 4, 4);
  serverLogLayout->addWidget(serverLog_);
  activityTabs_->addTab(serverLogPage_, QIcon(iconPath("log")), QString());

  connectionLogPage_ = new QWidget(activityTabs_);
  connectionLog_ = new QPlainTextEdit(connectionLogPage_);
  connectionLog_->setObjectName(QStringLiteral("connectionLog"));
  connectionLog_->setReadOnly(true);
  connectionLog_->setMaximumBlockCount(5000);
  auto *connectionLogLayout = new QVBoxLayout(connectionLogPage_);
  connectionLogLayout->setContentsMargins(4, 4, 4, 4);
  connectionLogLayout->addWidget(connectionLog_);
  activityTabs_->addTab(connectionLogPage_, QIcon(iconPath("connection-log")),
                        QString());

  verticalSplitter_->addWidget(workspaceSplitter_);
  verticalSplitter_->addWidget(activityTabs_);
  verticalSplitter_->setStretchFactor(0, 3);
  verticalSplitter_->setStretchFactor(1, 2);
  setCentralWidget(verticalSplitter_);
}

void MainWindow::createStatusBar() {
  connectionIndicator_ = new QLabel(this);
  connectionIndicator_->setObjectName(QStringLiteral("connectionIndicator"));
  identityLabel_ = new QLabel(this);
  identityLabel_->setObjectName(QStringLiteral("identityStatus"));
  voiceStatusLabel_ = new QLabel(this);
  voiceStatusLabel_->setObjectName(QStringLiteral("voiceStatus"));
  networkStatusLabel_ = new QLabel(this);
  networkStatusLabel_->setObjectName(QStringLiteral("networkStatus"));
  liveStatusLabel_ = new QLabel(this);
  liveStatusLabel_->setObjectName(QStringLiteral("liveStatus"));

  statusBar()->setSizeGripEnabled(true);
  statusBar()->addWidget(connectionIndicator_, 2);
  statusBar()->addWidget(identityLabel_, 1);
  statusBar()->addPermanentWidget(voiceStatusLabel_);
  statusBar()->addPermanentWidget(networkStatusLabel_);
  statusBar()->addPermanentWidget(liveStatusLabel_);
}

void MainWindow::connectUi() {
  connect(connectAction_, &QAction::triggered, this,
          &MainWindow::showServerManagerDialog);
  connect(serverManagerAction_, &QAction::triggered, this,
          &MainWindow::showServerManagerDialog);
  connect(disconnectAction_, &QAction::triggered, this,
          &MainWindow::disconnectRequested);
  connect(loginAction_, &QAction::triggered, this,
          &MainWindow::showLoginDialog);
  connect(registerAction_, &QAction::triggered, this,
          &MainWindow::showRegistrationDialog);
  connect(logoutAction_, &QAction::triggered, this,
          &MainWindow::logoutRequested);
  connect(quitAction_, &QAction::triggered, qApp,
          &QApplication::closeAllWindows);

  connect(changeNameAction_, &QAction::triggered, this, [this] {
    bool accepted = false;
    const QString displayName =
        QInputDialog::getText(this, tr("Change display name"),
                              tr("Display name"), QLineEdit::Normal,
                              displayName_, &accepted)
            .trimmed();
    if (accepted && !displayName.isEmpty() && displayName != displayName_) {
      emit changeDisplayNameRequested(displayName);
    }
  });
  connect(leaveVoiceAction_, &QAction::triggered, this,
          &MainWindow::leaveVoiceChannelRequested);
  connect(microphoneMuteAction_, &QAction::toggled, this,
          &MainWindow::microphoneMuteRequested);
  connect(outputMuteAction_, &QAction::toggled, this,
          &MainWindow::outputMuteRequested);
  connect(musicPlaybackVolumeAction_, &QAction::triggered, this,
          [this](const bool muted) {
            const int volume = musicPlaybackVolumeSlider_->value();
            if (muted) {
              if (volume > 0) {
                musicPlaybackVolumeBeforeMute_ = volume;
              }
              setMusicPlaybackVolume(0);
              emit musicPlaybackVolumeRequested(0);
              return;
            }
            const int restored = qBound(1, musicPlaybackVolumeBeforeMute_, 200);
            setMusicPlaybackVolume(restored);
            emit musicPlaybackVolumeRequested(restored);
          });
  constexpr int kVolumeShortcutStep = 5;
  connect(microphoneVolumeDownAction_, &QAction::triggered, this, [this] {
    microphoneVolumeSlider_->setValue(microphoneVolumeSlider_->value() -
                                      kVolumeShortcutStep);
  });
  connect(microphoneVolumeUpAction_, &QAction::triggered, this, [this] {
    microphoneVolumeSlider_->setValue(microphoneVolumeSlider_->value() +
                                      kVolumeShortcutStep);
  });
  connect(outputVolumeDownAction_, &QAction::triggered, this, [this] {
    outputVolumeSlider_->setValue(outputVolumeSlider_->value() -
                                  kVolumeShortcutStep);
  });
  connect(outputVolumeUpAction_, &QAction::triggered, this, [this] {
    outputVolumeSlider_->setValue(outputVolumeSlider_->value() +
                                  kVolumeShortcutStep);
  });
  connect(musicVolumeDownAction_, &QAction::triggered, this, [this] {
    musicPlaybackVolumeSlider_->setValue(musicPlaybackVolumeSlider_->value() -
                                         kVolumeShortcutStep);
  });
  connect(musicVolumeUpAction_, &QAction::triggered, this, [this] {
    musicPlaybackVolumeSlider_->setValue(musicPlaybackVolumeSlider_->value() +
                                         kVolumeShortcutStep);
  });
  connect(musicAction_, &QAction::triggered, this,
          &MainWindow::showMusicSourceDialog);
  connect(stopMusicAction_, &QAction::triggered, this,
          &MainWindow::stopMusicSharingRequested);
  connect(screenAction_, &QAction::triggered, this,
          &MainWindow::showScreenSourceDialog);
  connect(cameraAction_, &QAction::triggered, this,
          &MainWindow::showCameraSourceDialog);
  connect(stopCaptureAction_, &QAction::triggered, this,
          &MainWindow::stopCaptureRequested);
  connect(settingsAction_, &QAction::triggered, this,
          &MainWindow::showSettingsDialog);
  connect(updatesAction_, &QAction::triggered, this,
          &MainWindow::showUpdateDialog);
  connect(openLogsAction_, &QAction::triggered, this,
          &MainWindow::openLogsFolderRequested);

  connect(fullScreenAction_, &QAction::toggled, this,
          [this](const bool fullScreen) {
            if (fullScreen) {
              showFullScreen();
            } else {
              showNormal();
            }
          });
  connect(restoreLayoutAction_, &QAction::triggered, this, [this] {
    workspaceSplitter_->setSizes({720, 240});
    verticalSplitter_->setSizes({520, 260});
    treeView_->expandAll();
  });
  connect(aboutAction_, &QAction::triggered, this, [this] {
    QMessageBox::about(
        this, tr("About Baker Lite"),
        tr("<h2>Baker Lite</h2>"
           "<p>A native, lightweight client for self-hosted Baker "
           "voice servers.</p>"
           "<p>Built with C++20 and Qt Widgets.</p>"));
  });

  connect(
      treeView_, &QTreeView::clicked, this,
      [this](const QModelIndex &index) { activateTreeIndex(index, false); });
  connect(treeView_, &QTreeView::doubleClicked, this,
          [this](const QModelIndex &index) { activateTreeIndex(index, true); });
  connect(treeView_, &QTreeView::customContextMenuRequested, this,
          &MainWindow::showTreeContextMenu);

  connect(sendButton_, &QPushButton::clicked, this,
          &MainWindow::sendCurrentMessage);
  connect(chatEdit_, &QLineEdit::returnPressed, this,
          &MainWindow::sendCurrentMessage);
  connect(findChild<QPushButton *>(QStringLiteral("searchButton")),
          &QPushButton::clicked, this, &MainWindow::runCurrentSearch);
  connect(chatSearchEdit_, &QLineEdit::returnPressed, this,
          &MainWindow::runCurrentSearch);
  connect(loadOlderButton_, &QPushButton::clicked, this, [this] {
    if (!currentChatChannelId_.isEmpty()) {
      emit loadOlderMessagesRequested(currentChatChannelId_);
    }
  });

  connect(streamsTabs_, &QTabWidget::tabCloseRequested, this,
          [this](const int tabIndex) {
            QWidget *page = streamsTabs_->widget(tabIndex);
            const QString streamId = streamIdForPage(page);
            if (!streamId.isEmpty()) {
              emit stopWatchingStreamRequested(streamId);
            }
          });
  connect(streamsTabs_, &QTabWidget::customContextMenuRequested, this,
          [this](const QPoint &position) {
            const int tabIndex = streamsTabs_->tabBar()->tabAt(position);
            QWidget *page =
                tabIndex >= 0 ? streamsTabs_->widget(tabIndex) : nullptr;
            const QString streamId = streamIdForPage(page);
            if (streamId.isEmpty()) {
              return;
            }

            QMenu menu(this);
            QAction *detachAction = menu.addAction(QIcon(iconPath("detach")),
                                                   tr("Open in new window"));
            QAction *stopAction = menu.addAction(tr("Stop watching"));
            QAction *selected = menu.exec(streamsTabs_->mapToGlobal(position));
            if (selected == detachAction) {
              detachStream(streamId);
            } else if (selected == stopAction) {
              emit stopWatchingStreamRequested(streamId);
            }
          });
}

void MainWindow::retranslateUi() {
  connectionsMenu_->setTitle(tr("&Connections"));
  bookmarksMenu_->setTitle(tr("&Bookmarks"));
  selfMenu_->setTitle(tr("&Self"));
  viewMenu_->setTitle(tr("&View"));
  toolsMenu_->setTitle(tr("&Tools"));
  helpMenu_->setTitle(tr("&Help"));
  mainToolBar_->setWindowTitle(tr("Main toolbar"));

  connectAction_->setText(tr("Connect…"));
  connectAction_->setToolTip(tr("Connect to a Baker server"));
  disconnectAction_->setText(tr("Disconnect"));
  disconnectAction_->setToolTip(tr("Disconnect from the current server"));
  serverManagerAction_->setText(tr("Manage servers…"));
  loginAction_->setText(tr("Sign in…"));
  registerAction_->setText(tr("Create account…"));
  logoutAction_->setText(tr("Sign out"));
  changeNameAction_->setText(tr("Change display name…"));
  leaveVoiceAction_->setText(tr("Leave voice channel"));
  leaveVoiceAction_->setToolTip(tr("Leave the current voice channel"));
  microphoneMuteAction_->setText(tr("Mute microphone"));
  microphoneMuteAction_->setToolTip(
      tr("Click to mute or unmute. Hover to adjust microphone volume."));
  outputMuteAction_->setText(tr("Mute speakers"));
  outputMuteAction_->setToolTip(
      tr("Click to mute or unmute. Hover to adjust speaker volume."));
  microphoneVolumeDownAction_->setText(tr("Microphone volume down"));
  microphoneVolumeUpAction_->setText(tr("Microphone volume up"));
  outputVolumeDownAction_->setText(tr("Speaker volume down"));
  outputVolumeUpAction_->setText(tr("Speaker volume up"));
  musicVolumeDownAction_->setText(tr("Shared music volume down"));
  musicVolumeUpAction_->setText(tr("Shared music volume up"));
  updateMusicPlaybackMuteUi();
  devicesAction_->setText(tr("Audio devices…"));
  devicesAction_->setToolTip(tr("Select microphone and speakers"));
  musicAction_->setText(tr("Share application audio…"));
  musicAction_->setToolTip(tr("Share music from an application"));
  stopMusicAction_->setText(tr("Stop sharing application audio"));
  stopMusicAction_->setToolTip(
      tr("Stop sharing and listening to all shared music"));
  screenAction_->setText(tr("Share screen or window…"));
  screenAction_->setToolTip(tr("Start a screen live stream"));
  cameraAction_->setText(tr("Share camera…"));
  cameraAction_->setToolTip(tr("Start a camera live stream"));
  stopCaptureAction_->setText(tr("Stop live stream"));
  stopCaptureAction_->setToolTip(tr("Stop your current live stream"));
  watchLiveAction_->setText(tr("Watch live stream"));
  watchLiveAction_->setToolTip(tr("Choose an active live stream to watch"));
  liveStreamsMenu_->setTitle(tr("Active live streams"));
  settingsAction_->setText(tr("Settings…"));
  settingsAction_->setToolTip(tr("Open Baker Lite settings"));
  updatesAction_->setText(tr("Check for updates…"));
  openLogsAction_->setText(tr("Open logs folder"));
  quitAction_->setText(tr("Quit Baker Lite"));
  fullScreenAction_->setText(tr("Full screen"));
  restoreLayoutAction_->setText(tr("Restore default layout"));
  aboutAction_->setText(tr("About Baker Lite"));

  if (auto *heading =
          findChild<QLabel *>(QStringLiteral("navigationHeading"))) {
    heading->setText(tr("SERVERS AND CHANNELS"));
  }
  inspectorTabs_->setTabText(inspectorTabs_->indexOf(detailBrowser_),
                             tr("Information"));
  if (auto *empty = findChild<QLabel *>(QStringLiteral("emptyStreamsLabel"))) {
    empty->setText(tr("No live stream is being watched."));
    const int emptyIndex = streamsTabs_->indexOf(empty);
    if (emptyIndex >= 0) {
      streamsTabs_->setTabText(emptyIndex, tr("No streams"));
    }
  }

  activityTabs_->setTabText(activityTabs_->indexOf(chatPage_),
                            tr("Channel chat"));
  activityTabs_->setTabText(activityTabs_->indexOf(serverLogPage_),
                            tr("Server log"));
  activityTabs_->setTabText(activityTabs_->indexOf(connectionLogPage_),
                            tr("Connection log"));
  loadOlderButton_->setText(tr("Older"));
  chatSearchEdit_->setPlaceholderText(tr("Search messages"));
  if (auto *searchButton =
          findChild<QPushButton *>(QStringLiteral("searchButton"))) {
    searchButton->setText(tr("Search"));
  }
  chatEdit_->setPlaceholderText(
      currentChatChannelId_.isEmpty()
          ? tr("Select a text channel to send messages")
          : tr("Message %1").arg(currentChatChannelName_));
  sendButton_->setText(tr("Send"));
  setChatContext(currentChatChannelId_, currentChatChannelName_);
  setConnectionState(connectionState_, connectionStatusText_);
  setIdentity(userId_, displayName_);
  setVoiceChannel(currentVoiceChannelId_, currentVoiceChannelName_);
  setLiveStatus(liveStatus_);
  setMicrophoneVolume(microphoneVolumeSlider_->value());
  setOutputVolume(outputVolumeSlider_->value());
  setMusicPlaybackVolume(musicPlaybackVolumeSlider_->value());
  rebuildBookmarksMenu();
  rebuildLiveStreamsMenu();
  updateWindowTitle();
}

void MainWindow::setUiLanguage(const UiLanguage language) {
  if (language_ == language && !windowTitle().isEmpty()) {
    return;
  }

  qApp->removeTranslator(translator_);
  language_ = language;
  bool translatorLoaded = false;
  if (language_ == UiLanguage::SimplifiedChinese) {
    translatorLoaded =
        translator_->load(QStringLiteral(":/i18n/baker_lite_zh_CN.qm"));
    if (!translatorLoaded) {
      translatorLoaded =
          translator_->load(QStringLiteral("baker_lite_zh_CN"),
                            QCoreApplication::applicationDirPath() +
                                QStringLiteral("/translations"));
    }
    if (translatorLoaded) {
      qApp->installTranslator(translator_);
    }
  }

  QSettings settings;
  settings.setValue(QStringLiteral("ui/language"), static_cast<int>(language_));
  retranslateUi();
  emit languageChanged(language_);
}

void MainWindow::setConnectionState(const ConnectionState state,
                                    const QString &statusText) {
  connectionState_ = state;
  connectionStatusText_ = statusText;
  const QString displayStatus =
      statusText.isEmpty() ? defaultConnectionText(state) : statusText;
  connectionIndicator_->setText(QStringLiteral("●  %1").arg(displayStatus));
  connectionIndicator_->setProperty("connectionState",
                                    connectionProperty(state));
  connectionIndicator_->style()->unpolish(connectionIndicator_);
  connectionIndicator_->style()->polish(connectionIndicator_);

  const bool connected = state == ConnectionState::Connected;
  const bool busy = state == ConnectionState::Connecting ||
                    state == ConnectionState::Reconnecting;
  const bool signedIn = !userId_.isEmpty();
  const bool sessionReady = connected && signedIn;
  connectAction_->setEnabled(!connected && !busy);
  disconnectAction_->setEnabled(connected || busy);
  logoutAction_->setEnabled(sessionReady);
  changeNameAction_->setEnabled(sessionReady);
  microphoneMuteAction_->setEnabled(sessionReady);
  outputMuteAction_->setEnabled(sessionReady);
  musicPlaybackVolumeAction_->setEnabled(sessionReady);
  devicesAction_->setEnabled(true);
  const bool canStream = sessionReady && !currentVoiceChannelId_.isEmpty();
  musicAction_->setEnabled(canStream &&
                           !musicAction_->property("active").toBool());
  screenAction_->setEnabled(canStream && !captureActive_);
  cameraAction_->setEnabled(canStream && !captureActive_);
  stopMusicAction_->setEnabled(canStream);
  stopCaptureAction_->setEnabled(sessionReady && captureActive_);
  chatEdit_->setEnabled(sessionReady && !currentChatChannelId_.isEmpty());
  sendButton_->setEnabled(sessionReady && !currentChatChannelId_.isEmpty());
  updateWindowTitle();
}

void MainWindow::setIdentity(const QString &userId,
                             const QString &displayName) {
  userId_ = userId;
  displayName_ = displayName;
  identityLabel_->setText(displayName_.isEmpty()
                              ? tr("Not signed in")
                              : tr("Signed in as %1").arg(displayName_));
  const bool signedIn = !userId_.isEmpty();
  const bool sessionReady =
      connectionState_ == ConnectionState::Connected && signedIn;
  logoutAction_->setEnabled(sessionReady);
  changeNameAction_->setEnabled(sessionReady);
  microphoneMuteAction_->setEnabled(sessionReady);
  outputMuteAction_->setEnabled(sessionReady);
  musicPlaybackVolumeAction_->setEnabled(sessionReady);
  const bool canStream = sessionReady && !currentVoiceChannelId_.isEmpty();
  musicAction_->setEnabled(canStream &&
                           !musicAction_->property("active").toBool());
  screenAction_->setEnabled(canStream && !captureActive_);
  cameraAction_->setEnabled(canStream && !captureActive_);
  stopMusicAction_->setEnabled(canStream);
  stopCaptureAction_->setEnabled(sessionReady && captureActive_);
  chatEdit_->setEnabled(sessionReady && !currentChatChannelId_.isEmpty());
  sendButton_->setEnabled(sessionReady && !currentChatChannelId_.isEmpty());
  updateWindowTitle();
}

void MainWindow::showServerTestResult(const bool success,
                                      const QString &message) {
  if (success) {
    QMessageBox::information(this, tr("Connection test"), message);
  } else {
    QMessageBox::warning(this, tr("Connection test"), message);
  }
}

void MainWindow::setCurrentServer(const QString &name, const QString &url,
                                  const QString &version) {
  serverName_ = name;
  currentServerUrl_ = url;
  serverVersion_ = version;
  suggestedLogin_.serverUrl = url;
  updateWindowTitle();
}

void MainWindow::setServerTree(const QList<ServerTreeItem> &items) {
  treeModel_->setItems(items);
  treeView_->expandToDepth(2);
}

void MainWindow::upsertServerTreeItem(const ServerTreeItem &item) {
  treeModel_->upsertItem(item);
}

void MainWindow::removeServerTreeItem(const QString &itemId) {
  treeModel_->removeItem(itemId);
}

void MainWindow::selectServerTreeItem(const QString &itemId) {
  const QModelIndex index = treeModel_->indexForId(itemId);
  if (!index.isValid()) {
    return;
  }
  treeView_->setCurrentIndex(index);
  treeView_->scrollTo(index);
}

void MainWindow::setDetailView(const DetailViewData &details) {
  QString kind;
  switch (details.kind) {
  case TreeItemKind::Server:
    kind = tr("Server");
    break;
  case TreeItemKind::Guild:
    kind = tr("Guild");
    break;
  case TreeItemKind::TextChannel:
    kind = tr("Text channel");
    break;
  case TreeItemKind::VoiceChannel:
    kind = tr("Voice channel");
    break;
  case TreeItemKind::User:
    kind = tr("User");
    break;
  }

  QString facts;
  if (!details.facts.isEmpty()) {
    facts = QStringLiteral("<dl>");
    for (const QString &fact : details.facts) {
      const qsizetype separator = fact.indexOf(QLatin1Char(':'));
      if (separator > 0) {
        facts += QStringLiteral("<dt>%1</dt><dd>%2</dd>")
                     .arg(fact.left(separator).toHtmlEscaped(),
                          fact.mid(separator + 1).trimmed().toHtmlEscaped());
      } else {
        facts += QStringLiteral("<dd>%1</dd>").arg(fact.toHtmlEscaped());
      }
    }
    facts += QStringLiteral("</dl>");
  }

  detailBrowser_->setHtml(
      QStringLiteral("<article class=\"details\">"
                     "<p class=\"eyebrow\">%1</p>"
                     "<h1>%2</h1>"
                     "<p class=\"subtitle\">%3</p>"
                     "<p>%4</p>"
                     "%5"
                     "</article>")
          .arg(kind.toHtmlEscaped(), details.title.toHtmlEscaped(),
               details.subtitle.toHtmlEscaped(),
               details.description.toHtmlEscaped().replace(
                   QStringLiteral("\n"), QStringLiteral("<br>")),
               facts));
  inspectorTabs_->setCurrentWidget(detailBrowser_);
}

void MainWindow::setChatContext(const QString &channelId,
                                const QString &channelName) {
  currentChatChannelId_ = channelId;
  currentChatChannelName_ = channelName;
  chatTitleLabel_->setText(channelId.isEmpty()
                               ? tr("No text channel selected")
                               : tr("Chat · %1").arg(channelName));
  chatEdit_->setPlaceholderText(
      channelId.isEmpty() ? tr("Select a text channel to send messages")
                          : tr("Message %1").arg(channelName));
  const bool enabled =
      connectionState_ == ConnectionState::Connected && !channelId.isEmpty();
  chatEdit_->setEnabled(enabled);
  sendButton_->setEnabled(enabled);
  loadOlderButton_->setEnabled(!channelId.isEmpty());
  chatSearchEdit_->setEnabled(!channelId.isEmpty());
}

void MainWindow::setChatMessages(const QList<ChatMessage> &messages) {
  chatBrowser_->clear();
  for (const auto &message : messages) {
    appendChatHtml(message);
  }
  chatBrowser_->verticalScrollBar()->setValue(
      chatBrowser_->verticalScrollBar()->maximum());
}

void MainWindow::appendChatMessage(const ChatMessage &message) {
  appendChatHtml(message);
}

void MainWindow::setChatHistoryLoading(const bool loading) {
  loadOlderButton_->setEnabled(!loading && !currentChatChannelId_.isEmpty());
  loadOlderButton_->setText(loading ? tr("Loading…") : tr("Older"));
}

void MainWindow::setChatSearchStatus(const QString &status) {
  chatSearchStatusLabel_->setText(status);
  chatSearchStatusLabel_->setVisible(!status.isEmpty());
}

void MainWindow::appendServerLog(const QString &line) {
  serverLog_->appendPlainText(line);
}

void MainWindow::appendConnectionLog(const QString &line) {
  connectionLog_->appendPlainText(line);
}

void MainWindow::clearLogs() {
  serverLog_->clear();
  connectionLog_->clear();
}

void MainWindow::setMicrophoneMuted(const bool muted) {
  const QSignalBlocker blocker(microphoneMuteAction_);
  microphoneMuteAction_->setChecked(muted);
  microphoneMuteAction_->setIcon(
      QIcon(iconPath(muted ? "microphone-muted" : "microphone")));
}

void MainWindow::setOutputMuted(const bool muted) {
  const QSignalBlocker blocker(outputMuteAction_);
  outputMuteAction_->setChecked(muted);
  outputMuteAction_->setIcon(
      QIcon(iconPath(muted ? "speaker-muted" : "speaker")));
}

void MainWindow::setVoiceChannel(const QString &channelId,
                                 const QString &channelName) {
  currentVoiceChannelId_ = channelId;
  currentVoiceChannelName_ = channelName;
  voiceStatusLabel_->setText(channelId.isEmpty()
                                 ? tr("Voice: not connected")
                                 : tr("Voice: %1").arg(channelName));
  leaveVoiceAction_->setEnabled(!channelId.isEmpty());
  const bool canStream = connectionState_ == ConnectionState::Connected &&
                         !userId_.isEmpty() && !channelId.isEmpty();
  screenAction_->setEnabled(canStream && !captureActive_);
  cameraAction_->setEnabled(canStream && !captureActive_);
  musicAction_->setEnabled(canStream &&
                           !musicAction_->property("active").toBool());
  if (channelId.isEmpty()) {
    stopCaptureAction_->setEnabled(false);
  }
  stopMusicAction_->setEnabled(canStream);
}

void MainWindow::setMusicSharing(const bool sharing,
                                 const QString &sourceName) {
  const bool canShare = connectionState_ == ConnectionState::Connected &&
                        !userId_.isEmpty() && !currentVoiceChannelId_.isEmpty();
  musicAction_->setEnabled(!sharing && canShare);
  stopMusicAction_->setEnabled(canShare);
  musicAction_->setProperty("active", sharing);
  musicAction_->setToolTip(sharing ? tr("Sharing audio from %1").arg(sourceName)
                                   : tr("Share music from an application"));
}

void MainWindow::setNetworkMetrics(const NetworkMetrics &metrics) {
  networkStatusLabel_->setText(tr("Ping %1 ms  ·  Loss %2%  ·  %3 kbps")
                                   .arg(metrics.roundTripMs)
                                   .arg(metrics.packetLossPercent, 0, 'f', 1)
                                   .arg(metrics.bitrateKbps));
}

void MainWindow::setLiveStatus(const QString &status) {
  liveStatus_ = status;
  liveStatusLabel_->setText(status.isEmpty() ? tr("No live streams") : status);
  updateLiveVisuals();
}

void MainWindow::setCaptureActive(const bool active) {
  captureActive_ = active;
  const bool sessionReady = connectionState_ == ConnectionState::Connected &&
                            !userId_.isEmpty() &&
                            !currentVoiceChannelId_.isEmpty();
  screenAction_->setEnabled(sessionReady && !active);
  cameraAction_->setEnabled(sessionReady && !active);
  stopCaptureAction_->setVisible(active);
  stopCaptureAction_->setEnabled(sessionReady && active);
  updateLiveVisuals();
}

void MainWindow::setMicrophoneVolume(const int volumePercent) {
  const int bounded = qBound(0, volumePercent, 100);
  const QSignalBlocker blocker(microphoneVolumeSlider_);
  microphoneVolumeSlider_->setValue(bounded);
  microphoneVolumeLabel_->setText(tr("Microphone volume: %1%").arg(bounded));
}

void MainWindow::setOutputVolume(const int volumePercent) {
  const int bounded = qBound(0, volumePercent, 200);
  const QSignalBlocker blocker(outputVolumeSlider_);
  outputVolumeSlider_->setValue(bounded);
  outputVolumeLabel_->setText(tr("Speaker volume: %1%").arg(bounded));
}

void MainWindow::setMusicPlaybackVolume(const int volumePercent) {
  const int bounded = qBound(0, volumePercent, 200);
  if (bounded > 0) {
    musicPlaybackVolumeBeforeMute_ = bounded;
  }
  const QSignalBlocker blocker(musicPlaybackVolumeSlider_);
  musicPlaybackVolumeSlider_->setValue(bounded);
  musicPlaybackVolumeLabel_->setText(
      tr("Shared music playback volume: %1%").arg(bounded));
  updateMusicPlaybackMuteUi();
}

void MainWindow::updateMusicPlaybackMuteUi() {
  if (musicPlaybackVolumeAction_ == nullptr ||
      musicPlaybackVolumeSlider_ == nullptr) {
    return;
  }
  const bool muted = musicPlaybackVolumeSlider_->value() == 0;
  const QSignalBlocker blocker(musicPlaybackVolumeAction_);
  musicPlaybackVolumeAction_->setChecked(muted);
  musicPlaybackVolumeAction_->setIcon(
      QIcon(iconPath(muted ? "music-volume-muted" : "music-volume")));
  musicPlaybackVolumeAction_->setText(muted ? tr("Unmute shared music")
                                            : tr("Mute shared music"));
  musicPlaybackVolumeAction_->setToolTip(
      muted
          ? tr("Click to unmute shared music. Hover to adjust playback volume.")
          : tr("Click to mute shared music. Hover to adjust playback volume."));
}

void MainWindow::updateLiveVisuals() {
  if (liveStatusLabel_ == nullptr) {
    return;
  }
  const bool active = captureActive_ || !availableStreams_.isEmpty();
  liveStatusLabel_->setProperty("liveActive", active);
  liveStatusLabel_->setStyleSheet(
      active ? QStringLiteral("QLabel { color: #ef626c; font-weight: 600; }")
             : QString());
}

void MainWindow::setAvailableStreams(const QList<LiveStreamOption> &streams) {
  availableStreams_ = streams;
  rebuildLiveStreamsMenu();
  updateLiveVisuals();
}

void MainWindow::setStreamRenderer(const QString &streamId,
                                   const QString &title, QWidget *renderer) {
  if (streamId.isEmpty() || renderer == nullptr) {
    return;
  }

  if (StreamWindow *existing = streamWindows_.value(streamId);
      existing != nullptr) {
    existing->setStreamTitle(title);
    existing->setVideoWidget(renderer);
    existing->show();
    existing->raise();
    existing->activateWindow();
    streamRenderers_.insert(streamId, renderer);
    streamTitles_.insert(streamId, title);
    return;
  }

  auto *window = new StreamWindow(streamId, this);
  window->setStreamTitle(title.isEmpty() ? tr("Live stream") : title);
  window->setVideoWidget(renderer);
  streamWindows_.insert(streamId, window);
  streamRenderers_.insert(streamId, renderer);
  streamTitles_.insert(streamId, title);
  connect(window, &StreamWindow::muteChanged, this,
          &MainWindow::streamMuteChanged);
  connect(window, &StreamWindow::volumeChanged, this,
          &MainWindow::streamVolumeChanged);
  connect(window, &StreamWindow::closeRequested, this,
          [this, window](const QString &id) {
            QWidget *renderer = window->takeVideoWidget();
            if (renderer != nullptr) {
              renderer->hide();
              renderer->setParent(nullptr);
              streamRenderers_.insert(id, renderer);
            }
            streamWindows_.remove(id);
            emit stopWatchingStreamRequested(id);
          });
  connect(window, &QObject::destroyed, this,
          [this, streamId] { streamWindows_.remove(streamId); });
  window->show();
  window->raise();
  window->activateWindow();
}

void MainWindow::removeStreamRenderer(const QString &streamId) {
  QWidget *renderer = streamRenderers_.take(streamId);
  StreamWindow *window = streamWindows_.take(streamId);

  if (window != nullptr) {
    disconnect(window, nullptr, this, nullptr);
    if (QWidget *attached = window->takeVideoWidget(); attached != nullptr) {
      renderer = attached;
    }
    window->close();
  }

  streamTitles_.remove(streamId);
  if (renderer != nullptr) {
    renderer->setParent(nullptr);
    emit streamRendererReleased(streamId, renderer);
  }
}

void MainWindow::setStreamStatus(const QString &streamId,
                                 const QString &status) {
  if (StreamWindow *window = streamWindows_.value(streamId);
      window != nullptr) {
    window->setStreamStatus(status);
    return;
  }
  setLiveStatus(status);
}

void MainWindow::detachStream(const QString &streamId) {
  if (StreamWindow *window = streamWindows_.value(streamId);
      window != nullptr) {
    window->show();
    window->raise();
    window->activateWindow();
  }
}

void MainWindow::reattachStream(const QString &streamId) {
  detachStream(streamId);
}

void MainWindow::setServerBookmarks(const QList<ServerBookmark> &bookmarks) {
  serverBookmarks_ = bookmarks;
  rebuildBookmarksMenu();
}

void MainWindow::setSuggestedLogin(const LoginCredentials &credentials) {
  suggestedLogin_ = credentials;
}

void MainWindow::setClientSettings(const ClientSettings &settings) {
  clientSettings_ = settings;
  const auto configureShortcut = [](QAction *action,
                                    const QString &portableText) {
    action->setShortcut(
        QKeySequence::fromString(portableText, QKeySequence::PortableText));
    action->setShortcutContext(Qt::ApplicationShortcut);
  };
  configureShortcut(connectAction_, settings.connectShortcut);
  configureShortcut(disconnectAction_, settings.disconnectShortcut);
  configureShortcut(leaveVoiceAction_, settings.leaveVoiceShortcut);
  configureShortcut(microphoneMuteAction_, settings.toggleMicrophoneShortcut);
  configureShortcut(outputMuteAction_, settings.toggleOutputShortcut);
  configureShortcut(musicPlaybackVolumeAction_,
                    settings.toggleMusicMuteShortcut);
  configureShortcut(microphoneVolumeDownAction_,
                    settings.microphoneVolumeDownShortcut);
  configureShortcut(microphoneVolumeUpAction_,
                    settings.microphoneVolumeUpShortcut);
  configureShortcut(outputVolumeDownAction_, settings.outputVolumeDownShortcut);
  configureShortcut(outputVolumeUpAction_, settings.outputVolumeUpShortcut);
  configureShortcut(musicVolumeDownAction_, settings.musicVolumeDownShortcut);
  configureShortcut(musicVolumeUpAction_, settings.musicVolumeUpShortcut);
  configureShortcut(stopCaptureAction_, settings.stopStreamShortcut);
  if (settings.language != language_) {
    setUiLanguage(settings.language);
  }
}

void MainWindow::setAudioDevices(const QList<AudioDeviceOption> &inputDevices,
                                 const QList<AudioDeviceOption> &outputDevices,
                                 const DeviceSelection &selection) {
  inputDevices_ = inputDevices;
  outputDevices_ = outputDevices;
  deviceSelection_ = selection;
}

void MainWindow::setCaptureSources(const QList<CaptureSourceOption> &sources,
                                   const CaptureSelection &selection) {
  captureSources_ = sources;
  captureSelection_ = selection;
}

void MainWindow::setMusicSources(const QList<MusicSourceOption> &sources,
                                 const MusicSourceSelection &selection) {
  musicSources_ = sources;
  musicSelection_ = selection;
  if (activeMusicSourceDialog_ != nullptr) {
    activeMusicSourceDialog_->setSources(musicSources_);
  }
}

void MainWindow::setUpdateReleases(const QList<UpdateRelease> &releases) {
  updateReleases_ = releases;
}

void MainWindow::showLoginDialog() {
  LoginDialog dialog(this);
  bool createAccount = false;
  QString registrationServer;
  connect(
      &dialog, &LoginDialog::createAccountRequested, this,
      [&dialog, &createAccount, &registrationServer](const QString &server) {
        createAccount = true;
        registrationServer = server;
        dialog.reject();
      });
  suggestedLogin_.serverUrl = suggestedLogin_.serverUrl.isEmpty()
                                  ? currentServerUrl_
                                  : suggestedLogin_.serverUrl;
  dialog.setCredentials(suggestedLogin_);
  if (dialog.exec() == QDialog::Accepted) {
    suggestedLogin_ = dialog.credentials();
    emit loginRequested(suggestedLogin_);
  } else if (createAccount) {
    suggestedLogin_.serverUrl = registrationServer;
    showRegistrationDialog();
  }
}

void MainWindow::showRegistrationDialog() {
  RegistrationDialog dialog(this);
  dialog.setServerUrl(currentServerUrl_.isEmpty() ? suggestedLogin_.serverUrl
                                                  : currentServerUrl_);
  if (dialog.exec() == QDialog::Accepted) {
    emit registrationRequested(dialog.registration());
  }
}

void MainWindow::showServerManagerDialog() {
  ServerManagerDialog dialog(this);
  dialog.setBookmarks(serverBookmarks_);
  connect(&dialog, &ServerManagerDialog::testServerRequested, this,
          &MainWindow::serverTestRequested);
  connect(&dialog, &ServerManagerDialog::createAccountRequested, this,
          [this, &dialog](const QString &server) {
            serverBookmarks_ = dialog.bookmarks();
            emit serverBookmarksChanged(serverBookmarks_);
            suggestedLogin_.serverUrl = server;
            dialog.reject();
            QTimer::singleShot(0, this, &MainWindow::showRegistrationDialog);
          });
  if (dialog.exec() == QDialog::Accepted) {
    serverBookmarks_ = dialog.bookmarks();
    const ServerBookmark selected = dialog.selectedBookmark();
    emit serverBookmarksChanged(serverBookmarks_);
    if (!selected.url.trimmed().isEmpty()) {
      emit serverConnectRequested(selected);
    }
  }
}

void MainWindow::showSettingsDialog() {
  SettingsDialog dialog(this);
  dialog.setSettings(clientSettings_);
  dialog.setDevices(inputDevices_, outputDevices_);
  dialog.setDeviceSelection(deviceSelection_);
  connect(&dialog, &SettingsDialog::refreshDevicesRequested, this,
          [this, &dialog] {
            emit audioDevicesRefreshRequested();
            dialog.setDevices(inputDevices_, outputDevices_);
            dialog.setDeviceSelection(deviceSelection_);
          });
  connect(&dialog, &SettingsDialog::testInputRequested, this,
          &MainWindow::audioInputTestRequested);
  connect(&dialog, &SettingsDialog::testOutputRequested, this,
          &MainWindow::audioOutputTestRequested);
  if (dialog.exec() == QDialog::Accepted) {
    clientSettings_ = dialog.settings();
    const DeviceSelection nextSelection = dialog.deviceSelection();
    if (nextSelection.inputDeviceId != deviceSelection_.inputDeviceId ||
        nextSelection.outputDeviceId != deviceSelection_.outputDeviceId) {
      deviceSelection_ = nextSelection;
      emit audioDeviceSelectionRequested(deviceSelection_);
    }
    setUiLanguage(clientSettings_.language);
    emit settingsChanged(clientSettings_);
  }
}

void MainWindow::showDeviceDialog() { showSettingsDialog(); }

void MainWindow::showScreenSourceDialog() {
  emit captureSourcesRefreshRequested();
  ScreenSourceDialog dialog(this);
  dialog.setSources(captureSources_);
  dialog.setSelection(captureSelection_);
  connect(&dialog, &ScreenSourceDialog::refreshRequested, this,
          [this, &dialog] {
            emit captureSourcesRefreshRequested();
            dialog.setSources(captureSources_);
          });
  if (dialog.exec() == QDialog::Accepted) {
    captureSelection_ = dialog.selection();
    emit startCaptureRequested(captureSelection_);
  }
}

void MainWindow::showCameraSourceDialog() {
  emit captureSourcesRefreshRequested();
  QList<CaptureSourceOption> cameras;
  for (const auto &source : captureSources_) {
    if (source.kind == CaptureSourceKind::Camera) {
      cameras.push_back(source);
    }
  }
  ScreenSourceDialog dialog(this);
  dialog.setWindowTitle(tr("Choose a camera"));
  dialog.setSources(cameras);
  CaptureSelection cameraSelection = captureSelection_;
  cameraSelection.kind = CaptureSourceKind::Camera;
  dialog.setSelection(cameraSelection);
  connect(&dialog, &ScreenSourceDialog::refreshRequested, this,
          [this, &dialog] {
            emit captureSourcesRefreshRequested();
            QList<CaptureSourceOption> refreshedCameras;
            for (const auto &source : captureSources_) {
              if (source.kind == CaptureSourceKind::Camera) {
                refreshedCameras.push_back(source);
              }
            }
            dialog.setSources(refreshedCameras);
          });
  if (dialog.exec() == QDialog::Accepted) {
    captureSelection_ = dialog.selection();
    emit startCaptureRequested(captureSelection_);
  }
}

void MainWindow::showMusicSourceDialog() {
  MusicSourceDialog dialog(this);
  activeMusicSourceDialog_ = &dialog;
  dialog.setSources(musicSources_);
  dialog.setSelection(musicSelection_);
  connect(&dialog, &MusicSourceDialog::refreshRequested, this,
          &MainWindow::musicSourcesRefreshRequested);
  QTimer levelTimer(&dialog);
  levelTimer.setInterval(250);
  connect(&levelTimer, &QTimer::timeout, this,
          &MainWindow::musicSourcesRefreshRequested);
  levelTimer.start();
  emit musicSourcesRefreshRequested();
  const int result = dialog.exec();
  activeMusicSourceDialog_.clear();
  if (result == QDialog::Accepted) {
    musicSelection_ = dialog.selection();
    emit startMusicSharingRequested(musicSelection_);
  }
}

void MainWindow::showUpdateDialog() {
  UpdateDialog dialog(this);
  dialog.setReleases(updateReleases_);
  connect(&dialog, &UpdateDialog::refreshRequested, this,
          &MainWindow::updateCatalogRefreshRequested);
  if (dialog.exec() == QDialog::Accepted) {
    const UpdateRelease release = dialog.selectedRelease();
    if (!release.version.isEmpty()) {
      emit installUpdateRequested(release);
    }
  }
}

void MainWindow::closeEvent(QCloseEvent *event) {
  saveUiState();
  QMainWindow::closeEvent(event);
}

void MainWindow::changeEvent(QEvent *event) {
  QMainWindow::changeEvent(event);
  if (event->type() == QEvent::LanguageChange) {
    retranslateUi();
  } else if (event->type() == QEvent::WindowStateChange) {
    const QSignalBlocker blocker(fullScreenAction_);
    fullScreenAction_->setChecked(isFullScreen());
  }
}

void MainWindow::restoreUiState() {
  QSettings settings;
  settings.beginGroup(QString::fromLatin1(kSettingsGroup));
  restoreGeometry(settings.value(QStringLiteral("geometry")).toByteArray());
  restoreState(settings.value(QStringLiteral("windowState")).toByteArray(), 1);

  const QByteArray workspaceState =
      settings.value(QStringLiteral("workspaceSplitter")).toByteArray();
  const QByteArray verticalState =
      settings.value(QStringLiteral("verticalSplitter")).toByteArray();
  const int workspaceVersion =
      settings.value(QStringLiteral("workspaceSplitterVersion"), 0).toInt();
  if (workspaceVersion == 3 && !workspaceState.isEmpty()) {
    workspaceSplitter_->restoreState(workspaceState);
  } else {
    workspaceSplitter_->setSizes({720, 240});
  }
  if (!verticalState.isEmpty()) {
    verticalSplitter_->restoreState(verticalState);
  } else {
    verticalSplitter_->setSizes({520, 260});
  }
  settings.endGroup();
}

void MainWindow::saveUiState() const {
  QSettings settings;
  settings.beginGroup(QString::fromLatin1(kSettingsGroup));
  settings.setValue(QStringLiteral("geometry"), saveGeometry());
  settings.setValue(QStringLiteral("windowState"), saveState(1));
  settings.setValue(QStringLiteral("workspaceSplitterVersion"), 3);
  settings.setValue(QStringLiteral("workspaceSplitter"),
                    workspaceSplitter_->saveState());
  settings.setValue(QStringLiteral("verticalSplitter"),
                    verticalSplitter_->saveState());
  settings.endGroup();
}

void MainWindow::loadStyleSheet() {
  QFile styleFile(QStringLiteral(":/styles/teamspeak.qss"));
  if (!styleFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
    styleFile.setFileName(QCoreApplication::applicationDirPath() +
                          QStringLiteral("/resources/styles/teamspeak.qss"));
    styleFile.open(QIODevice::ReadOnly | QIODevice::Text);
  }
  if (styleFile.isOpen()) {
    qApp->setStyleSheet(QString::fromUtf8(styleFile.readAll()));
  }
}

void MainWindow::rebuildBookmarksMenu() {
  if (bookmarksMenu_ == nullptr) {
    return;
  }
  bookmarksMenu_->clear();
  for (const ServerBookmark &bookmark : serverBookmarks_) {
    QString title = bookmark.name.isEmpty() ? bookmark.url : bookmark.name;
    if (bookmark.isDefault) {
      title += tr("  (default)");
    }
    QAction *action =
        bookmarksMenu_->addAction(QIcon(iconPath("server")), title);
    QString tooltip = bookmark.url;
    if (!bookmark.accountEmail.isEmpty()) {
      tooltip +=
          QStringLiteral("\n") + tr("Account: %1").arg(bookmark.accountEmail);
    }
    action->setToolTip(tooltip);
    connect(action, &QAction::triggered, this, [this, bookmark] {
      suggestedLogin_ = {
          bookmark.url,
          bookmark.accountEmail,
          bookmark.password,
          true,
      };
      emit serverConnectRequested(bookmark);
    });
  }
  if (!serverBookmarks_.isEmpty()) {
    bookmarksMenu_->addSeparator();
  }
  bookmarksMenu_->addAction(serverManagerAction_);
  bookmarksMenu_->addAction(registerAction_);
}

void MainWindow::rebuildLiveStreamsMenu() {
  if (liveStreamsMenu_ == nullptr) {
    return;
  }
  liveStreamsMenu_->clear();
  for (const LiveStreamOption &stream : availableStreams_) {
    const QString title =
        stream.channelName.isEmpty()
            ? tr("%1 is live").arg(stream.hostName)
            : tr("%1 in %2").arg(stream.hostName, stream.channelName);
    QAction *action =
        liveStreamsMenu_->addAction(QIcon(iconPath("screen")), title);
    connect(action, &QAction::triggered, this,
            [this, stream] { emit watchStreamByIdRequested(stream.streamId); });
  }
  if (availableStreams_.isEmpty()) {
    QAction *empty = liveStreamsMenu_->addAction(tr("No active live streams"));
    empty->setEnabled(false);
  }
  watchLiveAction_->setEnabled(!availableStreams_.isEmpty());
}

void MainWindow::showVolumeMenu(QToolButton *button, QMenu *menu) {
  if (button == nullptr || menu == nullptr || menu->isVisible()) {
    return;
  }
  menu->move(button->mapToGlobal(QPoint(0, button->height())));
  menu->show();
  menu->raise();
}

bool MainWindow::eventFilter(QObject *watched, QEvent *event) {
  if (event->type() == QEvent::Enter) {
    if (watched == microphoneToolButton_) {
      QToolTip::showText(microphoneToolButton_->mapToGlobal(
                             QPoint(microphoneToolButton_->width(), 0)),
                         microphoneMuteAction_->toolTip(),
                         microphoneToolButton_);
      showVolumeMenu(microphoneToolButton_, microphoneVolumeMenu_);
    } else if (watched == outputToolButton_) {
      QToolTip::showText(
          outputToolButton_->mapToGlobal(QPoint(outputToolButton_->width(), 0)),
          outputMuteAction_->toolTip(), outputToolButton_);
      showVolumeMenu(outputToolButton_, outputVolumeMenu_);
    } else if (watched == musicPlaybackVolumeToolButton_) {
      QToolTip::showText(musicPlaybackVolumeToolButton_->mapToGlobal(QPoint(
                             musicPlaybackVolumeToolButton_->width(), 0)),
                         musicPlaybackVolumeAction_->toolTip(),
                         musicPlaybackVolumeToolButton_);
      showVolumeMenu(musicPlaybackVolumeToolButton_, musicPlaybackVolumeMenu_);
    }
  } else if (event->type() == QEvent::MouseButtonPress) {
    if (watched == microphoneToolButton_) {
      microphoneVolumeMenu_->hide();
    } else if (watched == outputToolButton_) {
      outputVolumeMenu_->hide();
    } else if (watched == musicPlaybackVolumeToolButton_) {
      musicPlaybackVolumeMenu_->hide();
    }
    QToolTip::hideText();
  } else if (event->type() == QEvent::Leave) {
    QTimer::singleShot(300, this, [this] {
      const auto dismiss = [](QToolButton *button, QMenu *menu) {
        if (menu != nullptr && menu->isVisible() &&
            (button == nullptr || !button->underMouse()) &&
            !menu->underMouse()) {
          menu->hide();
        }
      };
      dismiss(microphoneToolButton_, microphoneVolumeMenu_);
      dismiss(outputToolButton_, outputVolumeMenu_);
      dismiss(musicPlaybackVolumeToolButton_, musicPlaybackVolumeMenu_);
    });
  }
  return QMainWindow::eventFilter(watched, event);
}

void MainWindow::showTreeContextMenu(const QPoint &position) {
  const QModelIndex index = treeView_->indexAt(position);
  if (!index.isValid()) {
    return;
  }
  treeView_->setCurrentIndex(index);
  const ServerTreeItem item = treeModel_->itemForIndex(index);

  QMenu menu(this);
  QAction *primaryAction = nullptr;
  QAction *secondaryAction = nullptr;
  QWidgetAction *volumeAction = nullptr;

  switch (item.kind) {
  case TreeItemKind::Server:
    primaryAction =
        menu.addAction(QIcon(iconPath("info")), tr("Server information"));
    primaryAction->setData(QStringLiteral("server.info"));
    secondaryAction = menu.addAction(tr("Mute server notifications"));
    secondaryAction->setData(QStringLiteral("server.notifications.mute"));
    break;
  case TreeItemKind::Guild:
    primaryAction =
        menu.addAction(QIcon(iconPath("info")), tr("Guild information"));
    primaryAction->setData(QStringLiteral("guild.info"));
    secondaryAction = menu.addAction(tr("Notification settings…"));
    secondaryAction->setData(QStringLiteral("guild.notifications"));
    break;
  case TreeItemKind::TextChannel:
    primaryAction = menu.addAction(QIcon(iconPath("chat")), tr("Open channel"));
    primaryAction->setData(QStringLiteral("channel.open"));
    secondaryAction = menu.addAction(tr("Mark as read"));
    secondaryAction->setData(QStringLiteral("channel.mark-read"));
    menu.addSeparator();
    if (auto *notificationAction =
            menu.addAction(tr("Notification settings…"))) {
      notificationAction->setData(QStringLiteral("channel.notifications"));
    }
    break;
  case TreeItemKind::VoiceChannel:
    primaryAction =
        menu.addAction(QIcon(iconPath("voice")), tr("Join voice channel"));
    primaryAction->setData(QStringLiteral("voice.join"));
    secondaryAction = menu.addAction(tr("Leave current voice channel"));
    secondaryAction->setData(QStringLiteral("voice.leave"));
    secondaryAction->setEnabled(!currentVoiceChannelId_.isEmpty());
    menu.addSeparator();
    if (auto *infoAction = menu.addAction(tr("Channel information"))) {
      infoAction->setData(QStringLiteral("channel.info"));
    }
    break;
  case TreeItemKind::User:
    primaryAction =
        menu.addAction(QIcon(iconPath("info")), tr("User information"));
    primaryAction->setData(QStringLiteral("user.info"));
    volumeAction = new QWidgetAction(&menu);
    {
      auto *volumePanel = new QWidget(&menu);
      auto *volumeLabel = new QLabel(volumePanel);
      auto *volumeSlider = new QSlider(Qt::Horizontal, volumePanel);
      volumeSlider->setRange(0, 200);
      volumeSlider->setSingleStep(5);
      volumeSlider->setValue(userVolumes_.value(item.id, 100));
      volumeSlider->setMinimumWidth(190);
      auto *volumeLayout = new QVBoxLayout(volumePanel);
      volumeLayout->setContentsMargins(10, 6, 10, 8);
      volumeLayout->addWidget(volumeLabel);
      volumeLayout->addWidget(volumeSlider);
      const auto updateVolume = [this, item, volumeLabel](const int volume) {
        volumeLabel->setText(tr("Playback volume: %1%").arg(volume));
        userVolumes_.insert(item.id, volume);
        emit userVolumeRequested(item.id, volume);
      };
      connect(volumeSlider, &QSlider::valueChanged, this, updateVolume);
      updateVolume(volumeSlider->value());
      volumeAction->setDefaultWidget(volumePanel);
    }
    menu.addAction(volumeAction);
    if (item.streaming) {
      auto *watchAction =
          menu.addAction(QIcon(iconPath("screen")), tr("Watch live stream"));
      watchAction->setData(QStringLiteral("stream.watch"));
    }
    if (item.sharingMusic) {
      auto *listenAction = menu.addAction(QIcon(iconPath("music")),
                                          tr("Listen to shared audio"));
      listenAction->setData(QStringLiteral("music.listen"));
    }
    menu.addSeparator();
    secondaryAction =
        menu.addAction(item.muted ? tr("Unmute user") : tr("Mute user"));
    secondaryAction->setData(item.muted ? QStringLiteral("user.unmute")
                                        : QStringLiteral("user.mute"));
    break;
  }

  QAction *selected = menu.exec(treeView_->viewport()->mapToGlobal(position));
  if (selected == nullptr) {
    return;
  }
  if (selected == volumeAction) {
    return;
  }

  const QString actionId = selected->data().toString();
  if (actionId == QStringLiteral("voice.join")) {
    emit joinVoiceChannelRequested(item.id);
  } else if (actionId == QStringLiteral("voice.leave")) {
    emit leaveVoiceChannelRequested();
  } else if (actionId == QStringLiteral("channel.open")) {
    emit textChannelSelected(item.id);
  } else if (actionId == QStringLiteral("stream.watch")) {
    emit watchStreamRequested(item.id);
  } else if (!actionId.isEmpty()) {
    emit contextActionRequested(actionId, item.id);
  }
}

void MainWindow::activateTreeIndex(const QModelIndex &index,
                                   const bool doubleClick) {
  if (!index.isValid()) {
    return;
  }
  const ServerTreeItem item = treeModel_->itemForIndex(index);
  emit treeSelectionChanged(item.id, item.kind);

  if (item.kind == TreeItemKind::TextChannel) {
    emit textChannelSelected(item.id);
  } else if (doubleClick && item.kind == TreeItemKind::VoiceChannel) {
    emit joinVoiceChannelRequested(item.id);
  } else if (doubleClick && item.kind == TreeItemKind::User && item.streaming) {
    emit watchStreamRequested(item.id);
  }
}

void MainWindow::sendCurrentMessage() {
  const QString message = chatEdit_->text().trimmed();
  if (message.isEmpty() || currentChatChannelId_.isEmpty()) {
    return;
  }
  emit sendMessageRequested(currentChatChannelId_, message);
  chatEdit_->clear();
}

void MainWindow::runCurrentSearch() {
  if (currentChatChannelId_.isEmpty()) {
    return;
  }
  emit searchMessagesRequested(currentChatChannelId_,
                               chatSearchEdit_->text().trimmed());
}

void MainWindow::appendChatHtml(const ChatMessage &message) {
  QScrollBar *scrollBar = chatBrowser_->verticalScrollBar();
  const bool wasAtBottom = scrollBar->value() >= scrollBar->maximum() - 8;
  const QString timestamp = message.timestamp.isValid()
                                ? message.timestamp.toLocalTime().toString(
                                      QStringLiteral("yyyy-MM-dd HH:mm"))
                                : QString();

  QString html;
  if (message.systemMessage) {
    html = QStringLiteral(
               "<p class=\"chat-system\"><span class=\"time\">%1</span> %2</p>")
               .arg(timestamp.toHtmlEscaped(),
                    message.body.toHtmlEscaped().replace(
                        QStringLiteral("\n"), QStringLiteral("<br>")));
  } else {
    html =
        QStringLiteral("<p class=\"chat-message%1\">"
                       "<span class=\"time\">%2</span>"
                       "<b>%3</b>"
                       "<span class=\"body\">%4</span>"
                       "</p>")
            .arg(message.ownMessage ? QStringLiteral(" own") : QString(),
                 timestamp.toHtmlEscaped(), message.authorName.toHtmlEscaped(),
                 message.body.toHtmlEscaped().replace(QStringLiteral("\n"),
                                                      QStringLiteral("<br>")));
  }

  QTextCursor cursor = chatBrowser_->textCursor();
  cursor.movePosition(QTextCursor::End);
  cursor.insertHtml(html);
  cursor.insertBlock();
  if (wasAtBottom) {
    scrollBar->setValue(scrollBar->maximum());
  }
}

void MainWindow::updateWindowTitle() {
  QStringList parts{QStringLiteral("Baker Lite")};
  if (!serverName_.isEmpty()) {
    parts.prepend(serverName_);
  }
  if (!displayName_.isEmpty()) {
    parts.prepend(displayName_);
  }
  setWindowTitle(parts.join(QStringLiteral("  —  ")));
}

QWidget *MainWindow::streamPage(const QString &streamId) const {
  return streamPages_.value(streamId);
}

QString MainWindow::streamIdForPage(QWidget *page) const {
  return page != nullptr ? page->property("streamId").toString() : QString();
}

QString MainWindow::defaultConnectionText(const ConnectionState state) const {
  switch (state) {
  case ConnectionState::Disconnected:
    return tr("Disconnected");
  case ConnectionState::Connecting:
    return tr("Connecting…");
  case ConnectionState::Connected:
    return currentServerUrl_.isEmpty()
               ? tr("Connected")
               : tr("Connected to %1").arg(currentServerUrl_);
  case ConnectionState::Reconnecting:
    return tr("Reconnecting…");
  case ConnectionState::Error:
    return tr("Connection error");
  }
  return tr("Disconnected");
}

} // namespace baker::lite::ui
