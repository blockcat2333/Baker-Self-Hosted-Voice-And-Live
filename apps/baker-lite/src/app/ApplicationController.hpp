#pragma once

#include "media/MediaTypes.hpp"
#include "network/ApiClient.h"
#include "protocol/ProtocolTypes.h"
#include "ui/UiTypes.h"
#include "update/UpdateService.hpp"

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QSettings>
#include <QUrl>

namespace baker::network {
class AuthSession;
class GatewayClient;
}

namespace baker::security {
class CredentialStore;
}

namespace baker::media {
class MediaCoordinator;
class VideoWidget;
}

namespace baker::lite::ui {
class MainWindow;
}

namespace baker::lite::app {

class ApplicationController final : public QObject {
  Q_OBJECT

 public:
  explicit ApplicationController(ui::MainWindow* window,
                                 QObject* parent = nullptr);
  ~ApplicationController() override;

  void start();

 private:
  enum class RequestAction {
    Health,
    PublicConfig,
    Guilds,
    Channels,
    Messages,
    OlderMessages,
    SendMessage,
    UpdateProfile,
  };

  struct PendingRequest {
    RequestAction action;
    QString context;
  };

  static std::optional<QUrl> normalizeServerUrl(const QString& value,
                                                 QString* error);
  static QUrl gatewayUrl(const QUrl& baseUrl);
  static ui::ChatMessage toUiMessage(const protocol::Message& message,
                                     const QString& localUserId);
  static ui::UpdateRelease toUiRelease(
      const update::ReleaseInfo& release);

  void connectUi();
  void connectNetwork();
  void connectMedia();
  void connectUpdates();
  void loadSettings();
  void saveBookmarks();
  void saveClientSettings(const ui::ClientSettings& settings);
  void probeServer(const QString& url);
  void configureServer(const ui::ServerBookmark& bookmark,
                       bool connectAfterProbe);
  void beginAuthenticatedSession(const protocol::AuthUser& user);
  void loadCommunity();
  void rebuildTree();
  void refreshAudioDevices();
  void refreshCaptureSources();
  void refreshMusicSources();
  void subscribeToChannel(const QString& channelId);
  void handleApiSuccess(quint64 id, const QJsonValue& payload);
  void handleApiFailure(quint64 id, const network::ApiError& error);
  void handleGatewayEvent(const QString& event, const QJsonValue& value);
  void handleRosterEvent(const QJsonObject& object);
  void handlePresenceEvent(const QJsonObject& object);
  void handleStreamState(const QJsonObject& object);
  void handleMusicState(const QJsonObject& object);
  void removeLocalUserFromRosters();
  QString channelName(const QString& channelId) const;
  QString userName(const QString& userId) const;
  QString streamForUser(const QString& userId) const;
  QString voiceChannelForStream(const QString& streamId) const;

  ui::MainWindow* window_;
  network::ApiClient* api_;
  security::CredentialStore* credentials_;
  network::GatewayClient* gateway_;
  network::AuthSession* auth_;
  media::MediaCoordinator* media_;
  update::UpdateService* updates_;
  QSettings settings_;

  QHash<quint64, PendingRequest> pendingRequests_;
  QList<ui::ServerBookmark> bookmarks_;
  ui::ClientSettings clientSettings_;
  ui::DeviceSelection deviceSelection_;
  QList<protocol::GuildSummary> guilds_;
  QHash<QString, QList<protocol::ChannelSummary>> channelsByGuild_;
  QHash<QString, QList<ui::ChatMessage>> messagesByChannel_;
  QHash<QString, QString> nextCursorByChannel_;
  QHash<QString, QJsonArray> rostersByChannel_;
  QHash<QString, QJsonObject> presenceByUser_;
  QHash<QString, bool> speakingByUser_;
  QHash<QString, int> networkQualityByUser_;
  QHash<QString, QString> streamByUser_;
  QHash<QString, QString> streamChannel_;
  QHash<QString, QString> musicByUser_;
  QHash<QString, QPointer<media::VideoWidget>> videoWidgets_;

  QUrl serverUrl_;
  QString serverName_;
  QString serverVersion_;
  QString currentUserId_;
  QString currentChatChannelId_;
  QString subscribedChannelId_;
  ui::ServerBookmark pendingBookmark_;
  bool connectAfterProbe_ = false;
  bool voiceSoundActive_ = false;
  bool streamSoundActive_ = false;
  int pendingChannelRequests_ = 0;
};

}  // namespace baker::lite::app
