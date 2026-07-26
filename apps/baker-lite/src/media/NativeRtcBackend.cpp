#include "RtcBackend.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include "CameraVideoSource.hpp"
#include "DesktopVideoSource.hpp"
#include "InjectedAudioSource.hpp"
#include "NativeSfuSession.hpp"
#include "QtVideoSink.hpp"
#include "../audio/ProcessLoopbackCapture.hpp"

#include "api/audio_codecs/builtin_audio_decoder_factory.h"
#include "api/audio_codecs/builtin_audio_encoder_factory.h"
#include "api/audio_options.h"
#include "api/create_peerconnection_factory.h"
#include "api/jsep.h"
#include "api/make_ref_counted.h"
#include "api/peer_connection_interface.h"
#include "api/rtc_error.h"
#include "api/task_queue/default_task_queue_factory.h"
#include "api/video_codecs/builtin_video_decoder_factory.h"
#include "api/video_codecs/builtin_video_encoder_factory.h"
#include "media/engine/webrtc_voice_engine.h"
#include "modules/audio_device/include/audio_device_factory.h"
#include "modules/audio_device/include/audio_device.h"
#include "rtc_base/ref_counted_object.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"
#include "rtc_base/win/scoped_com_initializer.h"

#include <mediasoupclient.hpp>

#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMetaObject>
#include <QMutex>
#include <QPointer>
#include <QSet>
#include <QTimer>
#include <QUuid>

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <future>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <utility>
#include <vector>

namespace baker::media {
namespace {

class NativeRtcBackend;

QString newRequestId() {
  return QStringLiteral("rtc-%1")
      .arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
}

QJsonObject descriptorJson(const SessionDescriptor& descriptor) {
  QJsonObject output{
      {QStringLiteral("channelId"), descriptor.channelId},
      {QStringLiteral("mode"), sessionModeName(descriptor.mode)},
      {QStringLiteral("sessionId"), descriptor.sessionId},
      {QStringLiteral("transportMode"),
       transportModeName(descriptor.transportMode)},
      {QStringLiteral("userId"), descriptor.userId}};
  if (!descriptor.streamId.isEmpty()) {
    output.insert(QStringLiteral("streamId"), descriptor.streamId);
  }
  return output;
}

QJsonObject sfuDescriptorJson(const SessionDescriptor& descriptor) {
  QJsonObject output{
      {QStringLiteral("channelId"), descriptor.channelId},
      {QStringLiteral("mode"), sessionModeName(descriptor.mode)},
      {QStringLiteral("sessionId"), descriptor.sessionId}};
  if (!descriptor.streamId.isEmpty()) {
    output.insert(QStringLiteral("streamId"), descriptor.streamId);
  }
  return output;
}

class CreateDescriptionObserver
    : public webrtc::CreateSessionDescriptionObserver {
 public:
  using Success =
      std::function<void(webrtc::SessionDescriptionInterface*)>;
  using Failure = std::function<void(QString)>;

  CreateDescriptionObserver(Success success, Failure failure)
      : success_(std::move(success)), failure_(std::move(failure)) {}

  void OnSuccess(webrtc::SessionDescriptionInterface* description) override {
    success_(description);
  }
  void OnFailure(webrtc::RTCError error) override {
    failure_(QString::fromStdString(error.message()));
  }

 private:
  Success success_;
  Failure failure_;
};

class SetDescriptionObserver
    : public webrtc::SetSessionDescriptionObserver {
 public:
  explicit SetDescriptionObserver(std::function<void()> success = {},
                                  std::function<void(QString)> failure = {})
      : success_(std::move(success)), failure_(std::move(failure)) {}

  void OnSuccess() override {
    if (success_) {
      success_();
    }
  }
  void OnFailure(webrtc::RTCError error) override {
    if (failure_) {
      failure_(QString::fromStdString(error.message()));
    }
  }

 private:
  std::function<void()> success_;
  std::function<void(QString)> failure_;
};

class RemoteDescriptionObserver
    : public webrtc::SetRemoteDescriptionObserverInterface {
 public:
  explicit RemoteDescriptionObserver(
      std::function<void()> success = {},
      std::function<void(QString)> failure = {})
      : success_(std::move(success)), failure_(std::move(failure)) {}

  void OnSetRemoteDescriptionComplete(webrtc::RTCError error) override {
    if (error.ok()) {
      if (success_) {
        success_();
      }
      return;
    }
    if (failure_) {
      failure_(QString::fromStdString(error.message()));
    }
  }

 private:
  std::function<void()> success_;
  std::function<void(QString)> failure_;
};

struct RemoteTrack {
  webrtc::scoped_refptr<webrtc::MediaStreamTrackInterface> track;
  std::unique_ptr<QtVideoSink> videoSink;
};

class Peer final : public webrtc::PeerConnectionObserver {
 public:
  Peer(NativeRtcBackend* owner, QString sessionId, QString remoteUserId);
  ~Peer() override;

  void createOffer(bool iceRestart = false);
  void acceptOffer(const QString& sdp);
  void acceptAnswer(const QString& sdp);
  void addIceCandidate(const QJsonObject& candidate);
  void close();
  void applyOutputState(bool muted, double masterVolume,
                        double participantVolume);

  void OnSignalingChange(
      webrtc::PeerConnectionInterface::SignalingState) override {}
  void OnDataChannel(
      webrtc::scoped_refptr<webrtc::DataChannelInterface>) override {}
  void OnIceGatheringChange(
      webrtc::PeerConnectionInterface::IceGatheringState) override {}
  void OnIceCandidate(const webrtc::IceCandidate* candidate) override;
  void OnConnectionChange(
      webrtc::PeerConnectionInterface::PeerConnectionState state) override;
  void OnTrack(
      webrtc::scoped_refptr<webrtc::RtpTransceiverInterface> transceiver)
      override;
  void OnRemoveTrack(
      webrtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver) override;

