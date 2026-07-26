#pragma once

#include "ui/UiTypes.h"

#include <QHash>
#include <QMainWindow>
#include <QPointer>
#include <QString>

class QAction;
class QCloseEvent;
class QEvent;
class QLabel;
class QLineEdit;
class QMenu;
class QModelIndex;
class QPlainTextEdit;
class QPoint;
class QPushButton;
class QSlider;
class QSplitter;
class QTabWidget;
class QTextBrowser;
class QTimer;
class QToolBar;
class QToolButton;
class QTranslator;
class QTreeView;
class QWidget;

namespace baker::lite::ui {

class ServerTreeModel;
class StreamWindow;
class MusicSourceDialog;

class MainWindow final : public QMainWindow {
  Q_OBJECT

public:
  explicit MainWindow(QWidget *parent = nullptr);
  ~MainWindow() override;

  [[nodiscard]] ServerTreeModel *serverTreeModel() const;
  [[nodiscard]] UiLanguage uiLanguage() const;
  [[nodiscard]] QString currentServerUrl() const;

public slots:
  void setUiLanguage(UiLanguage language);
  void setConnectionState(ConnectionState state,
                          const QString &statusText = {});
  void setIdentity(const QString &userId, const QString &displayName);
  void showServerTestResult(bool success, const QString &message);
  void setCurrentServer(const QString &name, const QString &url,
                        const QString &version = {});
  void setServerTree(const QList<ServerTreeItem> &items);
  void upsertServerTreeItem(const ServerTreeItem &item);
  void removeServerTreeItem(const QString &itemId);
  void selectServerTreeItem(const QString &itemId);
  void setDetailView(const DetailViewData &details);

  void setChatContext(const QString &channelId, const QString &channelName);
  void setChatMessages(const QList<ChatMessage> &messages);
  void appendChatMessage(const ChatMessage &message);
  void setChatHistoryLoading(bool loading);
  void setChatSearchStatus(const QString &status);
  void appendServerLog(const QString &line);
  void appendConnectionLog(const QString &line);
  void clearLogs();

  void setMicrophoneMuted(bool muted);
  void setOutputMuted(bool muted);
  void setVoiceChannel(const QString &channelId, const QString &channelName);
  void setMusicSharing(bool sharing, const QString &sourceName = {});
  void setNetworkMetrics(const NetworkMetrics &metrics);
  void setLiveStatus(const QString &status);
  void setCaptureActive(bool active);
  void setMicrophoneVolume(int volumePercent);
  void setOutputVolume(int volumePercent);
  void setMusicPlaybackVolume(int volumePercent);
  void setAvailableStreams(const QList<LiveStreamOption> &streams);

  void setStreamRenderer(const QString &streamId, const QString &title,
                         QWidget *renderer);
  void removeStreamRenderer(const QString &streamId);
  void setStreamStatus(const QString &streamId, const QString &status);
  void detachStream(const QString &streamId);
  void reattachStream(const QString &streamId);

  void setServerBookmarks(const QList<ServerBookmark> &bookmarks);
  void setSuggestedLogin(const LoginCredentials &credentials);
  void setClientSettings(const ClientSettings &settings);
  void setAudioDevices(const QList<AudioDeviceOption> &inputDevices,
                       const QList<AudioDeviceOption> &outputDevices,
                       const DeviceSelection &selection);
  void setCaptureSources(const QList<CaptureSourceOption> &sources,
                         const CaptureSelection &selection = {});
  void setMusicSources(const QList<MusicSourceOption> &sources,
                       const MusicSourceSelection &selection = {});
  void setUpdateReleases(const QList<UpdateRelease> &releases);

  void showLoginDialog();
  void showRegistrationDialog();
  void showServerManagerDialog();
  void showSettingsDialog();
  void showDeviceDialog();
  void showScreenSourceDialog();
  void showCameraSourceDialog();
  void showMusicSourceDialog();
  void showUpdateDialog();

signals:
  void serverConnectRequested(const ServerBookmark &server);
  void disconnectRequested();
  void serverTestRequested(const QString &url);
  void serverBookmarksChanged(const QList<ServerBookmark> &bookmarks);

  void loginRequested(const LoginCredentials &credentials);
  void registrationRequested(const RegistrationData &registration);
  void logoutRequested();
  void changeDisplayNameRequested(const QString &displayName);

