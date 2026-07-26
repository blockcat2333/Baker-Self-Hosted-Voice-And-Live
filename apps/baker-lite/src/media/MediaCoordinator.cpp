#include "MediaCoordinator.hpp"

#include "RtcBackend.hpp"

#include <QDateTime>
#include <QJsonArray>
#include <QJsonValue>
#include <QUuid>

#include <algorithm>

namespace baker::media {
namespace {

QString requestId() {
  return QStringLiteral("native-%1")
      .arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
}

QString requireString(const QJsonObject& object, const char* name) {
  return object.value(QLatin1String(name)).toString();
}

QString localSourceTypeName(const StreamSourceType sourceType) {
  if (sourceType == StreamSourceType::Camera) {
    return QStringLiteral("camera");
  }
  if (sourceType == StreamSourceType::Window) {
    return QStringLiteral("window");
  }
  return QStringLiteral("screen");
}

}  // namespace

MediaCoordinator::MediaCoordinator(QObject* parent)
    : QObject(parent), backend_(createRtcBackend(this)) {
  connect(backend_, &RtcBackend::gatewayCommandRequested, this,
          [this](const QString& id, const QString& command,
                 const QJsonObject& data) {
            pending_.insert(id, PendingCommand{Operation::Backend, {}});
            emit gatewayCommandRequested(id, command, data);
          });
  connect(backend_, &RtcBackend::localSpeakingChanged, this,
          [this](bool speaking) {
            if (voiceChannelId_.isEmpty() || microphoneMuted_) {
              speaking = false;
            }
            QJsonObject data{{QStringLiteral("channelId"), voiceChannelId_},
                             {QStringLiteral("isMuted"), microphoneMuted_},
                             {QStringLiteral("isSpeaking"), speaking}};
            send(Operation::VoiceSpeaking,
                 QStringLiteral("voice.speaking.updated"), data);
            emit localSpeakingChanged(speaking);
          });
  connect(backend_, &RtcBackend::errorOccurred, this,
          &MediaCoordinator::mediaError);
  connect(
      backend_, &RtcBackend::sessionStateChanged, this,
      [this](const QString& sessionId, const RuntimeState state) {
        if (state != RuntimeState::Failed) {
          return;
        }
        if (sessionId == ownedStreamSessionId_) {
          ownedStreamId_.clear();
          ownedStreamSessionId_.clear();
          emit streamStateChanged();
        } else if (sessionId == voiceSessionId_) {
          clearVoiceState(RuntimeState::Failed);
        }
      });
  connect(
      backend_, &RtcBackend::remoteVideoFrameAvailable, this,
      [this](const QString& sessionId, const QImage& image) {
        const QString streamId = streamIdForSession(sessionId);
        emit remoteVideoFrameAvailable(
            streamId.isEmpty() ? sessionId : streamId, image);
      });
  connect(
      backend_, &RtcBackend::statisticsUpdated, this,
      [this](const QString& sessionId,
             const MediaStatistics& statistics) {
        const QString streamId = streamIdForSession(sessionId);
        emit statisticsUpdated(
            streamId.isEmpty() ? sessionId : streamId, statistics);
      });
}

MediaCoordinator::~MediaCoordinator() { shutdown(); }

RtcBackend* MediaCoordinator::backend() const noexcept { return backend_; }
QString MediaCoordinator::voiceChannelId() const { return voiceChannelId_; }
RuntimeState MediaCoordinator::voiceState() const noexcept {
  return voiceState_;
}
bool MediaCoordinator::microphoneMuted() const noexcept {
  return microphoneMuted_;
}
bool MediaCoordinator::outputMuted() const noexcept { return outputMuted_; }
bool MediaCoordinator::hasOwnedStream() const noexcept {
  return !ownedStreamId_.isEmpty();
}

QString MediaCoordinator::streamIdForSession(
    const QString& sessionId) const {
  for (auto iterator = watchedSessionByStream_.cbegin();
       iterator != watchedSessionByStream_.cend(); ++iterator) {
    if (iterator.value() == sessionId) {
      return iterator.key();
    }
  }
  return {};
}

void MediaCoordinator::initialize() { backend_->initialize(); }

void MediaCoordinator::shutdown() {
  pending_.clear();
  backend_->stopAll();
  backend_->shutdown();
  const QStringList watchedStreams = watchedSessionByStream_.keys();
  watchedSessionByStream_.clear();
  listenedSessionByMusic_.clear();
  ownedMusicId_.clear();
  ownedMusicSessionId_.clear();
  ownedStreamId_.clear();
  ownedStreamSessionId_.clear();
  for (const QString& streamId : watchedStreams) {
    emit streamWatchEnded(streamId);
  }
  emit musicStateChanged();
  emit streamStateChanged();
  clearVoiceState();
}

void MediaCoordinator::setLocalUserId(const QString& userId) {
  localUserId_ = userId;
}

void MediaCoordinator::joinVoice(const QString& channelId) {
  if (channelId.isEmpty()) {
    return;
  }
  if (voiceChannelId_ == channelId &&
      voiceState_ != RuntimeState::Idle &&
      voiceState_ != RuntimeState::Failed) {
    return;
  }
  if (!voiceChannelId_.isEmpty()) {
    leaveVoice();
  }
  voiceChannelId_ = channelId;
  voiceState_ = RuntimeState::Preparing;
  emit voiceStateChanged(voiceState_, voiceChannelId_);
  send(Operation::VoiceJoin, QStringLiteral("voice.join"),
       {{QStringLiteral("channelId"), channelId}});
}

void MediaCoordinator::leaveVoice() {
  if (voiceChannelId_.isEmpty()) {
    return;
  }
  voiceState_ = RuntimeState::Closing;
  emit voiceStateChanged(voiceState_, voiceChannelId_);
  send(Operation::VoiceLeave, QStringLiteral("voice.leave"),
       {{QStringLiteral("channelId"), voiceChannelId_}});
}

void MediaCoordinator::setMicrophoneMuted(bool muted) {
  if (microphoneMuted_ == muted) {
    return;
  }
  microphoneMuted_ = muted;
  backend_->setMicrophoneMuted(muted);
  emit microphoneMutedChanged(muted);
  if (!voiceChannelId_.isEmpty()) {
    send(Operation::VoiceSpeaking,
         QStringLiteral("voice.speaking.updated"),
         {{QStringLiteral("channelId"), voiceChannelId_},
          {QStringLiteral("isMuted"), muted},
          {QStringLiteral("isSpeaking"), false}});
  }
}

void MediaCoordinator::setOutputMuted(bool muted) {
  if (outputMuted_ == muted) {
    return;
  }
  outputMuted_ = muted;
  backend_->setOutputMuted(muted);
  emit outputMutedChanged(muted);
}

void MediaCoordinator::setInputDevice(const QString& deviceId) {
  backend_->setInputDevice(deviceId);
}

void MediaCoordinator::setOutputDevice(const QString& deviceId) {
  backend_->setOutputDevice(deviceId);
}

void MediaCoordinator::setMicrophoneVolume(double volume) {
  backend_->setMicrophoneVolume(std::clamp(volume, 0.0, 2.0));
}

void MediaCoordinator::setMasterVolume(double volume) {
  backend_->setMasterVolume(std::clamp(volume, 0.0, 2.0));
}

void MediaCoordinator::setParticipantVolume(const QString& userId,
                                            double volume) {
  if (participants_.contains(userId)) {
    participants_[userId].volume = std::clamp(volume, 0.0, 2.0);
    emit voiceParticipantsChanged(participants_);
  }
  backend_->setParticipantVolume(userId, std::clamp(volume, 0.0, 2.0));
}

void MediaCoordinator::startMusicShare(const QString& channelId,
                                       quint32 processId, double volume) {
  if (channelId.isEmpty() || processId == 0 || !ownedMusicId_.isEmpty()) {
    return;
  }
  send(Operation::MusicStart, QStringLiteral("music.start"),
       {{QStringLiteral("channelId"), channelId}},
       {{QStringLiteral("processId"), static_cast<qint64>(processId)},
        {QStringLiteral("volume"), std::clamp(volume, 0.0, 2.0)}});
}

void MediaCoordinator::stopMusicShare() {
  if (ownedMusicId_.isEmpty()) {
    return;
  }
  send(Operation::MusicStop, QStringLiteral("music.stop"),
       {{QStringLiteral("channelId"), voiceChannelId_},
        {QStringLiteral("musicId"), ownedMusicId_}});
}

void MediaCoordinator::stopAllMusic() {
  stopMusicShare();
  const QStringList listenedMusicIds =
      listenedSessionByMusic_.keys();
  for (const QString& musicId : listenedMusicIds) {
    stopListeningToMusic(musicId);
  }
}

void MediaCoordinator::listenToMusic(const QString& channelId,
                                     const QString& musicId) {
  if (channelId.isEmpty() || musicId.isEmpty() ||
      listenedSessionByMusic_.contains(musicId)) {
    return;
  }
  send(Operation::MusicListen, QStringLiteral("music.listen"),
       {{QStringLiteral("channelId"), channelId},
        {QStringLiteral("musicId"), musicId}},
       {{QStringLiteral("musicId"), musicId}});
}

void MediaCoordinator::stopListeningToMusic(const QString& musicId) {
  if (!listenedSessionByMusic_.contains(musicId)) {
    return;
  }
  send(Operation::MusicUnlisten, QStringLiteral("music.unlisten"),
       {{QStringLiteral("channelId"), voiceChannelId_},
        {QStringLiteral("musicId"), musicId}},
       {{QStringLiteral("musicId"), musicId}});
}

void MediaCoordinator::setMusicVolume(const QString& musicId, double volume) {
  backend_->setSessionVolume(listenedSessionByMusic_.value(musicId),
                             std::clamp(volume, 0.0, 2.0));
}

void MediaCoordinator::setMusicPlaybackVolume(double volume) {
  musicPlaybackVolume_ = std::clamp(volume, 0.0, 2.0);
  for (const QString& sessionId : listenedSessionByMusic_) {
    backend_->setSessionVolume(sessionId, musicPlaybackVolume_);
  }
}

void MediaCoordinator::startStream(const QString& channelId,
                                   StreamSourceType sourceType,
                                   const QString& sourceId,
                                   const StreamQuality& quality,
                                   bool shareAudio,
                                   double sharedAudioVolume) {
  if (channelId.isEmpty() || sourceId.isEmpty() ||
      !ownedStreamId_.isEmpty()) {
    return;
  }
  const QJsonObject qualityJson{
      {QStringLiteral("resolution"), quality.resolution},
      {QStringLiteral("frameRate"), quality.frameRate},
      {QStringLiteral("bitrateKbps"), quality.bitrateKbps}};
  send(Operation::StreamStart, QStringLiteral("stream.start"),
       {{QStringLiteral("channelId"), channelId},
        {QStringLiteral("sourceType"),
         sourceType == StreamSourceType::Camera ? QStringLiteral("camera")
                                                : QStringLiteral("screen")},
        {QStringLiteral("quality"), qualityJson}},
       {{QStringLiteral("sourceId"), sourceId},
        {QStringLiteral("sourceType"), localSourceTypeName(sourceType)},
        {QStringLiteral("shareAudio"), shareAudio},
        {QStringLiteral("sharedAudioVolume"),
         std::clamp(sharedAudioVolume, 0.0, 2.0)},
        {QStringLiteral("codec"), static_cast<int>(quality.codec)},
        {QStringLiteral("resolution"), quality.resolution},
        {QStringLiteral("frameRate"), quality.frameRate},
        {QStringLiteral("bitrateKbps"), quality.bitrateKbps}});
}

void MediaCoordinator::stopOwnedStream() {
  if (ownedStreamId_.isEmpty()) {
    return;
  }
  send(Operation::StreamStop, QStringLiteral("stream.stop"),
       {{QStringLiteral("channelId"), voiceChannelId_},
        {QStringLiteral("streamId"), ownedStreamId_}});
}

void MediaCoordinator::watchStream(const QString& channelId,
                                   const QString& streamId) {
  if (channelId.isEmpty() || streamId.isEmpty() ||
      watchedSessionByStream_.contains(streamId)) {
    return;
  }
  send(Operation::StreamWatch, QStringLiteral("stream.watch"),
       {{QStringLiteral("channelId"), channelId},
        {QStringLiteral("streamId"), streamId}},
       {{QStringLiteral("streamId"), streamId}});
}

void MediaCoordinator::unwatchStream(const QString& streamId) {
  if (!watchedSessionByStream_.contains(streamId)) {
    return;
  }
  send(Operation::StreamUnwatch, QStringLiteral("stream.unwatch"),
       {{QStringLiteral("channelId"), voiceChannelId_},
        {QStringLiteral("streamId"), streamId}},
       {{QStringLiteral("streamId"), streamId}});
}

void MediaCoordinator::setStreamVolume(const QString& streamId,
                                       double volume) {
  backend_->setSessionVolume(watchedSessionByStream_.value(streamId),
                             std::clamp(volume, 0.0, 2.0));
}

void MediaCoordinator::handleGatewayAck(const QString& requestId,
                                        const QJsonObject& data) {
  const auto pending = pending_.take(requestId);
  if (pending.operation == Operation::Backend) {
    backend_->handleGatewayAck(requestId, data);
    return;
  }
  switch (pending.operation) {
    case Operation::VoiceJoin:
    case Operation::MusicStart:
    case Operation::MusicListen:
    case Operation::StreamStart:
    case Operation::StreamWatch:
      startConfiguredSession(pending.operation, data, pending.context);
      break;
    case Operation::VoiceLeave:
      backend_->stopSession(voiceSessionId_);
      clearVoiceState();
      break;
    case Operation::MusicStop:
      backend_->stopSession(ownedMusicSessionId_);
      ownedMusicId_.clear();
      ownedMusicSessionId_.clear();
      emit musicStateChanged();
      break;
    case Operation::MusicUnlisten: {
      const QString musicId =
          pending.context.value(QStringLiteral("musicId")).toString();
      backend_->stopSession(listenedSessionByMusic_.take(musicId));
      emit musicStateChanged();
      break;
    }
    case Operation::StreamStop:
      backend_->stopSession(ownedStreamSessionId_);
      ownedStreamId_.clear();
      ownedStreamSessionId_.clear();
      emit streamStateChanged();
      break;
    case Operation::StreamUnwatch: {
      const QString streamId =
          pending.context.value(QStringLiteral("streamId")).toString();
      backend_->stopSession(watchedSessionByStream_.take(streamId));
      emit streamWatchEnded(streamId);
      emit streamStateChanged();
      break;
    }
    case Operation::VoiceSpeaking:
    case Operation::Backend:
      break;
  }
}

void MediaCoordinator::handleGatewayError(const QString& requestId,
                                          const QString& code,
                                          const QString& message) {
  const auto pending = pending_.take(requestId);
  if (pending.operation == Operation::Backend) {
    backend_->handleGatewayError(requestId, code, message);
    return;
  }
  if (pending.operation == Operation::VoiceJoin) {
    clearVoiceState(RuntimeState::Failed);
  } else if (pending.operation == Operation::StreamStart) {
    emit streamStartFailed(
        QStringLiteral("%1: %2").arg(code, message));
  }
  emit mediaError(code, message);
}

void MediaCoordinator::handleGatewayEvent(const QString& event,
                                          const QJsonObject& data) {
  backend_->handleGatewayEvent(event, data);
  if (event == QStringLiteral("media.signal")) {
    backend_->handleSignal(
        data.value(QStringLiteral("fromUserId")).toString(),
        data.value(QStringLiteral("signal")).toObject());
  } else if (event == QStringLiteral("media.sfu.producer.added")) {
    backend_->handleSfuProducerAdded(
        data.value(QStringLiteral("producer")).toObject());
  } else if (event == QStringLiteral("media.sfu.producer.removed")) {
    backend_->handleSfuProducerRemoved(
        data.value(QStringLiteral("producer")).toObject());
  } else if (event == QStringLiteral("voice.state.updated")) {
    if (data.value(QStringLiteral("channelId")).toString() ==
        voiceChannelId_) {
      replaceVoiceParticipants(
          data.value(QStringLiteral("participants")).toArray());
    }
  } else if (event == QStringLiteral("voice.member.updated")) {
    if (data.value(QStringLiteral("channelId")).toString() ==
        voiceChannelId_) {
      patchVoiceParticipant(
          data.value(QStringLiteral("participant")).toObject());
    }
  } else if (event == QStringLiteral("voice.speaking.updated")) {
    const QString userId =
        data.value(QStringLiteral("userId")).toString();
    if (participants_.contains(userId)) {
      participants_[userId].speaking =
          data.value(QStringLiteral("isSpeaking")).toBool();
      emit voiceParticipantsChanged(participants_);
    }
  } else if (event == QStringLiteral("voice.network.updated")) {
    for (const QJsonValue& item :
         data.value(QStringLiteral("participants")).toArray()) {
      const QJsonObject network = item.toObject();
      const QString userId = network.value(QStringLiteral("userId")).toString();
      if (!participants_.contains(userId)) {
        continue;
      }
      auto& participant = participants_[userId];
      participant.gatewayRttMs =
          network.value(QStringLiteral("gatewayRttMs")).toDouble();
      participant.packetLossPercent =
          network.value(QStringLiteral("mediaSelfLossPct")).toDouble();
      participant.stale = network.value(QStringLiteral("stale")).toBool();
    }
    emit voiceParticipantsChanged(participants_);
  } else if (event == QStringLiteral("music.state.updated")) {
    emit musicStateChanged();
  } else if (event == QStringLiteral("stream.state.updated") ||
             event == QStringLiteral("stream.session.updated") ||
             event == QStringLiteral("stream.viewer.joined") ||
             event == QStringLiteral("stream.viewer.left")) {
    emit streamStateChanged();
  } else if (event == QStringLiteral("system.notification")) {
    emit notificationRequested(
        data.value(QStringLiteral("level")).toString(),
        data.value(QStringLiteral("message")).toString());
  } else if (event == QStringLiteral("media.mode.updated")) {
    recoverActiveSessions();
  }
}

void MediaCoordinator::recoverActiveSessions() {
  if (!voiceChannelId_.isEmpty()) {
    const QString channel = voiceChannelId_;
    backend_->stopSession(voiceSessionId_);
    voiceSessionId_.clear();
    voiceState_ = RuntimeState::Recovering;
    emit voiceStateChanged(voiceState_, channel);
    send(Operation::VoiceJoin, QStringLiteral("voice.join"),
         {{QStringLiteral("channelId"), channel}});
  }
}

QString MediaCoordinator::send(Operation operation, const QString& command,
                               const QJsonObject& data,
                               const QJsonObject& context) {
  const QString id = requestId();
  pending_.insert(id, PendingCommand{operation, context});
  emit gatewayCommandRequested(id, command, data);
  return id;
}

void MediaCoordinator::startConfiguredSession(Operation operation,
                                              const QJsonObject& ack,
                                              const QJsonObject& context) {
  // Creating the WebRTC factory also creates native audio worker threads.
  // Keep the client genuinely idle until a voice/music/stream session starts.
  backend_->initialize();

  if (operation == Operation::VoiceJoin) {
    const SessionConfiguration configuration =
        sessionConfiguration(SessionMode::Voice, ack, context);
    voiceChannelId_ = configuration.descriptor.channelId;
    voiceSessionId_ = configuration.descriptor.sessionId;
    replaceVoiceParticipants(configuration.participants);
    backend_->startVoice(configuration);
    voiceState_ = RuntimeState::Active;
    emit voiceStateChanged(voiceState_, voiceChannelId_);
    backend_->setMicrophoneMuted(microphoneMuted_);
    backend_->setOutputMuted(outputMuted_);
    return;
  }

  if (operation == Operation::MusicStart) {
    const SessionConfiguration configuration =
        sessionConfiguration(SessionMode::MusicPublish, ack, context);
    ownedMusicId_ = requireString(ack, "musicId");
    ownedMusicSessionId_ = configuration.descriptor.sessionId;
    backend_->startMusicPublish(
        configuration,
        static_cast<quint32>(
            context.value(QStringLiteral("processId")).toInteger()),
        context.value(QStringLiteral("volume")).toDouble(1.0));
    emit musicStateChanged();
    return;
  }

  if (operation == Operation::MusicListen) {
    const SessionConfiguration configuration =
        sessionConfiguration(SessionMode::MusicListen, ack, context);
    const QString musicId = requireString(ack, "musicId");
    listenedSessionByMusic_.insert(musicId,
                                   configuration.descriptor.sessionId);
    backend_->startMusicListen(configuration);
    backend_->setSessionVolume(
        configuration.descriptor.sessionId, musicPlaybackVolume_);
    emit musicStateChanged();
    return;
  }

  if (operation == Operation::StreamStart) {
    const SessionConfiguration configuration =
        sessionConfiguration(SessionMode::StreamPublish, ack, context);
    ownedStreamId_ = requireString(ack, "streamId");
    ownedStreamSessionId_ = configuration.descriptor.sessionId;
    StreamQuality quality;
    quality.resolution =
        context.value(QStringLiteral("resolution")).toString();
    quality.frameRate =
        context.value(QStringLiteral("frameRate")).toInt(30);
    quality.bitrateKbps =
        context.value(QStringLiteral("bitrateKbps")).toInt(4000);
    quality.codec = static_cast<VideoCodec>(
        context.value(QStringLiteral("codec")).toInt());
    const QString sourceTypeName =
        context.value(QStringLiteral("sourceType")).toString();
    StreamSourceType sourceType = StreamSourceType::Screen;
    if (sourceTypeName == QStringLiteral("camera")) {
      sourceType = StreamSourceType::Camera;
    } else if (sourceTypeName == QStringLiteral("window")) {
      sourceType = StreamSourceType::Window;
    }
    backend_->startStreamPublish(
        configuration,
        sourceType,
        context.value(QStringLiteral("sourceId")).toString(), quality,
        context.value(QStringLiteral("shareAudio")).toBool(),
        context.value(QStringLiteral("sharedAudioVolume")).toDouble(1.0));
    emit streamStateChanged();
    return;
  }

  if (operation == Operation::StreamWatch) {
    const SessionConfiguration configuration =
        sessionConfiguration(SessionMode::StreamWatch, ack, context);
    const QString streamId =
        !requireString(ack, "streamId").isEmpty()
            ? requireString(ack, "streamId")
            : context.value(QStringLiteral("streamId")).toString();
    watchedSessionByStream_.insert(streamId,
                                   configuration.descriptor.sessionId);
    backend_->startStreamWatch(configuration);
    emit streamStateChanged();
  }
}

void MediaCoordinator::replaceVoiceParticipants(
    const QJsonArray& participants) {
  QHash<QString, VoiceParticipant> next;
  for (const QJsonValue& value : participants) {
    const QJsonObject object = value.toObject();
    VoiceParticipant participant;
    participant.userId = requireString(object, "userId");
    participant.sessionId = requireString(object, "sessionId");
    participant.muted = object.value(QStringLiteral("isMuted")).toBool();
    participant.volume = participants_.value(participant.userId).volume;
    if (participant.volume <= 0.0) {
      participant.volume = 1.0;
    }
    if (!participant.userId.isEmpty()) {
      next.insert(participant.userId, participant);
    }
  }
  participants_ = std::move(next);
  emit voiceParticipantsChanged(participants_);
}

void MediaCoordinator::patchVoiceParticipant(
    const QJsonObject& participantJson) {
  const QString userId = requireString(participantJson, "userId");
  if (userId.isEmpty()) {
    return;
  }
  auto& participant = participants_[userId];
  participant.userId = userId;
  participant.sessionId = requireString(participantJson, "sessionId");
  participant.muted =
      participantJson.value(QStringLiteral("isMuted")).toBool();
  if (participant.volume <= 0.0) {
    participant.volume = 1.0;
  }
  emit voiceParticipantsChanged(participants_);
}

void MediaCoordinator::clearVoiceState(RuntimeState nextState) {
  voiceChannelId_.clear();
  voiceSessionId_.clear();
  participants_.clear();
  voiceState_ = nextState;
  emit voiceParticipantsChanged(participants_);
  emit voiceStateChanged(voiceState_, {});
}

SessionConfiguration MediaCoordinator::sessionConfiguration(
    SessionMode mode, const QJsonObject& ack,
    const QJsonObject& context) const {
  SessionConfiguration configuration;
  configuration.descriptor.mode = mode;
  configuration.descriptor.channelId = requireString(ack, "channelId");
  configuration.descriptor.sessionId = requireString(ack, "sessionId");
  configuration.descriptor.streamId =
      mode == SessionMode::MusicPublish || mode == SessionMode::MusicListen
          ? requireString(ack, "musicId")
          : requireString(ack, "streamId");
  if (configuration.descriptor.streamId.isEmpty()) {
    configuration.descriptor.streamId =
        context.value(QStringLiteral("streamId")).toString();
  }
  configuration.descriptor.userId = requireString(ack, "hostUserId");
  if (mode == SessionMode::Voice || mode == SessionMode::MusicPublish ||
      mode == SessionMode::StreamPublish) {
    configuration.descriptor.userId = localUserId_;
  }
  configuration.descriptor.transportMode =
      parseTransportMode(ack.value(QStringLiteral("mediaMode")));
  configuration.iceServers =
      parseIceServers(ack.value(QStringLiteral("iceServers")).toArray());
  const QJsonObject sfu = ack.value(QStringLiteral("sfu")).toObject();
  configuration.routerRtpCapabilities =
      sfu.value(QStringLiteral("routerRtpCapabilities")).toObject();
  configuration.producers = sfu.value(QStringLiteral("producers")).toArray();
  configuration.participants =
      ack.value(QStringLiteral("participants")).toArray();
  return configuration;
}

}  // namespace baker::media