  NativeRtcBackend* owner = nullptr;
  QString sessionId;
  QString remoteUserId;
  webrtc::scoped_refptr<webrtc::PeerConnectionInterface> connection;
  std::vector<RemoteTrack> remoteTracks;
};

struct Session {
  SessionConfiguration configuration;
  RuntimeState state = RuntimeState::Preparing;
  QHash<QString, std::shared_ptr<Peer>> peers;
  webrtc::scoped_refptr<webrtc::AudioTrackInterface> localAudioTrack;
  webrtc::scoped_refptr<webrtc::VideoTrackInterface> localVideoTrack;
  webrtc::scoped_refptr<InjectedAudioSource> injectedAudioSource;
  webrtc::scoped_refptr<DesktopVideoSource> desktopSource;
  webrtc::scoped_refptr<CameraVideoSource> cameraSource;
  std::unique_ptr<audio::ProcessLoopbackCapture> loopbackCapture;
  std::unique_ptr<NativeSfuSession> sfu;
  double volume = 1.0;
};

class NativeRtcBackend final : public RtcBackend {
  Q_OBJECT

 public:
  explicit NativeRtcBackend(QObject* parent) : RtcBackend(parent) {
    speakingTimer_.setInterval(100);
    connect(&speakingTimer_, &QTimer::timeout, this,
            &NativeRtcBackend::sampleSpeaking);
  }
  ~NativeRtcBackend() override { shutdown(); }

  [[nodiscard]] bool isAvailable() const noexcept override {
    return factory_ != nullptr;
  }
  [[nodiscard]] QString unavailableReason() const override {
    return initializationError_;
  }

  void initialize() override;
  void shutdown() override;
  void startVoice(const SessionConfiguration& configuration) override;
  void startMusicPublish(const SessionConfiguration& configuration,
                         quint32 processId) override;
  void startMusicListen(const SessionConfiguration& configuration) override;
  void startStreamPublish(const SessionConfiguration& configuration,
                          StreamSourceType sourceType, const QString& sourceId,
                          const StreamQuality& quality,
                          bool shareAudio) override;
  void startStreamWatch(const SessionConfiguration& configuration) override;
  void stopSession(const QString& sessionId) override;
  void stopAll() override;
  void handleSignal(const QString& fromUserId,
                    const QJsonObject& signal) override;
  void handleGatewayEvent(const QString& event,
                          const QJsonObject& data) override;
  void handleSfuProducerAdded(const QJsonObject& producer) override;
  void handleSfuProducerRemoved(const QJsonObject& producer) override;
  void handleGatewayAck(const QString& requestId,
                        const QJsonObject& data) override;
  void handleGatewayError(const QString& requestId, const QString& code,
                          const QString& message) override;
  void setMicrophoneMuted(bool muted) override;
  void setOutputMuted(bool muted) override;
  void setInputDevice(const QString& deviceId) override;
  void setOutputDevice(const QString& deviceId) override;
  void setMicrophoneVolume(double volume) override;
  void setMasterVolume(double volume) override;
  void setParticipantVolume(const QString& userId, double volume) override;
  void setSessionVolume(const QString& sessionId, double volume) override;

  Peer* ensurePeer(Session& session, const QString& remoteUserId);
  Session* resolveSession(const QJsonObject& descriptor);
  void sendSignal(const QString& sessionId, const QString& targetUserId,
                  const QString& type, const QJsonObject& fields = {});
  void reportError(const QString& scope, const QString& message);
  void postVideoFrame(const QString& sessionId, QImage image);
  void postPeerState(const QString& sessionId, RuntimeState state);
  void createOffersForUsers(Session& session,
                            const QSet<QString>& remoteUsers);
  void startSfu(Session& session);
  void applyRemoteVolumes();
  QJsonObject sendSfuCommand(const QString& command,
                             const QJsonObject& data);

 private:
  webrtc::scoped_refptr<webrtc::AudioTrackInterface> createMicrophoneTrack(
      const QString& id);
  webrtc::scoped_refptr<webrtc::AudioTrackInterface> createInjectedAudioTrack(
      Session& session, const QString& id);
  bool attachLoopback(Session& session, quint32 processId,
                      audio::ProcessLoopbackCapture::Mode mode);
  webrtc::PeerConnectionInterface::RTCConfiguration rtcConfiguration(
      const QList<IceServer>& servers) const;
  int audioDeviceIndex(const QString& id, bool input) const;
  void sampleSpeaking();

  struct SfuReply {
    std::mutex mutex;
    std::condition_variable ready;
    QJsonObject data;
    QString error;
    bool completed = false;
  };