  void treeSelectionChanged(const QString &itemId, TreeItemKind kind);
  void textChannelSelected(const QString &channelId);
  void joinVoiceChannelRequested(const QString &channelId);
  void leaveVoiceChannelRequested();
  void contextActionRequested(const QString &actionId, const QString &itemId);
  void userVolumeRequested(const QString &userId, int volumePercent);

  void sendMessageRequested(const QString &channelId, const QString &text);
  void searchMessagesRequested(const QString &channelId, const QString &query);
  void loadOlderMessagesRequested(const QString &channelId);

  void microphoneMuteRequested(bool muted);
  void outputMuteRequested(bool muted);
  void microphoneVolumeRequested(int volumePercent);
  void outputVolumeRequested(int volumePercent);
  void musicPlaybackVolumeRequested(int volumePercent);
  void audioDeviceSelectionRequested(const DeviceSelection &selection);
  void audioDevicesRefreshRequested();
  void audioInputTestRequested(const QString &deviceId);
  void audioOutputTestRequested(const QString &deviceId);

  void startMusicSharingRequested(const MusicSourceSelection &selection);
  void stopMusicSharingRequested();
  void musicSourcesRefreshRequested();

  void startCaptureRequested(const CaptureSelection &selection);
  void stopCaptureRequested();
  void captureSourcesRefreshRequested();
  void watchStreamRequested(const QString &userId);
  void watchStreamByIdRequested(const QString &streamId);
  void stopWatchingStreamRequested(const QString &streamId);
  void streamMuteChanged(const QString &streamId, bool muted);
  void streamVolumeChanged(const QString &streamId, int volumePercent);
  void streamRendererReleased(const QString &streamId, QWidget *renderer);

  void settingsChanged(const ClientSettings &settings);
  void languageChanged(UiLanguage language);
  void updateCatalogRefreshRequested();
  void installUpdateRequested(const UpdateRelease &release);
  void openLogsFolderRequested();

protected:
  void closeEvent(QCloseEvent *event) override;
  void changeEvent(QEvent *event) override;
  bool eventFilter(QObject *watched, QEvent *event) override;

private:
  void buildUi();
  void createActions();
  void createMenus();
  void createToolBar();
  void createStatusBar();
  void connectUi();
  void retranslateUi();
  void restoreUiState();
  void saveUiState() const;
  void loadStyleSheet();
  void rebuildBookmarksMenu();
  void rebuildLiveStreamsMenu();
  void showVolumeMenu(QToolButton *button, QMenu *menu);
  void showTreeContextMenu(const QPoint &position);
  void activateTreeIndex(const QModelIndex &index, bool doubleClick);
  void sendCurrentMessage();
  void runCurrentSearch();
  void appendChatHtml(const ChatMessage &message);
  void updateMusicPlaybackMuteUi();
  void updateLiveVisuals();
  void updateWindowTitle();
  [[nodiscard]] QWidget *streamPage(const QString &streamId) const;
  [[nodiscard]] QString streamIdForPage(QWidget *page) const;
  [[nodiscard]] QString defaultConnectionText(ConnectionState state) const;

  ServerTreeModel *treeModel_ = nullptr;
  QTreeView *treeView_ = nullptr;
  QSplitter *verticalSplitter_ = nullptr;
  QSplitter *workspaceSplitter_ = nullptr;
  QTabWidget *inspectorTabs_ = nullptr;
  QTextBrowser *detailBrowser_ = nullptr;
  QTabWidget *streamsTabs_ = nullptr;
  QTabWidget *activityTabs_ = nullptr;
  QWidget *chatPage_ = nullptr;
  QWidget *serverLogPage_ = nullptr;
  QWidget *connectionLogPage_ = nullptr;
  QLabel *chatTitleLabel_ = nullptr;
  QLabel *chatSearchStatusLabel_ = nullptr;
  QTextBrowser *chatBrowser_ = nullptr;
  QLineEdit *chatEdit_ = nullptr;
  QLineEdit *chatSearchEdit_ = nullptr;
  QPushButton *sendButton_ = nullptr;
  QPushButton *loadOlderButton_ = nullptr;
  QPlainTextEdit *serverLog_ = nullptr;
  QPlainTextEdit *connectionLog_ = nullptr;
  QToolBar *mainToolBar_ = nullptr;

  QMenu *connectionsMenu_ = nullptr;
  QMenu *bookmarksMenu_ = nullptr;
  QMenu *selfMenu_ = nullptr;
  QMenu *viewMenu_ = nullptr;
  QMenu *toolsMenu_ = nullptr;
  QMenu *helpMenu_ = nullptr;

