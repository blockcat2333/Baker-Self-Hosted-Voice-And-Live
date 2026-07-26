#include "ApplicationController.hpp"

#include "audio/ProcessLoopbackCapture.hpp"
#include "audio/UiSoundPlayer.hpp"
#include "media/MediaCatalog.hpp"
#include "media/MediaCoordinator.hpp"
#include "media/VideoWidget.hpp"
#include "network/AuthSession.h"
#include "network/GatewayClient.h"
#include "security/CredentialStore.h"
#include "ui/MainWindow.h"

#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QJsonArray>
#include <QJsonObject>
#include <QSet>
#include <QStandardPaths>
#include <QTimer>
#include <QUuid>

#include <algorithm>
#include <array>
#include <cmath>

namespace baker::lite::app {
namespace {

constexpr auto kServerNodeId = "server";

QString bookmarkCredentialKey(const QString &bookmarkId) {
  return QStringLiteral("bookmark-login:%1").arg(bookmarkId);
}

ui::TreeItemKind channelKind(const protocol::ChannelSummary &channel) {
  return channel.type == QStringLiteral("voice")
             ? ui::TreeItemKind::VoiceChannel
             : ui::TreeItemKind::TextChannel;
}

QString voiceUserNodeId(const QString &channelId, const QString &userId) {
  return QStringLiteral("voice-user:%1:%2").arg(channelId, userId);
}

QString userIdFromNode(const QString &nodeId) {
  const qsizetype separator = nodeId.lastIndexOf(u':');
  return nodeId.startsWith(QStringLiteral("voice-user:")) && separator >= 0
             ? nodeId.mid(separator + 1)
             : nodeId;
}

QString channelIdFromUserNode(const QString &nodeId) {
  if (!nodeId.startsWith(QStringLiteral("voice-user:"))) {
    return {};
  }
  const QString remainder = nodeId.mid(QStringLiteral("voice-user:").size());
  const qsizetype separator = remainder.indexOf(u':');
  return separator >= 0 ? remainder.left(separator) : QString();
}

QString resolutionName(const QString &value) {
  if (value.contains(QStringLiteral("2560")) ||
      value.contains(QStringLiteral("1440"))) {
    return QStringLiteral("1440p");
  }
  if (value.contains(QStringLiteral("1920")) ||
      value.contains(QStringLiteral("1080"))) {
    return QStringLiteral("1080p");
  }
  if (value.contains(QStringLiteral("854")) ||
      value.contains(QStringLiteral("480"))) {
    return QStringLiteral("480p");
  }
  return QStringLiteral("720p");
}

media::VideoCodec videoCodec(const QString &value) {
  if (value.compare(QStringLiteral("H264"), Qt::CaseInsensitive) == 0) {
    return media::VideoCodec::H264;
  }
  if (value.compare(QStringLiteral("VP8"), Qt::CaseInsensitive) == 0) {
    return media::VideoCodec::Vp8;
  }
  if (value.compare(QStringLiteral("VP9"), Qt::CaseInsensitive) == 0) {
    return media::VideoCodec::Vp9;
  }
  if (value.compare(QStringLiteral("AV1"), Qt::CaseInsensitive) == 0) {
    return media::VideoCodec::Av1;
  }
  return media::VideoCodec::Default;
}

int supportedStreamBitrate(const int requested) {
  constexpr std::array<int, 5> supported{2000, 4000, 6000, 10000, 16000};
  return *std::min_element(supported.cbegin(), supported.cend(),
                           [requested](const int left, const int right) {
                             return std::abs(left - requested) <
                                    std::abs(right - requested);
                           });
}

} // namespace

ApplicationController::ApplicationController(ui::MainWindow *window,
                                             QObject *parent)
    : QObject(parent), window_(window), api_(new network::ApiClient(this)),
      credentials_(new security::CredentialStore),
      gateway_(new network::GatewayClient(this)),
      auth_(new network::AuthSession(api_, credentials_, this)),
      media_(new media::MediaCoordinator(this)),
      updates_(new update::UpdateService(this)),
      settings_(QStringLiteral("Baker"), QStringLiteral("Baker Lite")) {
  Q_ASSERT(window_);
  auth_->bindGateway(gateway_);
  connectUi();
  connectNetwork();
  connectMedia();
  connectUpdates();
}

ApplicationController::~ApplicationController() {
  media_->shutdown();
  gateway_->disconnectFromServer();
  api_->abortAll();
  delete credentials_;
}

void ApplicationController::start() {
  loadSettings();
  refreshAudioDevices();
  refreshMusicSources();

  if (bookmarks_.isEmpty()) {
    QTimer::singleShot(0, window_, &ui::MainWindow::showServerManagerDialog);
    return;
  }
  const auto defaultServer = std::find_if(
      bookmarks_.cbegin(), bookmarks_.cend(),
      [](const ui::ServerBookmark &item) { return item.isDefault; });
  configureServer(defaultServer != bookmarks_.cend() ? *defaultServer
                                                     : bookmarks_.first(),
                  true);
}

std::optional<QUrl>
ApplicationController::normalizeServerUrl(const QString &value,
                                          QString *error) {
  QString input = value.trimmed();
  if (!input.contains(QStringLiteral("://"))) {
    input.prepend(QStringLiteral("http://"));
  }
  QUrl result = QUrl::fromUserInput(input);
  const QString scheme = result.scheme().toLower();
  if (!result.isValid() || result.host().isEmpty() ||
      (scheme != QStringLiteral("http") && scheme != QStringLiteral("https"))) {
    if (error) {
      *error = tr("Server address must be an absolute HTTP or HTTPS URL.");
    }
    return std::nullopt;
  }
  result.setScheme(scheme);
  result.setPath(QString());
  result.setQuery(QString());
  result.setFragment(QString());
  return result.adjusted(QUrl::StripTrailingSlash);
}

QUrl ApplicationController::gatewayUrl(const QUrl &baseUrl) {
  QUrl result(baseUrl);
  result.setScheme(baseUrl.scheme() == QStringLiteral("https")
                       ? QStringLiteral("wss")
                       : QStringLiteral("ws"));
  result.setPath(QStringLiteral("/ws"));
  return result;
}

ui::ChatMessage
ApplicationController::toUiMessage(const protocol::Message &message,
                                   const QString &localUserId) {
  return {message.id,
          message.authorUserId,
          message.authorUsername,
          message.content,
          message.createdAt,
          message.authorUserId == localUserId,
          message.kind == QStringLiteral("system")};
}

ui::UpdateRelease
ApplicationController::toUiRelease(const update::ReleaseInfo &release) {
  return {release.version, release.publishedAt, release.notes, release.current,
          release.prerelease};
}

void ApplicationController::connectUi() {
  connect(window_, &ui::MainWindow::serverConnectRequested, this,
          [this](const ui::ServerBookmark &server) {
            configureServer(server, true);
          });
  connect(window_, &ui::MainWindow::serverTestRequested, this,
          [this](const QString &url) { probeServer(url); });
  connect(window_, &ui::MainWindow::disconnectRequested, this, [this] {
    media_->shutdown();
    gateway_->disconnectFromServer();
    rostersByChannel_.clear();
    speakingByUser_.clear();
    networkQualityByUser_.clear();
    streamByUser_.clear();
    streamChannel_.clear();
    musicByUser_.clear();
    rebuildTree();
    window_->setAvailableStreams({});
    window_->setVoiceChannel({}, {});
    window_->setMusicSharing(false);
    window_->setCaptureActive(false);
    window_->setConnectionState(ui::ConnectionState::Disconnected);
    window_->appendConnectionLog(tr("Disconnected from server."));
  });
  connect(window_, &ui::MainWindow::serverBookmarksChanged, this,
          [this](const QList<ui::ServerBookmark> &bookmarks) {
            bookmarks_ = bookmarks;
            saveBookmarks();
          });

  connect(window_, &ui::MainWindow::loginRequested, this,
          [this](const ui::LoginCredentials &login) {
            QString error;
            const auto normalized = normalizeServerUrl(login.serverUrl, &error);
            if (!normalized) {
              window_->appendConnectionLog(error);
              return;
            }
            if (*normalized != serverUrl_) {
              ui::ServerBookmark server;
              server.name = normalized->host();
              server.url = normalized->toString();
              configureServer(server, false);
            }
            auth_->login(login.email, login.password, login.rememberLogin);
          });
  connect(window_, &ui::MainWindow::registrationRequested, this,
          [this](const ui::RegistrationData &registration) {
            QString error;
            const auto normalized =
                normalizeServerUrl(registration.serverUrl, &error);
            if (!normalized) {
              window_->appendConnectionLog(error);
              return;
            }
            if (*normalized != serverUrl_) {
              ui::ServerBookmark server;
              server.name = normalized->host();
              server.url = normalized->toString();
              configureServer(server, false);
            }
            auth_->registerUser(registration.email, registration.password,
                                registration.displayName, true);
          });
  connect(window_, &ui::MainWindow::logoutRequested, auth_,
          &network::AuthSession::logout);
  connect(window_, &ui::MainWindow::changeDisplayNameRequested, this,
          [this](const QString &name) {
            const quint64 id = api_->updateMe(name);
            pendingRequests_.insert(id,
                                    {RequestAction::UpdateProfile, QString()});
          });

  connect(window_, &ui::MainWindow::textChannelSelected, this,
          [this](const QString &channelId) {
            currentChatChannelId_ = channelId;
            subscribeToChannel(channelId);
            window_->setChatContext(channelId, channelName(channelId));
            if (messagesByChannel_.contains(channelId)) {
              window_->setChatMessages(messagesByChannel_.value(channelId));
            }
            const quint64 id = api_->listMessages(channelId);
            pendingRequests_.insert(id, {RequestAction::Messages, channelId});
            window_->setChatHistoryLoading(true);
          });
  connect(
      window_, &ui::MainWindow::treeSelectionChanged, this,
      [this](const QString &itemId, ui::TreeItemKind kind) {
        ui::DetailViewData details;
        details.id = itemId;
        details.kind = kind;
        if (kind == ui::TreeItemKind::Server) {
          details.title = serverName_;
          details.subtitle = serverUrl_.toString();
          details.facts = {
              tr("Version: %1").arg(serverVersion_),
              tr("Gateway: %1").arg(gatewayUrl(serverUrl_).toString())};
        } else if (kind == ui::TreeItemKind::User) {
          const QString userId = userIdFromNode(itemId);
          details.title = userName(userId);
          details.subtitle = userId;
          details.facts = {tr("Presence: %1")
                               .arg(presenceByUser_.value(userId)
                                        .value(QStringLiteral("status"))
                                        .toString(QStringLiteral("online"))),
                           streamByUser_.contains(userId) ? tr("Live: yes")
                                                          : tr("Live: no"),
                           musicByUser_.contains(userId) ? tr("Music: yes")
                                                         : tr("Music: no")};
        } else {
          details.title = channelName(itemId);
          details.subtitle =
              kind == ui::TreeItemKind::VoiceChannel
                  ? tr("Voice channel")
                  : (kind == ui::TreeItemKind::TextChannel ? tr("Text channel")
                                                           : tr("Guild"));
        }
        window_->setDetailView(details);
      });
  connect(window_, &ui::MainWindow::sendMessageRequested, this,
          [this](const QString &channelId, const QString &text) {
            const quint64 id = api_->sendMessage(channelId, text.trimmed());
            pendingRequests_.insert(id,
                                    {RequestAction::SendMessage, channelId});
          });
  connect(window_, &ui::MainWindow::loadOlderMessagesRequested, this,
          [this](const QString &channelId) {
            const QString cursor = nextCursorByChannel_.value(channelId);
            if (cursor.isEmpty()) {
              window_->setChatSearchStatus(tr("No older messages."));
              return;
            }
            const quint64 id = api_->listMessages(channelId, cursor);
            pendingRequests_.insert(id,
                                    {RequestAction::OlderMessages, channelId});
            window_->setChatHistoryLoading(true);
          });
  connect(window_, &ui::MainWindow::searchMessagesRequested, this,
          [this](const QString &channelId, const QString &query) {
            const QString needle = query.trimmed();
            if (needle.isEmpty()) {
              window_->setChatMessages(messagesByChannel_.value(channelId));
              window_->setChatSearchStatus({});
              return;
            }
            QList<ui::ChatMessage> matches;
            for (const auto &message : messagesByChannel_.value(channelId)) {
              if (message.body.contains(needle, Qt::CaseInsensitive) ||
                  message.authorName.contains(needle, Qt::CaseInsensitive)) {
                matches.append(message);
              }
            }
            window_->setChatMessages(matches);
            window_->setChatSearchStatus(
                tr("%1 local result(s)").arg(matches.size()));
          });

  connect(window_, &ui::MainWindow::joinVoiceChannelRequested, media_,
          &media::MediaCoordinator::joinVoice);
  connect(window_, &ui::MainWindow::leaveVoiceChannelRequested, media_,
          &media::MediaCoordinator::leaveVoice);
  connect(window_, &ui::MainWindow::microphoneMuteRequested, media_,
          &media::MediaCoordinator::setMicrophoneMuted);
  connect(window_, &ui::MainWindow::outputMuteRequested, media_,
          &media::MediaCoordinator::setOutputMuted);
  connect(window_, &ui::MainWindow::microphoneVolumeRequested, this,
          [this](const int volume) {
            settings_.setValue(QStringLiteral("audio/inputVolume"), volume);
            media_->setMicrophoneVolume(volume / 100.0);
          });
  connect(window_, &ui::MainWindow::outputVolumeRequested, this,
          [this](const int volume) {
            settings_.setValue(QStringLiteral("audio/outputVolume"), volume);
            media_->setMasterVolume(volume / 100.0);
          });
  connect(window_, &ui::MainWindow::musicPlaybackVolumeRequested, this,
          [this](const int volume) {
            settings_.setValue(QStringLiteral("audio/musicPlaybackVolume"),
                               volume);
            media_->setMusicPlaybackVolume(volume / 100.0);
          });
  connect(window_, &ui::MainWindow::userVolumeRequested, this,
          [this](const QString &userId, int volume) {
            media_->setParticipantVolume(userIdFromNode(userId),
                                         volume / 100.0);
          });
  connect(window_, &ui::MainWindow::contextActionRequested, this,
          [this](const QString &action, const QString &itemId) {
            const QString userId = userIdFromNode(itemId);
            const QString channelId = channelIdFromUserNode(itemId);
            if (action == QStringLiteral("music.listen")) {
              const QString musicId = musicByUser_.value(userId);
              if (!musicId.isEmpty()) {
                media_->listenToMusic(channelId, musicId);
              }
            } else if (action == QStringLiteral("user.mute")) {
              media_->setParticipantVolume(userId, 0.0);
            } else if (action == QStringLiteral("user.unmute")) {
              media_->setParticipantVolume(userId, 1.0);
            } else if (action.endsWith(QStringLiteral(".notifications")) ||
                       action == QStringLiteral("server.notifications.mute")) {
              settings_.setValue(
                  QStringLiteral("notifications/%1/%2").arg(action, itemId),
                  true);
              window_->appendServerLog(tr("Notification preference updated."));
            }
          });
  connect(window_, &ui::MainWindow::audioDeviceSelectionRequested, this,
          [this](const ui::DeviceSelection &selection) {
            deviceSelection_ = selection;
            settings_.setValue(QStringLiteral("audio/input"),
                               selection.inputDeviceId);
            settings_.setValue(QStringLiteral("audio/output"),
                               selection.outputDeviceId);
            media_->setInputDevice(selection.inputDeviceId);
            media_->setOutputDevice(selection.outputDeviceId);
          });
  connect(window_, &ui::MainWindow::audioDevicesRefreshRequested, this,
          &ApplicationController::refreshAudioDevices);
  connect(window_, &ui::MainWindow::audioInputTestRequested, this,
          [this](const QString &deviceId) {
            if (!deviceId.isEmpty()) {
              media_->setInputDevice(deviceId);
            }
            window_->appendConnectionLog(
                tr("Microphone device selected for testing."));
          });
  connect(window_, &ui::MainWindow::audioOutputTestRequested, this,
          [this](const QString &deviceId) {
            if (!deviceId.isEmpty()) {
              media_->setOutputDevice(deviceId);
            }
            audio::UiSoundPlayer::play(audio::UiSoundCue::OutputUnmuted);
          });

  connect(window_, &ui::MainWindow::startMusicSharingRequested, this,
          [this](const ui::MusicSourceSelection &selection) {
            media_->startMusicShare(media_->voiceChannelId(),
                                    selection.sourceId.toUInt(),
                                    selection.volumePercent / 100.0);
          });
  connect(window_, &ui::MainWindow::stopMusicSharingRequested, media_,
          &media::MediaCoordinator::stopAllMusic);
  connect(window_, &ui::MainWindow::musicSourcesRefreshRequested, this,
          &ApplicationController::refreshMusicSources);

  connect(window_, &ui::MainWindow::startCaptureRequested, this,
          [this](const ui::CaptureSelection &selection) {
            media::StreamQuality quality;
            quality.resolution = resolutionName(selection.resolution);
            quality.frameRate = selection.framesPerSecond;
            quality.bitrateKbps = supportedStreamBitrate(selection.bitrateKbps);
            quality.codec = videoCodec(selection.codec);
            media::StreamSourceType sourceType =
                media::StreamSourceType::Screen;
            if (selection.kind == ui::CaptureSourceKind::Camera) {
              sourceType = media::StreamSourceType::Camera;
            } else if (selection.kind == ui::CaptureSourceKind::Window) {
              sourceType = media::StreamSourceType::Window;
            }
            const QString channelId = media_->voiceChannelId();
            if (channelId.isEmpty()) {
              window_->appendServerLog(
                  tr("Join a voice channel before starting a live stream."));
              return;
            }
            media_->startStream(channelId, sourceType, selection.sourceId,
                                quality, selection.shareAudio,
                                selection.sharedAudioVolumePercent / 100.0);
            window_->setLiveStatus(tr("Starting live stream…"));
          });
  connect(window_, &ui::MainWindow::stopCaptureRequested, media_,
          &media::MediaCoordinator::stopOwnedStream);
  connect(window_, &ui::MainWindow::captureSourcesRefreshRequested, this,
          &ApplicationController::refreshCaptureSources);
  connect(window_, &ui::MainWindow::watchStreamRequested, this,
          [this](const QString &userId) {
            const QString actualUserId = userIdFromNode(userId);
            const QString streamId = streamForUser(actualUserId);
            if (!streamId.isEmpty()) {
              media_->watchStream(voiceChannelForStream(streamId), streamId);
            }
          });
  connect(window_, &ui::MainWindow::watchStreamByIdRequested, this,
          [this](const QString &streamId) {
            if (!streamId.isEmpty()) {
              media_->watchStream(voiceChannelForStream(streamId), streamId);
            }
          });
  connect(window_, &ui::MainWindow::stopWatchingStreamRequested, media_,
          &media::MediaCoordinator::unwatchStream);
  connect(window_, &ui::MainWindow::streamVolumeChanged, this,
          [this](const QString &streamId, int volume) {
            media_->setStreamVolume(streamId, volume / 100.0);
          });
  connect(window_, &ui::MainWindow::streamRendererReleased, this,
          [this](const QString &streamId, QWidget *renderer) {
            videoWidgets_.remove(streamId);
            if (renderer != nullptr) {
              renderer->deleteLater();
            }
          });

  connect(window_, &ui::MainWindow::settingsChanged, this,
          [this](const ui::ClientSettings &settings) {
            clientSettings_ = settings;
            saveClientSettings(settings);
          });
  connect(window_, &ui::MainWindow::updateCatalogRefreshRequested, updates_,
          &update::UpdateService::refreshCatalog);
  connect(window_, &ui::MainWindow::installUpdateRequested, this,
          [this](const ui::UpdateRelease &release) {
            updates_->downloadAndInstall(release.version);
          });
  connect(window_, &ui::MainWindow::openLogsFolderRequested, this, [] {
    const QString path =
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
        QStringLiteral("/logs");
    QDir().mkpath(path);
    QDesktopServices::openUrl(QUrl::fromLocalFile(path));
  });
}

void ApplicationController::connectNetwork() {
  connect(api_, &network::ApiClient::requestSucceeded, this,
          &ApplicationController::handleApiSuccess);
  connect(api_, &network::ApiClient::requestFailed, this,
          &ApplicationController::handleApiFailure);
  connect(auth_, &network::AuthSession::loginSucceeded, this,
          &ApplicationController::beginAuthenticatedSession);
  connect(auth_, &network::AuthSession::tokenRefreshed, this, [this] {
    if (const auto user = auth_->user()) {
      beginAuthenticatedSession(*user);
    }
  });
  connect(auth_, &network::AuthSession::loginFailed, this,
          [this](const network::ApiError &error) {
            window_->setConnectionState(ui::ConnectionState::Error,
                                        error.message);
            window_->appendConnectionLog(
                tr("Authentication failed: %1").arg(error.message));
            window_->showLoginDialog();
          });
  connect(auth_, &network::AuthSession::sessionExpired, this, [this] {
    gateway_->disconnectFromServer();
    window_->setConnectionState(ui::ConnectionState::Error,
                                tr("Session expired"));
    window_->showLoginDialog();
  });
  connect(auth_, &network::AuthSession::loggedOut, this, [this] {
    media_->shutdown();
    gateway_->disconnectFromServer();
    currentUserId_.clear();
    window_->setIdentity({}, {});
    window_->setConnectionState(ui::ConnectionState::Disconnected,
                                tr("Logged out"));
  });

  connect(gateway_, &network::GatewayClient::stateChanged, this,
          [this](network::GatewayClient::State state) {
            if (state == network::GatewayClient::State::Ready) {
              window_->setConnectionState(ui::ConnectionState::Connected);
            } else if (state == network::GatewayClient::State::Reconnecting) {
              window_->setConnectionState(ui::ConnectionState::Reconnecting);
            }
          });
  connect(gateway_, &network::GatewayClient::eventReceived, this,
          &ApplicationController::handleGatewayEvent);
  connect(gateway_, &network::GatewayClient::commandSucceeded, this,
          [this](const QString &id, const QJsonValue &value) {
            media_->handleGatewayAck(id, value.toObject());
          });
  connect(gateway_, &network::GatewayClient::commandFailed, this,
          [this](const QString &id, const network::GatewayError &error) {
            media_->handleGatewayError(id, error.code, error.message);
            window_->appendConnectionLog(
                tr("Command failed (%1): %2").arg(error.code, error.message));
          });
  connect(gateway_, &network::GatewayClient::latencyUpdated, this,
          [this](int latency) {
            ui::NetworkMetrics metrics;
            metrics.roundTripMs = latency;
            window_->setNetworkMetrics(metrics);
          });
  connect(
      gateway_, &network::GatewayClient::transportError, this,
      [this](const QString &error) { window_->appendConnectionLog(error); });
  connect(gateway_, &network::GatewayClient::reconnectScheduled, this,
          [this](int attempt, int delay) {
            window_->appendConnectionLog(
                tr("Reconnect attempt %1 in %2 ms").arg(attempt).arg(delay));
          });
  connect(gateway_, &network::GatewayClient::resyncRequired, this, [this] {
    window_->appendConnectionLog(tr("Gateway requested a full resync."));
    loadCommunity();
    media_->recoverActiveSessions();
  });
}

void ApplicationController::connectMedia() {
  connect(media_, &media::MediaCoordinator::gatewayCommandRequested, this,
          [this](const QString &id, const QString &command,
                 const QJsonObject &data) {
            const QString requestId = gateway_->sendCommand(command, data, id);
            Q_UNUSED(requestId)
          });
  connect(media_, &media::MediaCoordinator::voiceStateChanged, this,
          [this](media::RuntimeState state, const QString &channelId) {
            if (state == media::RuntimeState::Active) {
              window_->setVoiceChannel(channelId, channelName(channelId));
              if (!voiceSoundActive_ &&
                  clientSettings_.playNotificationSounds) {
                audio::UiSoundPlayer::play(audio::UiSoundCue::JoinedChannel);
              }
              voiceSoundActive_ = true;
            } else if (state == media::RuntimeState::Idle ||
                       state == media::RuntimeState::Failed) {
              removeLocalUserFromRosters();
              window_->setVoiceChannel({}, {});
              if (voiceSoundActive_ && clientSettings_.playNotificationSounds) {
                audio::UiSoundPlayer::play(audio::UiSoundCue::LeftChannel);
              }
              voiceSoundActive_ = false;
            }
          });
  connect(media_, &media::MediaCoordinator::streamStartFailed, this,
          [this](const QString &message) {
            window_->setCaptureActive(false);
            window_->setLiveStatus(tr("Live stream failed: %1").arg(message));
          });
  connect(media_, &media::MediaCoordinator::microphoneMutedChanged, window_,
          &ui::MainWindow::setMicrophoneMuted);
  connect(media_, &media::MediaCoordinator::outputMutedChanged, window_,
          &ui::MainWindow::setOutputMuted);
  connect(media_, &media::MediaCoordinator::microphoneMutedChanged, this,
          [this](const bool muted) {
            if (clientSettings_.playNotificationSounds) {
              audio::UiSoundPlayer::play(
                  muted ? audio::UiSoundCue::MicrophoneMuted
                        : audio::UiSoundCue::MicrophoneUnmuted);
            }
          });
  connect(media_, &media::MediaCoordinator::outputMutedChanged, this,
          [this](const bool muted) {
            if (clientSettings_.playNotificationSounds) {
              audio::UiSoundPlayer::play(
                  muted ? audio::UiSoundCue::OutputMuted
                        : audio::UiSoundCue::OutputUnmuted);
            }
          });
  connect(media_, &media::MediaCoordinator::streamStateChanged, this, [this] {
    const bool active = media_->hasOwnedStream();
    window_->setCaptureActive(active);
    if (active != streamSoundActive_ &&
        clientSettings_.playNotificationSounds) {
      audio::UiSoundPlayer::play(active ? audio::UiSoundCue::StreamStarted
                                        : audio::UiSoundCue::StreamStopped);
    }
    streamSoundActive_ = active;
  });
  connect(media_, &media::MediaCoordinator::streamWatchEnded, this,
          [this](const QString &streamId) {
            window_->removeStreamRenderer(streamId);
          });
  connect(media_, &media::MediaCoordinator::notificationRequested, this,
          [this](const QString &level, const QString &message) {
            window_->appendServerLog(
                QStringLiteral("[%1] %2").arg(level, message));
          });
  connect(media_, &media::MediaCoordinator::mediaError, this,
          [this](const QString &scope, const QString &message) {
            window_->appendConnectionLog(
                tr("Media error [%1]: %2").arg(scope, message));
            if (scope == QStringLiteral("stream")) {
              window_->setLiveStatus(tr("Live stream failed: %1").arg(message));
            }
          });
  connect(media_, &media::MediaCoordinator::remoteVideoFrameAvailable, this,
          [this](const QString &streamId, const QImage &image) {
            auto *widget = videoWidgets_.value(streamId).data();
            if (!widget) {
              widget = new media::VideoWidget;
              videoWidgets_.insert(streamId, widget);
              const QString hostId = streamByUser_.key(streamId);
              const QString title =
                  hostId.isEmpty()
                      ? tr("Live stream")
                      : tr("%1 — Live stream").arg(userName(hostId));
              window_->setStreamRenderer(streamId, title, widget);
            }
            widget->setFrame(image);
          });
  connect(media_, &media::MediaCoordinator::statisticsUpdated, this,
          [this](const QString &sessionId,
                 const media::MediaStatistics &statistics) {
            const QString status =
                tr("%1 · %2x%3 · %4 FPS · %5 kbps · %6% loss")
                    .arg(statistics.codec)
                    .arg(statistics.frameSize.width())
                    .arg(statistics.frameSize.height())
                    .arg(statistics.framesPerSecond, 0, 'f', 1)
                    .arg(statistics.bitrateKbps, 0, 'f', 0)
                    .arg(statistics.packetLossPercent, 0, 'f', 1);
            window_->setStreamStatus(sessionId, status);
          });
}

void ApplicationController::connectUpdates() {
  connect(updates_, &update::UpdateService::catalogReady, this,
          [this](const QList<update::ReleaseInfo> &releases) {
            QList<ui::UpdateRelease> uiReleases;
            uiReleases.reserve(releases.size());
            for (const auto &release : releases) {
              uiReleases.append(toUiRelease(release));
            }
            window_->setUpdateReleases(uiReleases);
          });
  connect(updates_, &update::UpdateService::catalogFailed, this,
          [this](const QString &message) {
            window_->appendConnectionLog(
                tr("Update catalog failed: %1").arg(message));
          });
  connect(updates_, &update::UpdateService::downloadProgress, this,
          [this](const QString &version, qint64 received, qint64 total) {
            const int percent =
                total > 0 ? static_cast<int>(received * 100 / total) : 0;
            window_->setLiveStatus(
                tr("Downloading %1: %2%").arg(version).arg(percent));
          });
  connect(updates_, &update::UpdateService::updateFailed, this,
          [this](const QString &version, const QString &message) {
            window_->appendConnectionLog(
                tr("Update %1 failed: %2").arg(version, message));
          });
}

void ApplicationController::loadSettings() {
  settings_.beginGroup(QStringLiteral("client"));
  clientSettings_.language =
      settings_.value(QStringLiteral("language"), QStringLiteral("en"))
                  .toString() == QStringLiteral("zh_CN")
          ? ui::UiLanguage::SimplifiedChinese
          : ui::UiLanguage::English;
  clientSettings_.minimizeToTray =
      settings_.value(QStringLiteral("minimizeToTray"), true).toBool();
  clientSettings_.showDesktopNotifications =
      settings_.value(QStringLiteral("notifications"), true).toBool();
  clientSettings_.playNotificationSounds =
      settings_.value(QStringLiteral("sounds"), true).toBool();
  clientSettings_.startMuted =
      settings_.value(QStringLiteral("startMuted"), false).toBool();
  clientSettings_.pushToTalk =
      settings_.value(QStringLiteral("pushToTalk"), false).toBool();
  clientSettings_.pushToTalkShortcut =
      settings_.value(QStringLiteral("pushToTalkShortcut")).toString();
  clientSettings_.connectShortcut =
      settings_.value(QStringLiteral("shortcuts/connect")).toString();
  clientSettings_.disconnectShortcut =
      settings_.value(QStringLiteral("shortcuts/disconnect")).toString();
  clientSettings_.leaveVoiceShortcut =
      settings_.value(QStringLiteral("shortcuts/leaveVoice")).toString();
  clientSettings_.toggleMicrophoneShortcut =
      settings_.value(QStringLiteral("shortcuts/toggleMicrophone")).toString();
  clientSettings_.toggleOutputShortcut =
      settings_.value(QStringLiteral("shortcuts/toggleOutput")).toString();
  clientSettings_.toggleMusicMuteShortcut =
      settings_.value(QStringLiteral("shortcuts/toggleMusicMute")).toString();
  clientSettings_.microphoneVolumeDownShortcut =
      settings_.value(QStringLiteral("shortcuts/microphoneVolumeDown"))
          .toString();
  clientSettings_.microphoneVolumeUpShortcut =
      settings_.value(QStringLiteral("shortcuts/microphoneVolumeUp"))
          .toString();
  clientSettings_.outputVolumeDownShortcut =
      settings_.value(QStringLiteral("shortcuts/outputVolumeDown")).toString();
  clientSettings_.outputVolumeUpShortcut =
      settings_.value(QStringLiteral("shortcuts/outputVolumeUp")).toString();
  clientSettings_.musicVolumeDownShortcut =
      settings_.value(QStringLiteral("shortcuts/musicVolumeDown")).toString();
  clientSettings_.musicVolumeUpShortcut =
      settings_.value(QStringLiteral("shortcuts/musicVolumeUp")).toString();
  clientSettings_.stopStreamShortcut =
      settings_.value(QStringLiteral("shortcuts/stopStream")).toString();
  settings_.endGroup();
  window_->setClientSettings(clientSettings_);

  deviceSelection_.inputDeviceId =
      settings_.value(QStringLiteral("audio/input")).toString();
  deviceSelection_.outputDeviceId =
      settings_.value(QStringLiteral("audio/output")).toString();
  const int inputVolume =
      settings_.value(QStringLiteral("audio/inputVolume"), 100).toInt();
  const int outputVolume =
      settings_.value(QStringLiteral("audio/outputVolume"), 100).toInt();
  const int musicPlaybackVolume =
      settings_.value(QStringLiteral("audio/musicPlaybackVolume"), 100).toInt();
  window_->setMicrophoneVolume(inputVolume);
  window_->setOutputVolume(outputVolume);
  window_->setMusicPlaybackVolume(musicPlaybackVolume);
  media_->setMicrophoneVolume(inputVolume / 100.0);
  media_->setMasterVolume(outputVolume / 100.0);
  media_->setMusicPlaybackVolume(musicPlaybackVolume / 100.0);

  const int count = settings_.beginReadArray(QStringLiteral("servers"));
  for (int index = 0; index < count; ++index) {
    settings_.setArrayIndex(index);
    ui::ServerBookmark bookmark;
    bookmark.id = settings_.value(QStringLiteral("id")).toString();
    bookmark.name = settings_.value(QStringLiteral("name")).toString();
    bookmark.url = settings_.value(QStringLiteral("url")).toString();
    bookmark.isDefault =
        settings_.value(QStringLiteral("default"), false).toBool();
    bookmark.accountEmail =
        settings_.value(QStringLiteral("accountEmail")).toString();
    bookmark.savePassword =
        settings_.value(QStringLiteral("savePassword"), false).toBool();
    bookmark.autoLogin =
        settings_.value(QStringLiteral("autoLogin"), false).toBool();
    if (bookmark.savePassword && !bookmark.id.isEmpty()) {
      QString credentialError;
      const auto credential = credentials_->read(
          bookmarkCredentialKey(bookmark.id), &credentialError);
      if (credential) {
        bookmark.accountEmail = credential->username;
        bookmark.password = QString::fromUtf8(credential->secret);
      } else if (!credentialError.isEmpty()) {
        window_->appendConnectionLog(tr("Unable to load credentials for %1: %2")
                                         .arg(bookmark.name, credentialError));
      }
    }
    if (!bookmark.url.isEmpty()) {
      bookmarks_.append(bookmark);
    }
  }
  settings_.endArray();
  window_->setServerBookmarks(bookmarks_);
}

void ApplicationController::saveBookmarks() {
  QStringList previousIds;
  const int previousCount = settings_.beginReadArray(QStringLiteral("servers"));
  for (int index = 0; index < previousCount; ++index) {
    settings_.setArrayIndex(index);
    previousIds.append(settings_.value(QStringLiteral("id")).toString());
  }
  settings_.endArray();

  settings_.beginWriteArray(QStringLiteral("servers"), bookmarks_.size());
  for (int index = 0; index < bookmarks_.size(); ++index) {
    settings_.setArrayIndex(index);
    const auto &bookmark = bookmarks_.at(index);
    settings_.setValue(QStringLiteral("id"), bookmark.id);
    settings_.setValue(QStringLiteral("name"), bookmark.name);
    settings_.setValue(QStringLiteral("url"), bookmark.url);
    settings_.setValue(QStringLiteral("default"), bookmark.isDefault);
    settings_.setValue(QStringLiteral("accountEmail"), bookmark.accountEmail);
    settings_.setValue(QStringLiteral("savePassword"), bookmark.savePassword);
    settings_.setValue(QStringLiteral("autoLogin"), bookmark.autoLogin);
    QString credentialError;
    if (bookmark.savePassword && !bookmark.password.isEmpty()) {
      if (!credentials_->write(bookmarkCredentialKey(bookmark.id),
                               bookmark.accountEmail,
                               bookmark.password.toUtf8(), &credentialError)) {
        window_->appendConnectionLog(tr("Unable to save credentials for %1: %2")
                                         .arg(bookmark.name, credentialError));
      }
    } else {
      const bool removed = credentials_->remove(
          bookmarkCredentialKey(bookmark.id), &credentialError);
      Q_UNUSED(removed)
    }
  }
  settings_.endArray();
  for (const QString &previousId : previousIds) {
    const bool retained =
        std::any_of(bookmarks_.cbegin(), bookmarks_.cend(),
                    [&previousId](const ui::ServerBookmark &bookmark) {
                      return bookmark.id == previousId;
                    });
    if (!retained && !previousId.isEmpty()) {
      QString ignored;
      const bool removed =
          credentials_->remove(bookmarkCredentialKey(previousId), &ignored);
      Q_UNUSED(removed)
    }
  }
  settings_.sync();
}

void ApplicationController::saveClientSettings(
    const ui::ClientSettings &settings) {
  settings_.beginGroup(QStringLiteral("client"));
  settings_.setValue(QStringLiteral("language"),
                     settings.language == ui::UiLanguage::SimplifiedChinese
                         ? QStringLiteral("zh_CN")
                         : QStringLiteral("en"));
  settings_.setValue(QStringLiteral("minimizeToTray"), settings.minimizeToTray);
  settings_.setValue(QStringLiteral("notifications"),
                     settings.showDesktopNotifications);
  settings_.setValue(QStringLiteral("sounds"), settings.playNotificationSounds);
  settings_.setValue(QStringLiteral("startMuted"), settings.startMuted);
  settings_.setValue(QStringLiteral("pushToTalk"), settings.pushToTalk);
  settings_.setValue(QStringLiteral("pushToTalkShortcut"),
                     settings.pushToTalkShortcut);
  settings_.setValue(QStringLiteral("shortcuts/connect"),
                     settings.connectShortcut);
  settings_.setValue(QStringLiteral("shortcuts/disconnect"),
                     settings.disconnectShortcut);
  settings_.setValue(QStringLiteral("shortcuts/leaveVoice"),
                     settings.leaveVoiceShortcut);
  settings_.setValue(QStringLiteral("shortcuts/toggleMicrophone"),
                     settings.toggleMicrophoneShortcut);
  settings_.setValue(QStringLiteral("shortcuts/toggleOutput"),
                     settings.toggleOutputShortcut);
  settings_.setValue(QStringLiteral("shortcuts/toggleMusicMute"),
                     settings.toggleMusicMuteShortcut);
  settings_.setValue(QStringLiteral("shortcuts/microphoneVolumeDown"),
                     settings.microphoneVolumeDownShortcut);
  settings_.setValue(QStringLiteral("shortcuts/microphoneVolumeUp"),
                     settings.microphoneVolumeUpShortcut);
  settings_.setValue(QStringLiteral("shortcuts/outputVolumeDown"),
                     settings.outputVolumeDownShortcut);
  settings_.setValue(QStringLiteral("shortcuts/outputVolumeUp"),
                     settings.outputVolumeUpShortcut);
  settings_.setValue(QStringLiteral("shortcuts/musicVolumeDown"),
                     settings.musicVolumeDownShortcut);
  settings_.setValue(QStringLiteral("shortcuts/musicVolumeUp"),
                     settings.musicVolumeUpShortcut);
  settings_.setValue(QStringLiteral("shortcuts/stopStream"),
                     settings.stopStreamShortcut);
  settings_.endGroup();
  settings_.sync();
}

void ApplicationController::probeServer(const QString &url) {
  QString error;
  const auto normalized = normalizeServerUrl(url, &error);
  if (!normalized) {
    window_->appendConnectionLog(error);
    window_->showServerTestResult(false, error);
    return;
  }

  auto *probe = new network::ApiClient(*normalized, this);
  probe->setRequestTimeoutMs(api_->requestTimeoutMs());
  const quint64 requestId = probe->getHealth();

  connect(probe, &network::ApiClient::requestSucceeded, this,
          [this, probe, requestId, normalized](quint64 id,
                                               const QJsonValue &payload) {
            if (id != requestId) {
              return;
            }
            const auto parsed = protocol::parseHealthResponse(payload);
            const QString version =
                parsed ? parsed.value->version : QStringLiteral("unknown");
            const QString message =
                tr("Server health check passed (%1).").arg(version);
            window_->appendConnectionLog(
                tr("Tested %1 without changing the active session.")
                    .arg(normalized->toString()));
            window_->appendConnectionLog(message);
            window_->showServerTestResult(true, message);
            probe->deleteLater();
          });
  connect(
      probe, &network::ApiClient::requestFailed, this,
      [this, probe, requestId](quint64 id, const network::ApiError &failure) {
        if (id != requestId) {
          return;
        }
        const QString message =
            tr("Request failed (%1): %2").arg(failure.code, failure.message);
        window_->appendConnectionLog(message);
        window_->showServerTestResult(false, message);
        probe->deleteLater();
      });
}

void ApplicationController::configureServer(const ui::ServerBookmark &bookmark,
                                            bool connectAfterProbe) {
  QString error;
  const auto normalized = normalizeServerUrl(bookmark.url, &error);
  if (!normalized) {
    window_->setConnectionState(ui::ConnectionState::Error, error);
    window_->appendConnectionLog(error);
    return;
  }

  media_->shutdown();
  gateway_->disconnectFromServer();
  auth_->clearLocalSession(false);
  api_->abortAll();
  pendingRequests_.clear();
  guilds_.clear();
  channelsByGuild_.clear();
  messagesByChannel_.clear();
  rostersByChannel_.clear();
  serverUrl_ = *normalized;
  serverName_ = bookmark.name.isEmpty() ? serverUrl_.host() : bookmark.name;
  pendingBookmark_ = bookmark;
  connectAfterProbe_ = connectAfterProbe;

  QString apiError;
  QString gatewayError;
  if (!api_->setBaseUrl(serverUrl_, &apiError) ||
      !gateway_->setUrl(gatewayUrl(serverUrl_), &gatewayError)) {
    window_->setConnectionState(ui::ConnectionState::Error,
                                apiError.isEmpty() ? gatewayError : apiError);
    return;
  }
  window_->setCurrentServer(serverName_, serverUrl_.toString());
  window_->setSuggestedLogin({
      serverUrl_.toString(),
      bookmark.accountEmail,
      bookmark.password,
      true,
  });
  window_->setConnectionState(ui::ConnectionState::Connecting,
                              tr("Testing server"));
  window_->appendConnectionLog(
      tr("Connecting to %1").arg(serverUrl_.toString()));
  const quint64 health = api_->getHealth();
  const quint64 config = api_->getPublicServerConfig();
  pendingRequests_.insert(health, {RequestAction::Health, {}});
  pendingRequests_.insert(config, {RequestAction::PublicConfig, {}});
}

void ApplicationController::beginAuthenticatedSession(
    const protocol::AuthUser &user) {
  currentUserId_ = user.id;
  media_->setLocalUserId(user.id);
  window_->setIdentity(user.id, user.username);
  window_->setConnectionState(ui::ConnectionState::Connecting,
                              tr("Opening gateway"));
  if (clientSettings_.startMuted) {
    media_->setMicrophoneMuted(true);
  }
  gateway_->connectToServer();
  loadCommunity();
}

void ApplicationController::loadCommunity() {
  pendingChannelRequests_ = 0;
  const quint64 id = api_->listGuilds();
  pendingRequests_.insert(id, {RequestAction::Guilds, {}});
}

void ApplicationController::rebuildTree() {
  QList<ui::ServerTreeItem> tree;
  tree.append({QString::fromLatin1(kServerNodeId),
               {},
               serverName_,
               serverUrl_.toString(),
               ui::TreeItemKind::Server,
               true});
  for (const auto &guild : guilds_) {
    tree.append({guild.id,
                 QString::fromLatin1(kServerNodeId),
                 guild.name,
                 {},
                 ui::TreeItemKind::Guild,
                 true});
    auto channels = channelsByGuild_.value(guild.id);
    std::sort(channels.begin(), channels.end(),
              [](const protocol::ChannelSummary &left,
                 const protocol::ChannelSummary &right) {
                return left.position < right.position;
              });
    for (const auto &channel : channels) {
      tree.append({channel.id, guild.id, channel.name,
                   channel.topic.value_or(QString()), channelKind(channel),
                   true});
      if (channel.type != QStringLiteral("voice")) {
        continue;
      }
      for (const auto &value : rostersByChannel_.value(channel.id)) {
        const QJsonObject participant = value.toObject();
        const QString userId =
            participant.value(QStringLiteral("userId")).toString();
        tree.append(
            {voiceUserNodeId(channel.id, userId), channel.id, userName(userId),
             presenceByUser_.value(userId)
                 .value(QStringLiteral("status"))
                 .toString(),
             ui::TreeItemKind::User, true,
             participant.value(QStringLiteral("isMuted")).toBool(),
             speakingByUser_.value(userId), musicByUser_.contains(userId),
             streamByUser_.contains(userId),
             networkQualityByUser_.value(userId, -1)});
      }
    }
  }
  window_->setServerTree(tree);
}

void ApplicationController::refreshAudioDevices() {
  QList<ui::AudioDeviceOption> input;
  QList<ui::AudioDeviceOption> output;
  for (const auto &device : media::MediaCatalog::inputDevices()) {
    input.append({device.id, device.name, device.isDefault});
  }
  for (const auto &device : media::MediaCatalog::outputDevices()) {
    output.append({device.id, device.name, device.isDefault});
  }
  window_->setAudioDevices(input, output, deviceSelection_);
}

void ApplicationController::refreshCaptureSources() {
  QList<ui::CaptureSourceOption> sources;
  for (const auto &source : media::MediaCatalog::captureSources()) {
    ui::CaptureSourceKind kind = ui::CaptureSourceKind::Screen;
    if (source.kind == media::CaptureKind::Window) {
      kind = ui::CaptureSourceKind::Window;
    } else if (source.kind == media::CaptureKind::Camera) {
      kind = ui::CaptureSourceKind::Camera;
    }
    sources.append(
        {source.id, source.name, kind, QPixmap::fromImage(source.thumbnail)});
  }
  window_->setCaptureSources(sources);
}

void ApplicationController::refreshMusicSources() {
  const QList<audio::WindowAudioSource> windowSources =
      audio::ProcessLoopbackCapture::enumerateWindowSources();
  QSet<quint32> seenProcessIds;
  QList<quint32> processIds;
  processIds.reserve(windowSources.size());
  for (const auto &source : windowSources) {
    if (seenProcessIds.contains(source.processId)) {
      continue;
    }
    seenProcessIds.insert(source.processId);
    processIds.append(source.processId);
  }
  const QHash<quint32, float> peaks =
      audio::ProcessLoopbackCapture::measureActivePeaks(processIds);

  QList<ui::MusicSourceOption> sources;
  seenProcessIds.clear();
  for (const auto &source : windowSources) {
    if (seenProcessIds.contains(source.processId)) {
      continue;
    }
    seenProcessIds.insert(source.processId);
    ui::MusicSourceOption item;
    item.id = QString::number(source.processId);
    item.name = source.title;
    item.details = tr("Process %1").arg(source.processId);
    item.processId = source.processId;
    item.peakLevelPercent = qRound(
        std::clamp(peaks.value(source.processId, 0.0F), 0.0F, 1.0F) * 100.0F);
    sources.append(item);
  }
  window_->setMusicSources(sources);
}

void ApplicationController::subscribeToChannel(const QString &channelId) {
  if (gateway_->state() != network::GatewayClient::State::Ready ||
      subscribedChannelId_ == channelId) {
    return;
  }
  subscribedChannelId_ = channelId;
  const QString requestId = gateway_->sendCommand(
      QStringLiteral("channel.subscribe"),
      QJsonObject{{QStringLiteral("channelId"), channelId}});
  Q_UNUSED(requestId)
}

void ApplicationController::handleApiSuccess(quint64 id,
                                             const QJsonValue &payload) {
  const auto iterator = pendingRequests_.find(id);
  if (iterator == pendingRequests_.end()) {
    return;
  }
  const PendingRequest pending = iterator.value();
  pendingRequests_.erase(iterator);

  switch (pending.action) {
  case RequestAction::Health: {
    const auto parsed = protocol::parseHealthResponse(payload);
    if (parsed) {
      serverVersion_ = parsed.value->version;
      window_->setCurrentServer(serverName_, serverUrl_.toString(),
                                serverVersion_);
      window_->appendConnectionLog(
          tr("Server health check passed (%1).").arg(serverVersion_));
    }
    if (connectAfterProbe_) {
      QString error;
      if (!auth_->restoreRememberedSession(&error)) {
        if (pendingBookmark_.autoLogin &&
            !pendingBookmark_.accountEmail.isEmpty() &&
            !pendingBookmark_.password.isEmpty()) {
          window_->setConnectionState(ui::ConnectionState::Connecting,
                                      tr("Signing in"));
          auth_->login(pendingBookmark_.accountEmail, pendingBookmark_.password,
                       true);
        } else {
          window_->setConnectionState(ui::ConnectionState::Connected,
                                      tr("Login required"));
          window_->showLoginDialog();
        }
      }
    } else {
      window_->setConnectionState(ui::ConnectionState::Connected,
                                  tr("Server is reachable"));
    }
    break;
  }
  case RequestAction::PublicConfig: {
    const auto parsed = protocol::parsePublicServerConfig(payload);
    if (parsed && !parsed.value->serverName.isEmpty()) {
      serverName_ = parsed.value->serverName;
      window_->setCurrentServer(serverName_, serverUrl_.toString(),
                                serverVersion_);
    }
    break;
  }
  case RequestAction::Guilds: {
    const auto parsed = protocol::parseGuildList(payload);
    if (!parsed) {
      break;
    }
    guilds_ = *parsed.value;
    channelsByGuild_.clear();
    pendingChannelRequests_ = guilds_.size();
    if (guilds_.isEmpty()) {
      rebuildTree();
    }
    for (const auto &guild : guilds_) {
      const quint64 request = api_->listChannels(guild.id);
      pendingRequests_.insert(request, {RequestAction::Channels, guild.id});
    }
    break;
  }
  case RequestAction::Channels: {
    const auto parsed = protocol::parseChannelList(payload);
    if (parsed) {
      channelsByGuild_.insert(pending.context, *parsed.value);
    }
    if (--pendingChannelRequests_ <= 0) {
      rebuildTree();
      for (const auto &guild : guilds_) {
        for (const auto &channel : channelsByGuild_.value(guild.id)) {
          if (channel.type == QStringLiteral("text")) {
            currentChatChannelId_ = channel.id;
            window_->setChatContext(channel.id, channel.name);
            subscribeToChannel(channel.id);
            const quint64 request = api_->listMessages(channel.id);
            pendingRequests_.insert(request,
                                    {RequestAction::Messages, channel.id});
            return;
          }
        }
      }
    }
    break;
  }
  case RequestAction::Messages:
  case RequestAction::OlderMessages: {
    const auto parsed = protocol::parseMessagePage(payload);
    if (!parsed) {
      break;
    }
    QList<ui::ChatMessage> converted;
    converted.reserve(parsed.value->items.size());
    for (const auto &message : parsed.value->items) {
      converted.append(toUiMessage(message, currentUserId_));
    }
    auto &stored = messagesByChannel_[pending.context];
    if (pending.action == RequestAction::OlderMessages) {
      stored = converted + stored;
    } else {
      stored = converted;
    }
    nextCursorByChannel_.insert(pending.context,
                                parsed.value->nextCursor.value_or(QString()));
    if (currentChatChannelId_ == pending.context) {
      window_->setChatMessages(stored);
      window_->setChatHistoryLoading(false);
    }
    break;
  }
  case RequestAction::SendMessage: {
    const auto parsed = protocol::parseMessage(payload);
    if (parsed) {
      const auto message = toUiMessage(*parsed.value, currentUserId_);
      auto &stored = messagesByChannel_[pending.context];
      const bool exists =
          std::any_of(stored.cbegin(), stored.cend(),
                      [&message](const ui::ChatMessage &current) {
                        return current.id == message.id;
                      });
      if (!exists) {
        stored.append(message);
        if (currentChatChannelId_ == pending.context) {
          window_->appendChatMessage(message);
        }
      }
    }
    break;
  }
  case RequestAction::UpdateProfile: {
    const auto parsed = protocol::parseAuthUser(payload);
    if (parsed) {
      window_->setIdentity(parsed.value->id, parsed.value->username);
    }
    break;
  }
  }
}

void ApplicationController::handleApiFailure(quint64 id,
                                             const network::ApiError &error) {
  const auto iterator = pendingRequests_.find(id);
  if (iterator == pendingRequests_.end()) {
    return;
  }
  const PendingRequest pending = iterator.value();
  pendingRequests_.erase(iterator);
  window_->appendConnectionLog(
      tr("Request failed (%1): %2").arg(error.code, error.message));
  if (pending.action == RequestAction::Health) {
    window_->setConnectionState(ui::ConnectionState::Error, error.message);
  } else if (pending.action == RequestAction::Messages ||
             pending.action == RequestAction::OlderMessages) {
    window_->setChatHistoryLoading(false);
  } else if (pending.action == RequestAction::Channels &&
             --pendingChannelRequests_ <= 0) {
    rebuildTree();
  }
}

void ApplicationController::handleGatewayEvent(const QString &event,
                                               const QJsonValue &value) {
  const QJsonObject object = value.toObject();
  media_->handleGatewayEvent(event, object);
  if (event == QStringLiteral("chat.message.created")) {
    const auto parsed = protocol::parseMessage(value);
    if (parsed) {
      const auto message = toUiMessage(*parsed.value, currentUserId_);
      auto &stored = messagesByChannel_[parsed.value->channelId];
      const bool exists =
          std::any_of(stored.cbegin(), stored.cend(),
                      [&message](const ui::ChatMessage &current) {
                        return current.id == message.id;
                      });
      if (!exists) {
        stored.append(message);
        if (currentChatChannelId_ == parsed.value->channelId) {
          window_->appendChatMessage(message);
        }
      }
    }
  } else if (event == QStringLiteral("voice.roster.updated")) {
    handleRosterEvent(object);
  } else if (event == QStringLiteral("presence.updated")) {
    handlePresenceEvent(object);
  } else if (event == QStringLiteral("voice.speaking.updated")) {
    speakingByUser_.insert(object.value(QStringLiteral("userId")).toString(),
                           object.value(QStringLiteral("isSpeaking")).toBool());
    rebuildTree();
  } else if (event == QStringLiteral("voice.network.updated")) {
    for (const QJsonValue &participantValue :
         object.value(QStringLiteral("participants")).toArray()) {
      const QJsonObject participant = participantValue.toObject();
      const QString userId =
          participant.value(QStringLiteral("userId")).toString();
      double loss =
          participant.value(QStringLiteral("mediaSelfLossPct")).toDouble();
      if (participant.value(QStringLiteral("mediaSelfLossPct")).isNull()) {
        loss = participant.value(QStringLiteral("gatewayLossPct")).toDouble();
      }
      networkQualityByUser_.insert(
          userId, participant.value(QStringLiteral("stale")).toBool()
                      ? 0
                      : (loss < 2 ? 3 : (loss < 8 ? 2 : 1)));
    }
    rebuildTree();
  } else if (event == QStringLiteral("stream.state.updated")) {
    handleStreamState(object);
  } else if (event == QStringLiteral("music.state.updated")) {
    handleMusicState(object);
  } else if (event == QStringLiteral("system.notification")) {
    window_->appendServerLog(QStringLiteral("[%1] %2").arg(
        object.value(QStringLiteral("level")).toString(),
        object.value(QStringLiteral("message")).toString()));
  } else if (event == QStringLiteral("system.resync_required")) {
    loadCommunity();
    media_->recoverActiveSessions();
  }
}

void ApplicationController::handleRosterEvent(const QJsonObject &object) {
  const QString channelId =
      object.value(QStringLiteral("channelId")).toString();
  rostersByChannel_.insert(
      channelId, object.value(QStringLiteral("participants")).toArray());
  rebuildTree();
}

void ApplicationController::removeLocalUserFromRosters() {
  if (currentUserId_.isEmpty()) {
    return;
  }
  bool changed = false;
  for (auto iterator = rostersByChannel_.begin();
       iterator != rostersByChannel_.end(); ++iterator) {
    QJsonArray retained;
    for (const QJsonValue &value : iterator.value()) {
      if (value.toObject().value(QStringLiteral("userId")).toString() ==
          currentUserId_) {
        changed = true;
        continue;
      }
      retained.append(value);
    }
    iterator.value() = retained;
  }
  speakingByUser_.remove(currentUserId_);
  networkQualityByUser_.remove(currentUserId_);
  if (changed) {
    rebuildTree();
  }
}

void ApplicationController::handlePresenceEvent(const QJsonObject &object) {
  const QString userId = object.value(QStringLiteral("userId")).toString();
  presenceByUser_.insert(userId, object);
  rebuildTree();
}

void ApplicationController::handleStreamState(const QJsonObject &object) {
  streamByUser_.clear();
  streamChannel_.clear();
  QList<ui::LiveStreamOption> liveStreams;
  for (const auto &value : object.value(QStringLiteral("streams")).toArray()) {
    const QJsonObject stream = value.toObject();
    const QString id = stream.value(QStringLiteral("streamId")).toString();
    const QString user = stream.value(QStringLiteral("hostUserId")).toString();
    const QString channel =
        stream.value(QStringLiteral("channelId"))
            .toString(object.value(QStringLiteral("channelId")).toString());
    if (!id.isEmpty()) {
      streamByUser_.insert(user, id);
      streamChannel_.insert(id, channel);
      liveStreams.append({
          id,
          user,
          userName(user),
          channelName(channel),
      });
    }
  }
  rebuildTree();
  window_->setAvailableStreams(liveStreams);
  window_->setLiveStatus(
      streamByUser_.isEmpty()
          ? tr("No active streams")
          : tr("%1 active stream(s)").arg(streamByUser_.size()));
}

void ApplicationController::handleMusicState(const QJsonObject &object) {
  musicByUser_.clear();
  for (const auto &value :
       object.value(QStringLiteral("publications")).toArray()) {
    const QJsonObject publication = value.toObject();
    musicByUser_.insert(
        publication.value(QStringLiteral("hostUserId")).toString(),
        publication.value(QStringLiteral("musicId")).toString());
  }
  rebuildTree();
  window_->setMusicSharing(musicByUser_.contains(currentUserId_));
}

QString ApplicationController::channelName(const QString &channelId) const {
  for (const auto &channels : channelsByGuild_) {
    for (const auto &channel : channels) {
      if (channel.id == channelId) {
        return channel.name;
      }
    }
  }
  return channelId;
}

QString ApplicationController::userName(const QString &userId) const {
  const QString username = presenceByUser_.value(userId)
                               .value(QStringLiteral("username"))
                               .toString();
  if (!username.isEmpty()) {
    return username;
  }
  return userId == currentUserId_ ? tr("You") : userId.left(8);
}

QString ApplicationController::streamForUser(const QString &userId) const {
  return streamByUser_.value(userId);
}

QString
ApplicationController::voiceChannelForStream(const QString &streamId) const {
  return streamChannel_.value(streamId, media_->voiceChannelId());
}

} // namespace baker::lite::app