  std::unique_ptr<webrtc::Thread> networkThread_;
  std::unique_ptr<webrtc::Thread> workerThread_;
  std::unique_ptr<webrtc::Thread> signalingThread_;
  std::unique_ptr<webrtc::TaskQueueFactory> taskQueueFactory_;
  std::unique_ptr<webrtc::ScopedCOMInitializer> comInitializer_;
  webrtc::scoped_refptr<webrtc::AudioDeviceModule> audioDevice_;
  webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory_;
  QHash<QString, std::shared_ptr<Session>> sessions_;
  QHash<QString, double> participantVolumes_;
  QString initializationError_;
  QString inputDeviceId_;
  QString outputDeviceId_;
  double microphoneVolume_ = 1.0;
  double masterVolume_ = 1.0;
  bool microphoneMuted_ = false;
  bool outputMuted_ = false;
  bool speaking_ = false;
  QTimer speakingTimer_;
  std::mutex sfuRepliesMutex_;
  QHash<QString, std::shared_ptr<SfuReply>> sfuReplies_;
};

Peer::Peer(NativeRtcBackend* owner, QString sessionId, QString remoteUserId)
    : owner(owner),
      sessionId(std::move(sessionId)),
      remoteUserId(std::move(remoteUserId)) {}

Peer::~Peer() { close(); }

void Peer::createOffer(bool iceRestart) {
  if (!connection) {
    return;
  }
  webrtc::PeerConnectionInterface::RTCOfferAnswerOptions options;
  options.ice_restart = iceRestart;
  auto observer = webrtc::make_ref_counted<CreateDescriptionObserver>(
      [this](webrtc::SessionDescriptionInterface* description) {
        std::string sdp;
        description->ToString(&sdp);
        auto setObserver = webrtc::make_ref_counted<SetDescriptionObserver>();
        connection->SetLocalDescription(setObserver.get(), description);
        owner->sendSignal(sessionId, remoteUserId, QStringLiteral("offer"),
                          {{QStringLiteral("sdp"),
                            QString::fromStdString(sdp)}});
      },
      [this](const QString& error) {
        owner->reportError(QStringLiteral("p2p-offer"), error);
      });
  connection->CreateOffer(observer.get(), options);
}

void Peer::acceptOffer(const QString& sdp) {
  if (!connection) {
    return;
  }
  webrtc::SdpParseError parseError;
  std::unique_ptr<webrtc::SessionDescriptionInterface> description(
      webrtc::CreateSessionDescription(webrtc::SdpType::kOffer,
                                       sdp.toStdString(), &parseError));
  if (!description) {
    owner->reportError(
        QStringLiteral("p2p-offer"),
        QString::fromStdString(parseError.description));
    return;
  }
  auto observer = webrtc::make_ref_counted<RemoteDescriptionObserver>(
      [this] {
        webrtc::PeerConnectionInterface::RTCOfferAnswerOptions options;
        auto answerObserver =
            webrtc::make_ref_counted<CreateDescriptionObserver>(
                [this](webrtc::SessionDescriptionInterface* answer) {
                  std::string answerSdp;
                  answer->ToString(&answerSdp);
                  auto setObserver =
                      webrtc::make_ref_counted<SetDescriptionObserver>();
                  connection->SetLocalDescription(setObserver.get(), answer);
                  owner->sendSignal(
                      sessionId, remoteUserId, QStringLiteral("answer"),
                      {{QStringLiteral("sdp"),
                        QString::fromStdString(answerSdp)}});
                },
                [this](const QString& error) {
                  owner->reportError(QStringLiteral("p2p-answer"), error);
                });
        connection->CreateAnswer(answerObserver.get(), options);
      },
      [this](const QString& error) {
        owner->reportError(QStringLiteral("p2p-remote-offer"), error);
      });
  connection->SetRemoteDescription(std::move(description), observer);
}

void Peer::acceptAnswer(const QString& sdp) {
  if (!connection) {
    return;
  }
  webrtc::SdpParseError parseError;
  auto description = webrtc::CreateSessionDescription(
      webrtc::SdpType::kAnswer, sdp.toStdString(), &parseError);
  if (!description) {
    owner->reportError(
        QStringLiteral("p2p-answer"),
        QString::fromStdString(parseError.description));
    return;
  }
  auto observer = webrtc::make_ref_counted<RemoteDescriptionObserver>(
      std::function<void()>{}, [this](const QString& error) {
        owner->reportError(QStringLiteral("p2p-remote-answer"), error);
      });
  connection->SetRemoteDescription(std::move(description), observer);
}

void Peer::addIceCandidate(const QJsonObject& candidateJson) {
  if (!connection) {
    return;
  }
  const QString mid =
      candidateJson.value(QStringLiteral("sdpMid")).toString();
  const int line =
      candidateJson.value(QStringLiteral("sdpMLineIndex")).toInt();
  const QString candidate =
      candidateJson.value(QStringLiteral("candidate")).toString();
  webrtc::SdpParseError error;
  std::unique_ptr<webrtc::IceCandidate> parsed(webrtc::CreateIceCandidate(
      mid.toStdString(), line, candidate.toStdString(), &error));
  if (!parsed || !connection->AddIceCandidate(parsed.get())) {
    owner->reportError(QStringLiteral("p2p-ice"),
                       parsed ? QStringLiteral("ICE candidate rejected")
                              : QString::fromStdString(error.description));
  }
}

void Peer::close() {
  for (RemoteTrack& remote : remoteTracks) {
    if (remote.videoSink && remote.track &&
        remote.track->kind() ==
            webrtc::MediaStreamTrackInterface::kVideoKind) {
      static_cast<webrtc::VideoTrackInterface*>(remote.track.get())
          ->RemoveSink(remote.videoSink.get());
    }
  }
  remoteTracks.clear();
  if (connection) {
    connection->Close();
    connection = nullptr;
  }
}

void Peer::applyOutputState(bool muted, double masterVolume,
                            double participantVolume) {
  for (RemoteTrack& remote : remoteTracks) {
    if (!remote.track) {
      continue;
    }
    remote.track->set_enabled(!muted);
    if (remote.track->kind() ==
        webrtc::MediaStreamTrackInterface::kAudioKind) {
      auto* audioTrack =
          static_cast<webrtc::AudioTrackInterface*>(remote.track.get());
      if (audioTrack->GetSource()) {
        audioTrack->GetSource()->SetVolume(
            std::clamp(masterVolume * participantVolume, 0.0, 10.0));
      }
    }
  }
}

void Peer::OnIceCandidate(const webrtc::IceCandidate* candidate) {
  if (!candidate) {
    return;
  }
  std::string value;
  if (!candidate->ToString(&value)) {
    return;
  }
  owner->sendSignal(
      sessionId, remoteUserId, QStringLiteral("ice_candidate"),
      {{QStringLiteral("candidate"),
        QJsonObject{
            {QStringLiteral("candidate"), QString::fromStdString(value)},
            {QStringLiteral("sdpMid"),
             QString::fromStdString(candidate->sdp_mid())},
            {QStringLiteral("sdpMLineIndex"),
             candidate->sdp_mline_index()}}}});
}

void Peer::OnConnectionChange(
    webrtc::PeerConnectionInterface::PeerConnectionState state) {
  RuntimeState runtime = RuntimeState::Preparing;
  if (state ==
      webrtc::PeerConnectionInterface::PeerConnectionState::kConnected) {
    runtime = RuntimeState::Active;
  } else if (state ==
                 webrtc::PeerConnectionInterface::PeerConnectionState::kFailed ||
             state ==
                 webrtc::PeerConnectionInterface::PeerConnectionState::kClosed) {
    runtime = RuntimeState::Failed;
  } else if (state == webrtc::PeerConnectionInterface::PeerConnectionState::
                          kDisconnected) {
    runtime = RuntimeState::Recovering;
  }
  owner->postPeerState(sessionId, runtime);
}

void Peer::OnTrack(
    webrtc::scoped_refptr<webrtc::RtpTransceiverInterface> transceiver) {
  if (!transceiver || !transceiver->receiver()) {
    return;
  }
  webrtc::scoped_refptr<webrtc::MediaStreamTrackInterface> track =
      transceiver->receiver()->track();
  if (!track) {
    return;
  }
  RemoteTrack remote{track, nullptr};
  if (track->kind() == webrtc::MediaStreamTrackInterface::kVideoKind) {
    remote.videoSink = std::make_unique<QtVideoSink>(
        [owner = QPointer<NativeRtcBackend>(owner),
         session = sessionId](QImage image) mutable {
          if (owner) {
            owner->postVideoFrame(session, std::move(image));
          }
        });
    static_cast<webrtc::VideoTrackInterface*>(track.get())
        ->AddOrUpdateSink(remote.videoSink.get(), {});
  }
  remoteTracks.push_back(std::move(remote));
  owner->applyRemoteVolumes();
}

void Peer::OnRemoveTrack(
    webrtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver) {
  if (!receiver || !receiver->track()) {
    return;
  }
  const auto* removed = receiver->track().get();
  std::erase_if(remoteTracks, [removed](RemoteTrack& remote) {
    if (remote.track.get() != removed) {
      return false;
    }
    if (remote.videoSink &&
        remote.track->kind() ==
            webrtc::MediaStreamTrackInterface::kVideoKind) {
      static_cast<webrtc::VideoTrackInterface*>(remote.track.get())
          ->RemoveSink(remote.videoSink.get());
    }
    return true;
  });
}

void NativeRtcBackend::initialize() {
  if (factory_) {
    return;
  }
  webrtc::InitializeSSL();
  mediasoupclient::Initialize();
  networkThread_ = webrtc::Thread::CreateWithSocketServer();
  workerThread_ = webrtc::Thread::Create();
  signalingThread_ = webrtc::Thread::Create();
  networkThread_->SetName("baker-rtc-network", nullptr);
  workerThread_->SetName("baker-rtc-worker", nullptr);
  signalingThread_->SetName("baker-rtc-signaling", nullptr);
  if (!networkThread_->Start() || !workerThread_->Start() ||
      !signalingThread_->Start()) {
    initializationError_ =
        QStringLiteral("Unable to start libwebrtc worker threads.");
    Q_EMIT errorOccurred(QStringLiteral("webrtc"), initializationError_);
    return;
  }

  taskQueueFactory_ = webrtc::CreateDefaultTaskQueueFactory();
#ifdef Q_OS_WIN
  // Qt owns the GUI thread as an STA. Re-enter that apartment instead of
  // attempting an invalid STA-to-MTA model change.
  comInitializer_ = std::make_unique<webrtc::ScopedCOMInitializer>();
  if (comInitializer_->Succeeded()) {
    audioDevice_ = webrtc::CreateWindowsCoreAudioAudioDeviceModule(
        taskQueueFactory_.get(), true);
  }
#endif
  factory_ = webrtc::CreatePeerConnectionFactory(
      networkThread_.get(), workerThread_.get(), signalingThread_.get(),
      audioDevice_, webrtc::CreateBuiltinAudioEncoderFactory(),
      webrtc::CreateBuiltinAudioDecoderFactory(),
      webrtc::CreateBuiltinVideoEncoderFactory(),
      webrtc::CreateBuiltinVideoDecoderFactory(), nullptr, nullptr);
  if (!factory_) {
    initializationError_ =
        QStringLiteral("libwebrtc peer connection factory creation failed.");
    Q_EMIT errorOccurred(QStringLiteral("webrtc"), initializationError_);
    return;
  }
  setMicrophoneVolume(microphoneVolume_);
  speakingTimer_.start();
}

void NativeRtcBackend::shutdown() {
  speakingTimer_.stop();
  stopAll();
  factory_ = nullptr;
  audioDevice_ = nullptr;
  comInitializer_.reset();
  taskQueueFactory_.reset();
  if (signalingThread_) {
    signalingThread_->Stop();
  }
  if (workerThread_) {
    workerThread_->Stop();
  }
  if (networkThread_) {
    networkThread_->Stop();
  }
  signalingThread_.reset();
  workerThread_.reset();
  networkThread_.reset();
  webrtc::CleanupSSL();
  mediasoupclient::Cleanup();
}

void NativeRtcBackend::startVoice(
    const SessionConfiguration& configuration) {
  if (!factory_) {
    reportError(QStringLiteral("voice"), unavailableReason());
    return;
  }
  auto session = std::make_shared<Session>();
  session->configuration = configuration;
  session->localAudioTrack =
      createMicrophoneTrack(configuration.descriptor.sessionId);
  const QString id = configuration.descriptor.sessionId;
  sessions_.insert(id, std::move(session));
  Session& stored = *sessions_[id];
  if (configuration.descriptor.transportMode == TransportMode::P2p) {
    QSet<QString> users;
    for (const QJsonValue& value : configuration.participants) {
      const QString userId =
          value.toObject().value(QStringLiteral("userId")).toString();
      if (!userId.isEmpty() &&
          userId != configuration.descriptor.userId) {
        users.insert(userId);
      }
    }
    createOffersForUsers(stored, users);
    stored.state = RuntimeState::Active;
    Q_EMIT sessionStateChanged(id, stored.state);
  } else {
    startSfu(stored);
  }
}

void NativeRtcBackend::startMusicPublish(
    const SessionConfiguration& configuration, quint32 processId) {
  auto session = std::make_shared<Session>();
  session->configuration = configuration;
  session->localAudioTrack =
      createInjectedAudioTrack(*session, configuration.descriptor.sessionId);
  if (!attachLoopback(*session, processId,
                      audio::ProcessLoopbackCapture::Mode::IncludeProcessTree)) {
    reportError(QStringLiteral("music"),
                QStringLiteral("Unable to capture the selected process."));
    return;
  }
  session->state = RuntimeState::Active;
  const QString id = configuration.descriptor.sessionId;
  sessions_.insert(id, std::move(session));
  if (configuration.descriptor.transportMode == TransportMode::Sfu) {
    startSfu(*sessions_[id]);
  }
  Q_EMIT sessionStateChanged(id, RuntimeState::Active);
}

void NativeRtcBackend::startMusicListen(
    const SessionConfiguration& configuration) {
  auto session = std::make_shared<Session>();
  session->configuration = configuration;
  session->state = RuntimeState::Preparing;
  const QString id = configuration.descriptor.sessionId;
  sessions_.insert(id, std::move(session));
  if (configuration.descriptor.transportMode == TransportMode::Sfu) {
    startSfu(*sessions_[id]);
  }
  Q_EMIT sessionStateChanged(id, RuntimeState::Preparing);
}

void NativeRtcBackend::startStreamPublish(
    const SessionConfiguration& configuration, StreamSourceType sourceType,
    const QString& sourceId, const StreamQuality& quality, bool shareAudio) {
  auto session = std::make_shared<Session>();
  session->configuration = configuration;
  if (sourceType == StreamSourceType::Screen ||
      sourceType == StreamSourceType::Window) {
    session->desktopSource =
        DesktopVideoSource::create(sourceType, sourceId, quality);
    if (session->desktopSource && session->desktopSource->start()) {
      session->localVideoTrack = factory_->CreateVideoTrack(
          session->desktopSource,
          configuration.descriptor.sessionId.toStdString() + "-video");
    }
  } else {
    session->cameraSource = CameraVideoSource::create(sourceId, quality);
    if (session->cameraSource && session->cameraSource->start()) {
      session->localVideoTrack = factory_->CreateVideoTrack(
          session->cameraSource,
          configuration.descriptor.sessionId.toStdString() + "-video");
    }
    session->localAudioTrack =
        createMicrophoneTrack(configuration.descriptor.sessionId +
                              QStringLiteral("-camera"));
  }
  if (!session->localVideoTrack) {
    reportError(QStringLiteral("stream"),
                QStringLiteral("Unable to initialize the selected video source."));
    Q_EMIT sessionStateChanged(
        configuration.descriptor.sessionId,
        RuntimeState::Failed);
    return;
  }
  if (shareAudio && sourceType != StreamSourceType::Camera) {
    session->localAudioTrack =
        createInjectedAudioTrack(*session,
                                 configuration.descriptor.sessionId +
                                     QStringLiteral("-system"));
    attachLoopback(
        *session, static_cast<quint32>(QCoreApplication::applicationPid()),
        audio::ProcessLoopbackCapture::Mode::ExcludeProcessTree);
  }
  session->state = RuntimeState::Active;
  const QString id = configuration.descriptor.sessionId;
  sessions_.insert(id, std::move(session));
  if (configuration.descriptor.transportMode == TransportMode::Sfu) {
    startSfu(*sessions_[id]);
  }
  Q_EMIT sessionStateChanged(id, RuntimeState::Active);
}

void NativeRtcBackend::startStreamWatch(
    const SessionConfiguration& configuration) {
  auto session = std::make_shared<Session>();
  session->configuration = configuration;
  session->state = RuntimeState::Preparing;
  const QString id = configuration.descriptor.sessionId;
  sessions_.insert(id, std::move(session));
  if (configuration.descriptor.transportMode == TransportMode::Sfu) {
    startSfu(*sessions_[id]);
  }
  Q_EMIT sessionStateChanged(id, RuntimeState::Preparing);
}

void NativeRtcBackend::stopSession(const QString& sessionId) {
  if (!sessions_.contains(sessionId)) {
    return;
  }
  Session* current = sessions_[sessionId].get();
  for (auto& peer : current->peers) {
    sendSignal(sessionId, peer->remoteUserId, QStringLiteral("end"));
  }
  std::shared_ptr<Session> session = sessions_.take(sessionId);
  for (auto& peer : session->peers) {
    peer->close();
  }
  if (session->loopbackCapture) {
    session->loopbackCapture->stop();
  }
  if (session->sfu) {
    session->sfu->stop();
  }
  if (session->desktopSource) {
    session->desktopSource->stop();
  }
  if (session->cameraSource) {
    session->cameraSource->stop();
  }
  Q_EMIT sessionStateChanged(sessionId, RuntimeState::Idle);
}

void NativeRtcBackend::stopAll() {
  const auto ids = sessions_.keys();
  for (const QString& id : ids) {
    stopSession(id);
  }
}

void NativeRtcBackend::handleSignal(const QString& fromUserId,
                                    const QJsonObject& signal) {
  Session* session =
      resolveSession(signal.value(QStringLiteral("session")).toObject());
  if (!session || session->configuration.descriptor.transportMode !=
                      TransportMode::P2p) {
    return;
  }
  Peer* peer = ensurePeer(*session, fromUserId);
  if (!peer) {
    return;
  }
  const QString type = signal.value(QStringLiteral("type")).toString();
  if (type == QStringLiteral("offer")) {
    peer->acceptOffer(signal.value(QStringLiteral("sdp")).toString());
  } else if (type == QStringLiteral("answer")) {
    peer->acceptAnswer(signal.value(QStringLiteral("sdp")).toString());
  } else if (type == QStringLiteral("ice_candidate")) {
    peer->addIceCandidate(
        signal.value(QStringLiteral("candidate")).toObject());
  } else if (type == QStringLiteral("restart_ice")) {
    peer->createOffer(true);
  } else if (type == QStringLiteral("end")) {
    session->peers.remove(fromUserId);
  }
}

void NativeRtcBackend::handleGatewayEvent(const QString& event,
                                          const QJsonObject& data) {
  if (event == QStringLiteral("voice.state.updated")) {
    const QString channelId =
        data.value(QStringLiteral("channelId")).toString();
    for (auto& session : sessions_) {
      if (session->configuration.descriptor.mode != SessionMode::Voice ||
          session->configuration.descriptor.channelId != channelId ||
          session->configuration.descriptor.transportMode !=
              TransportMode::P2p) {
        continue;
      }
      QSet<QString> users;
      for (const QJsonValue& value :
           data.value(QStringLiteral("participants")).toArray()) {
        const QString userId =
            value.toObject().value(QStringLiteral("userId")).toString();
        if (!userId.isEmpty() &&
            userId != session->configuration.descriptor.userId) {
          users.insert(userId);
        }
      }
      createOffersForUsers(*session, users);
      for (const QString& current : session->peers.keys()) {
        if (!users.contains(current)) {
          session->peers.remove(current);
        }
      }
    }
  } else if (event == QStringLiteral("stream.viewer.joined")) {
    const QString sessionId =
        data.value(QStringLiteral("sessionId")).toString();
    const QString userId =
        data.value(QStringLiteral("userId")).toString();
    if (sessions_.contains(sessionId) && !userId.isEmpty()) {
      Peer* peer = ensurePeer(*sessions_[sessionId], userId);
      if (peer) {
        peer->createOffer();
      }
    }
  } else if (event == QStringLiteral("stream.viewer.left")) {
    const QString userId =
        data.value(QStringLiteral("userId")).toString();
    for (auto& session : sessions_) {
      if (session->configuration.descriptor.mode ==
          SessionMode::StreamPublish) {
        session->peers.remove(userId);
      }
    }
  } else if (event == QStringLiteral("music.state.updated")) {
    for (const QJsonValue& publicationValue :
         data.value(QStringLiteral("publications")).toArray()) {
      const QJsonObject publication = publicationValue.toObject();
      const QString musicId =
          publication.value(QStringLiteral("musicId")).toString();
      for (auto& session : sessions_) {
        if (session->configuration.descriptor.mode !=
                SessionMode::MusicPublish ||
            session->configuration.descriptor.streamId != musicId) {
          continue;
        }
        QSet<QString> listeners;
        for (const QJsonValue& listenerValue :
             publication.value(QStringLiteral("listeners")).toArray()) {
          const QString userId =
              listenerValue.toObject()
                  .value(QStringLiteral("userId"))
                  .toString();
          if (!userId.isEmpty()) {
            listeners.insert(userId);
          }
        }
        createOffersForUsers(*session, listeners);
      }
    }
  }
}

void NativeRtcBackend::handleSfuProducerAdded(
    const QJsonObject& producer) {
  for (auto& session : sessions_) {
    if (session->sfu) {
      session->sfu->addProducer(producer);
    }
  }
}

void NativeRtcBackend::handleSfuProducerRemoved(
    const QJsonObject& producer) {
  const QString producerId =
      producer.value(QStringLiteral("id")).toString();
  for (auto& session : sessions_) {
    if (session->sfu) {
      session->sfu->removeProducer(producerId);
    }
  }
}

void NativeRtcBackend::handleGatewayAck(const QString& requestId,
                                        const QJsonObject& data) {
  std::shared_ptr<SfuReply> reply;
  {
    std::scoped_lock lock(sfuRepliesMutex_);
    reply = sfuReplies_.value(requestId);
  }
  if (!reply) {
    return;
  }
  {
    std::scoped_lock lock(reply->mutex);
    reply->data = data;
    reply->completed = true;
  }
  reply->ready.notify_all();
}

void NativeRtcBackend::handleGatewayError(const QString& requestId,
                                          const QString& code,
                                          const QString& message) {
  std::shared_ptr<SfuReply> reply;
  {
    std::scoped_lock lock(sfuRepliesMutex_);
    reply = sfuReplies_.value(requestId);
  }
  if (reply) {
    {
      std::scoped_lock lock(reply->mutex);
      reply->error = QStringLiteral("%1: %2").arg(code, message);
      reply->completed = true;
    }
    reply->ready.notify_all();
  }
  reportError(code, message);
}

void NativeRtcBackend::setMicrophoneMuted(bool muted) {
  microphoneMuted_ = muted;
  for (auto& session : sessions_) {
    if (session->localAudioTrack &&
        (session->configuration.descriptor.mode == SessionMode::Voice ||
         session->configuration.descriptor.mode ==
             SessionMode::StreamPublish)) {
      session->localAudioTrack->set_enabled(!muted);
    }
  }
  if (muted && speaking_) {
    speaking_ = false;
    Q_EMIT localSpeakingChanged(false);
  }
}

void NativeRtcBackend::setOutputMuted(bool muted) {
  outputMuted_ = muted;
  applyRemoteVolumes();
}

void NativeRtcBackend::setInputDevice(const QString& deviceId) {
  inputDeviceId_ = deviceId;
  if (!audioDevice_) {
    return;
  }
  const int index = audioDeviceIndex(deviceId, true);
  if (index < 0) {
    reportError(QStringLiteral("audio-device"),
                QStringLiteral("Input device was not found."));
    return;
  }
  const bool running = audioDevice_->Recording();
  if (running) {
    audioDevice_->StopRecording();
  }
  audioDevice_->SetRecordingDevice(static_cast<uint16_t>(index));
  audioDevice_->InitRecording();
  if (running) {
    audioDevice_->StartRecording();
  }
}

void NativeRtcBackend::setOutputDevice(const QString& deviceId) {
  outputDeviceId_ = deviceId;
  if (!audioDevice_) {
    return;
  }
  const int index = audioDeviceIndex(deviceId, false);
  if (index < 0) {
    reportError(QStringLiteral("audio-device"),
                QStringLiteral("Output device was not found."));
    return;
  }
  const bool running = audioDevice_->Playing();
  if (running) {
    audioDevice_->StopPlayout();
  }
  audioDevice_->SetPlayoutDevice(static_cast<uint16_t>(index));
  audioDevice_->InitPlayout();
  if (running) {
    audioDevice_->StartPlayout();
  }
}

void NativeRtcBackend::setMicrophoneVolume(double volume) {
  microphoneVolume_ = std::clamp(volume, 0.0, 2.0);
  if (!audioDevice_) {
    return;
  }
  uint32_t maximum = 0;
  if (audioDevice_->MaxMicrophoneVolume(&maximum) != 0 || maximum == 0) {
    return;
  }
  const auto nativeVolume = static_cast<uint32_t>(std::lround(
      std::min(1.0, microphoneVolume_) * maximum));
  audioDevice_->SetMicrophoneVolume(nativeVolume);
}

void NativeRtcBackend::setMasterVolume(double volume) {
  masterVolume_ = std::clamp(volume, 0.0, 2.0);
  applyRemoteVolumes();
}

void NativeRtcBackend::setParticipantVolume(const QString& userId,
                                            double volume) {
  participantVolumes_.insert(userId, std::clamp(volume, 0.0, 2.0));
  applyRemoteVolumes();
}

void NativeRtcBackend::setSessionVolume(const QString& sessionId,
                                        double volume) {
  if (sessions_.contains(sessionId)) {
    sessions_[sessionId]->volume = std::clamp(volume, 0.0, 2.0);
    applyRemoteVolumes();
  }
}

Peer* NativeRtcBackend::ensurePeer(Session& session,
                                   const QString& remoteUserId) {
  if (remoteUserId.isEmpty() ||
      remoteUserId == session.configuration.descriptor.userId) {
    return nullptr;
  }
  if (session.peers.contains(remoteUserId)) {
    return session.peers[remoteUserId].get();
  }
  auto peer = std::make_shared<Peer>(
      this, session.configuration.descriptor.sessionId, remoteUserId);
  webrtc::PeerConnectionDependencies dependencies(peer.get());
  auto result = factory_->CreatePeerConnectionOrError(
      rtcConfiguration(session.configuration.iceServers),
      std::move(dependencies));
  if (!result.ok()) {
    reportError(QStringLiteral("p2p"),
                QString::fromStdString(result.error().message()));
    return nullptr;
  }
  peer->connection = result.MoveValue();
  const std::vector<std::string> streamIds{
      session.configuration.descriptor.sessionId.toStdString()};
  if (session.localAudioTrack) {
    const auto added =
        peer->connection->AddTrack(session.localAudioTrack, streamIds);
    if (!added.ok()) {
      reportError(QStringLiteral("p2p-audio"),
                  QString::fromStdString(added.error().message()));
    }
  }
  if (session.localVideoTrack) {
    const auto added =
        peer->connection->AddTrack(session.localVideoTrack, streamIds);
    if (!added.ok()) {
      reportError(QStringLiteral("p2p-video"),
                  QString::fromStdString(added.error().message()));
    } else {
      webrtc::RtpParameters parameters = added.value()->GetParameters();
      for (auto& encoding : parameters.encodings) {
        encoding.max_bitrate_bps =
            session.configuration.descriptor.mode ==
                    SessionMode::StreamPublish
                ? std::optional<int>(16'000'000)
                : std::nullopt;
      }
      added.value()->SetParameters(parameters);
    }
  }
  Peer* output = peer.get();
  session.peers.insert(remoteUserId, std::move(peer));
  return output;
}

Session* NativeRtcBackend::resolveSession(const QJsonObject& descriptor) {
  const QString sessionId =
      descriptor.value(QStringLiteral("sessionId")).toString();
  if (sessions_.contains(sessionId)) {
    return sessions_[sessionId].get();
  }
  const QString channelId =
      descriptor.value(QStringLiteral("channelId")).toString();
  const QString streamId =
      descriptor.value(QStringLiteral("streamId")).toString();
  for (auto& session : sessions_) {
    if (!streamId.isEmpty() &&
        session->configuration.descriptor.streamId == streamId) {
      return session.get();
    }
    if (streamId.isEmpty() &&
        session->configuration.descriptor.channelId == channelId &&
        session->configuration.descriptor.mode == SessionMode::Voice) {
      return session.get();
    }
  }
  return nullptr;
}

void NativeRtcBackend::sendSignal(const QString& sessionId,
                                  const QString& targetUserId,
                                  const QString& type,
                                  const QJsonObject& fields) {
  if (!sessions_.contains(sessionId)) {
    return;
  }
  QJsonObject signal = fields;
  signal.insert(QStringLiteral("type"), type);
  signal.insert(
      QStringLiteral("session"),
      descriptorJson(sessions_[sessionId]->configuration.descriptor));
  Q_EMIT gatewayCommandRequested(
      newRequestId(), QStringLiteral("media.signal.%1").arg(type),
      {{QStringLiteral("targetUserId"), targetUserId},
       {QStringLiteral("signal"), signal}});
}

void NativeRtcBackend::reportError(const QString& scope,
                                   const QString& message) {
  QMetaObject::invokeMethod(
      this, [this, scope, message] { Q_EMIT errorOccurred(scope, message); },
      Qt::QueuedConnection);
}

void NativeRtcBackend::postVideoFrame(const QString& sessionId,
                                      QImage image) {
  QMetaObject::invokeMethod(
      this,
      [this, sessionId, image = std::move(image)] {
        Q_EMIT remoteVideoFrameAvailable(sessionId, image);
      },
      Qt::QueuedConnection);
}

void NativeRtcBackend::postPeerState(const QString& sessionId,
                                     RuntimeState state) {
  QMetaObject::invokeMethod(
      this,
      [this, sessionId, state] {
        if (sessions_.contains(sessionId)) {
          sessions_[sessionId]->state = state;
        }
        Q_EMIT sessionStateChanged(sessionId, state);
      },
      Qt::QueuedConnection);
}

void NativeRtcBackend::createOffersForUsers(
    Session& session, const QSet<QString>& remoteUsers) {
  for (const QString& userId : remoteUsers) {
    if (session.peers.contains(userId)) {
      continue;
    }
    if (Peer* peer = ensurePeer(session, userId)) {
      peer->createOffer();
    }
  }
}

webrtc::scoped_refptr<webrtc::AudioTrackInterface>
NativeRtcBackend::createMicrophoneTrack(const QString& id) {
  if (!factory_) {
    return nullptr;
  }
  webrtc::AudioOptions options;
  options.echo_cancellation = true;
  options.auto_gain_control = true;
  options.noise_suppression = true;
  auto source = factory_->CreateAudioSource(options);
  auto track =
      factory_->CreateAudioTrack(id.toStdString() + "-audio", source.get());
  if (track) {
    track->set_enabled(!microphoneMuted_);
  }
  return track;
}

webrtc::scoped_refptr<webrtc::AudioTrackInterface>
NativeRtcBackend::createInjectedAudioTrack(Session& session,
                                           const QString& id) {
  session.injectedAudioSource =
      webrtc::make_ref_counted<InjectedAudioSource>();
  return factory_->CreateAudioTrack(id.toStdString() + "-audio",
                                    session.injectedAudioSource.get());
}

bool NativeRtcBackend::attachLoopback(
    Session& session, quint32 processId,
    audio::ProcessLoopbackCapture::Mode mode) {
  if (!session.injectedAudioSource) {
    return false;
  }
  session.loopbackCapture =
      std::make_unique<audio::ProcessLoopbackCapture>();
  QPointer<NativeRtcBackend> owner(this);
  webrtc::scoped_refptr<InjectedAudioSource> source =
      session.injectedAudioSource;
  auto format = std::make_shared<std::pair<int, int>>(48'000, 2);
  connect(session.loopbackCapture.get(),
          &audio::ProcessLoopbackCapture::formatReady, this,
          [format, owner](int rate, int count) {
            if (!owner) {
              return;
            }
            format->first = rate;
            format->second = count;
          });
  connect(session.loopbackCapture.get(),
          &audio::ProcessLoopbackCapture::samplesReady, this,
          [source, format](const QByteArray& bytes) {
            const auto* samples =
                reinterpret_cast<const float*>(bytes.constData());
            const std::size_t sampleCount =
                static_cast<std::size_t>(bytes.size()) / sizeof(float);
            const int channels = format->second;
            source->pushFloat32(
                samples,
                channels > 0
                    ? sampleCount / static_cast<std::size_t>(channels)
                    : 0,
                format->first, channels);
          });
  connect(session.loopbackCapture.get(),
          &audio::ProcessLoopbackCapture::errorOccurred, this,
          [this](const QString& error) {
            reportError(QStringLiteral("loopback"), error);
          });
  return session.loopbackCapture->start(processId, mode);
}

webrtc::PeerConnectionInterface::RTCConfiguration
NativeRtcBackend::rtcConfiguration(const QList<IceServer>& servers) const {
  webrtc::PeerConnectionInterface::RTCConfiguration configuration;
  configuration.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
  configuration.continual_gathering_policy =
      webrtc::PeerConnectionInterface::GATHER_CONTINUALLY;
  for (const IceServer& source : servers) {
    webrtc::PeerConnectionInterface::IceServer server;
    for (const QString& url : source.urls) {
      server.urls.push_back(url.toStdString());
    }
    server.username = source.username.toStdString();
    server.password = source.credential.toStdString();
    configuration.servers.push_back(std::move(server));
  }
  return configuration;
}

int NativeRtcBackend::audioDeviceIndex(const QString& id,
                                       bool input) const {
  if (!audioDevice_ || id.isEmpty()) {
    return 0;
  }
  const int count =
      input ? audioDevice_->RecordingDevices()
            : audioDevice_->PlayoutDevices();
  for (int index = 0; index < count; ++index) {
    char name[webrtc::kAdmMaxDeviceNameSize] = {};
    char guid[webrtc::kAdmMaxGuidSize] = {};
    const int result =
        input ? audioDevice_->RecordingDeviceName(
                    static_cast<uint16_t>(index), name, guid)
              : audioDevice_->PlayoutDeviceName(
                    static_cast<uint16_t>(index), name, guid);
    if (result == 0 &&
        (QString::fromUtf8(guid) == id || QString::fromUtf8(name) == id)) {
      return index;
    }
  }
  return -1;
}

void NativeRtcBackend::applyRemoteVolumes() {
  for (auto& session : sessions_) {
    if (session->sfu) {
      session->sfu->setOutputState(
          outputMuted_, masterVolume_ * session->volume);
    }
    for (auto& peer : session->peers) {
      const double participant =
          participantVolumes_.value(peer->remoteUserId, 1.0) *
          session->volume;
      peer->applyOutputState(outputMuted_, masterVolume_, participant);
    }
  }
}

void NativeRtcBackend::startSfu(Session& session) {
  const QString id = session.configuration.descriptor.sessionId;
  session.sfu = std::make_unique<NativeSfuSession>(
      session.configuration, factory_.get(), session.localAudioTrack,
      session.localVideoTrack,
      [this](const QString& command, const QJsonObject& data) {
        return sendSfuCommand(command, data);
      },
      [this, id](RuntimeState state) { postPeerState(id, state); },
      [this, id](QImage image) {
        postVideoFrame(id, std::move(image));
      },
      [this](const QString& scope, const QString& message) {
        reportError(scope, message);
      });
  session.sfu->setOutputState(outputMuted_,
                              masterVolume_ * session.volume);
  session.sfu->start();
}

QJsonObject NativeRtcBackend::sendSfuCommand(
    const QString& command, const QJsonObject& data) {
  const QString id = newRequestId();
  auto reply = std::make_shared<SfuReply>();
  {
    std::scoped_lock lock(sfuRepliesMutex_);
    sfuReplies_.insert(id, reply);
  }
  Q_EMIT gatewayCommandRequested(id, command, data);

  std::unique_lock lock(reply->mutex);
  const bool received = reply->ready.wait_for(
      lock, std::chrono::seconds(20),
      [&reply] { return reply->completed; });
  lock.unlock();
  {
    std::scoped_lock repliesLock(sfuRepliesMutex_);
    sfuReplies_.remove(id);
  }
  if (!received) {
    throw std::runtime_error(
        QStringLiteral("Timed out waiting for %1 ACK").arg(command)
            .toStdString());
  }
  if (!reply->error.isEmpty()) {
    throw std::runtime_error(reply->error.toStdString());
  }
  return reply->data;
}

void NativeRtcBackend::sampleSpeaking() {
  int maximum = 0;
  for (const auto& session : sessions_) {
    if (session->configuration.descriptor.mode != SessionMode::Voice ||
        !session->localAudioTrack) {
      continue;
    }
    int level = 0;
    if (session->localAudioTrack->GetSignalLevel(&level)) {
      maximum = std::max(maximum, level);
    }
  }
  const bool next = !microphoneMuted_ && maximum >= 400;
  if (next != speaking_) {
    speaking_ = next;
    Q_EMIT localSpeakingChanged(next);
  }
}

}  // namespace

RtcBackend* createRtcBackend(QObject* parent) {
  return new NativeRtcBackend(parent);
}

}  // namespace baker::media

#include "NativeRtcBackend.moc"

#endif