  QAction *connectAction_ = nullptr;
  QAction *disconnectAction_ = nullptr;
  QAction *serverManagerAction_ = nullptr;
  QAction *loginAction_ = nullptr;
  QAction *registerAction_ = nullptr;
  QAction *logoutAction_ = nullptr;
  QAction *changeNameAction_ = nullptr;
  QAction *leaveVoiceAction_ = nullptr;
  QAction *microphoneMuteAction_ = nullptr;
  QAction *outputMuteAction_ = nullptr;
  QAction *musicPlaybackVolumeAction_ = nullptr;
  QAction *microphoneVolumeDownAction_ = nullptr;
  QAction *microphoneVolumeUpAction_ = nullptr;
  QAction *outputVolumeDownAction_ = nullptr;
  QAction *outputVolumeUpAction_ = nullptr;
  QAction *musicVolumeDownAction_ = nullptr;
  QAction *musicVolumeUpAction_ = nullptr;
  QAction *devicesAction_ = nullptr;
  QAction *musicAction_ = nullptr;
  QAction *stopMusicAction_ = nullptr;
  QAction *screenAction_ = nullptr;
  QAction *cameraAction_ = nullptr;
  QAction *stopCaptureAction_ = nullptr;
  QAction *watchLiveAction_ = nullptr;
  QAction *settingsAction_ = nullptr;
  QAction *updatesAction_ = nullptr;
  QAction *openLogsAction_ = nullptr;
  QAction *quitAction_ = nullptr;
  QAction *fullScreenAction_ = nullptr;
  QAction *restoreLayoutAction_ = nullptr;
  QAction *aboutAction_ = nullptr;
  QMenu *liveStreamsMenu_ = nullptr;
  QMenu *microphoneVolumeMenu_ = nullptr;
  QMenu *outputVolumeMenu_ = nullptr;
  QMenu *musicPlaybackVolumeMenu_ = nullptr;
  QSlider *microphoneVolumeSlider_ = nullptr;
  QSlider *outputVolumeSlider_ = nullptr;
  QSlider *musicPlaybackVolumeSlider_ = nullptr;
  QLabel *microphoneVolumeLabel_ = nullptr;
  QLabel *outputVolumeLabel_ = nullptr;
  QLabel *musicPlaybackVolumeLabel_ = nullptr;
  QToolButton *microphoneToolButton_ = nullptr;
  QToolButton *outputToolButton_ = nullptr;
  QToolButton *musicPlaybackVolumeToolButton_ = nullptr;

  QLabel *connectionIndicator_ = nullptr;
  QLabel *identityLabel_ = nullptr;
  QLabel *voiceStatusLabel_ = nullptr;
  QLabel *networkStatusLabel_ = nullptr;
  QLabel *liveStatusLabel_ = nullptr;

  QTranslator *translator_ = nullptr;
  UiLanguage language_ = UiLanguage::English;
  ConnectionState connectionState_ = ConnectionState::Disconnected;
  QString connectionStatusText_;
  QString userId_;
  QString displayName_;
  QString serverName_;
  QString currentServerUrl_;
  QString serverVersion_;
  QString currentChatChannelId_;
  QString currentChatChannelName_;
  QString currentVoiceChannelId_;
  QString currentVoiceChannelName_;
  QString liveStatus_;
  bool captureActive_ = false;
  int musicPlaybackVolumeBeforeMute_ = 100;

  QList<ServerBookmark> serverBookmarks_;
  LoginCredentials suggestedLogin_;
  ClientSettings clientSettings_;
  QList<AudioDeviceOption> inputDevices_;
  QList<AudioDeviceOption> outputDevices_;
  DeviceSelection deviceSelection_;
  QList<CaptureSourceOption> captureSources_;
  CaptureSelection captureSelection_;
  QList<MusicSourceOption> musicSources_;
  QPointer<MusicSourceDialog> activeMusicSourceDialog_;
  MusicSourceSelection musicSelection_;
  QList<UpdateRelease> updateReleases_;
  QList<LiveStreamOption> availableStreams_;
  QHash<QString, int> userVolumes_;

  QHash<QString, QPointer<QWidget>> streamPages_;
  QHash<QString, QPointer<QWidget>> streamRenderers_;
  QHash<QString, QPointer<StreamWindow>> streamWindows_;
  QHash<QString, QString> streamTitles_;
};

} // namespace baker::lite::ui
