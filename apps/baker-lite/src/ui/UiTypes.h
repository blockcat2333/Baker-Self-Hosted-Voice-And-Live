#pragma once

#include <QDateTime>
#include <QIcon>
#include <QList>
#include <QMetaType>
#include <QPixmap>
#include <QString>

namespace baker::lite::ui {

enum class UiLanguage {
  English,
  SimplifiedChinese,
};

enum class ConnectionState {
  Disconnected,
  Connecting,
  Connected,
  Reconnecting,
  Error,
};

enum class TreeItemKind {
  Server,
  Guild,
  TextChannel,
  VoiceChannel,
  User,
};

struct ServerTreeItem {
  QString id;
  QString parentId;
  QString name;
  QString subtitle;
  TreeItemKind kind = TreeItemKind::Server;
  bool online = false;
  bool muted = false;
  bool speaking = false;
  bool sharingMusic = false;
  bool streaming = false;
  int networkQuality = -1;
  int unreadCount = 0;
};

struct ChatMessage {
  QString id;
  QString authorId;
  QString authorName;
  QString body;
  QDateTime timestamp;
  bool ownMessage = false;
  bool systemMessage = false;
};

struct DetailViewData {
  QString id;
  TreeItemKind kind = TreeItemKind::Server;
  QString title;
  QString subtitle;
  QString description;
  QStringList facts;
};

struct ServerBookmark {
  QString id;
  QString name;
  QString url;
  bool isDefault = false;
  QString accountEmail;
  QString password;
  bool savePassword = false;
  bool autoLogin = false;
};

struct LoginCredentials {
  QString serverUrl;
  QString email;
  QString password;
  bool rememberLogin = true;
};

struct RegistrationData {
  QString serverUrl;
  QString displayName;
  QString email;
  QString password;
};

struct ClientSettings {
  UiLanguage language = UiLanguage::English;
  bool minimizeToTray = true;
  bool showDesktopNotifications = true;
  bool playNotificationSounds = true;
  bool startMuted = false;
  bool pushToTalk = false;
  QString pushToTalkShortcut;
  QString connectShortcut;
  QString disconnectShortcut;
  QString leaveVoiceShortcut;
  QString toggleMicrophoneShortcut;
  QString toggleOutputShortcut;
  QString toggleMusicMuteShortcut;
  QString microphoneVolumeDownShortcut;
  QString microphoneVolumeUpShortcut;
  QString outputVolumeDownShortcut;
  QString outputVolumeUpShortcut;
  QString musicVolumeDownShortcut;
  QString musicVolumeUpShortcut;
  QString stopStreamShortcut;
};

struct AudioDeviceOption {
  QString id;
  QString name;
  bool isDefault = false;
};

struct DeviceSelection {
  QString inputDeviceId;
  QString outputDeviceId;
};

enum class CaptureSourceKind {
  Screen,
  Window,
  Camera,
};

struct CaptureSourceOption {
  QString id;
  QString name;
  CaptureSourceKind kind = CaptureSourceKind::Screen;
  QPixmap thumbnail;
};

struct CaptureSelection {
  QString sourceId;
  CaptureSourceKind kind = CaptureSourceKind::Screen;
  bool shareAudio = true;
  int sharedAudioVolumePercent = 100;
  bool excludeOwnProcess = true;
  QString resolution = QStringLiteral("1280x720");
  int framesPerSecond = 30;
  int bitrateKbps = 4000;
  QString codec = QStringLiteral("H264");
};

struct MusicSourceOption {
  QString id;
  QString name;
  QString details;
  qint64 processId = 0;
  QIcon icon;
  int peakLevelPercent = 0;
};

struct MusicSourceSelection {
  QString sourceId;
  int volumePercent = 100;
  bool excludeOwnProcess = true;
};

struct UpdateRelease {
  QString version;
  QDateTime publishedAt;
  QString notes;
  bool current = false;
  bool prerelease = false;
};

struct NetworkMetrics {
  int roundTripMs = 0;
  double packetLossPercent = 0.0;
  int bitrateKbps = 0;
};

struct LiveStreamOption {
  QString streamId;
  QString hostUserId;
  QString hostName;
  QString channelName;
};

} // namespace baker::lite::ui

Q_DECLARE_METATYPE(baker::lite::ui::UiLanguage)
Q_DECLARE_METATYPE(baker::lite::ui::ConnectionState)
Q_DECLARE_METATYPE(baker::lite::ui::TreeItemKind)
Q_DECLARE_METATYPE(baker::lite::ui::ServerTreeItem)
Q_DECLARE_METATYPE(baker::lite::ui::ChatMessage)
Q_DECLARE_METATYPE(baker::lite::ui::DetailViewData)
Q_DECLARE_METATYPE(baker::lite::ui::ServerBookmark)
Q_DECLARE_METATYPE(baker::lite::ui::LoginCredentials)
Q_DECLARE_METATYPE(baker::lite::ui::RegistrationData)
Q_DECLARE_METATYPE(baker::lite::ui::ClientSettings)
Q_DECLARE_METATYPE(baker::lite::ui::DeviceSelection)
Q_DECLARE_METATYPE(baker::lite::ui::CaptureSelection)
Q_DECLARE_METATYPE(baker::lite::ui::MusicSourceSelection)
Q_DECLARE_METATYPE(baker::lite::ui::UpdateRelease)
Q_DECLARE_METATYPE(baker::lite::ui::NetworkMetrics)
Q_DECLARE_METATYPE(baker::lite::ui::LiveStreamOption)
