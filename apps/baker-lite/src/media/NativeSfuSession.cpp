#include "NativeSfuSession.hpp"

#ifdef BAKER_LITE_WITH_WEBRTC

#include "QtVideoSink.hpp"

#include <mediasoupclient.hpp>

#include <QJsonArray>
#include <QJsonDocument>

#include <atomic>
#include <chrono>
#include <future>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <utility>

namespace baker::media {
namespace {

nlohmann::json toNativeJson(const QJsonValue& value) {
  const QByteArray bytes =
      value.isObject()
          ? QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact)
          : QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact);
  return nlohmann::json::parse(bytes.constData(), nullptr, false);
}

QJsonObject toQtObject(const nlohmann::json& value) {
  const QByteArray bytes =
      QByteArray::fromStdString(value.dump());
  return QJsonDocument::fromJson(bytes).object();
}

QString nativeString(const nlohmann::json& object, const char* key) {
  const auto iterator = object.find(key);
  return iterator != object.end() && iterator->is_string()
             ? QString::fromStdString(iterator->get<std::string>())
             : QString();
}

bool publishingMode(SessionMode mode) {
  return mode == SessionMode::Voice ||
         mode == SessionMode::MusicPublish ||
         mode == SessionMode::StreamPublish;
}

bool receivingMode(SessionMode mode) {
  return mode == SessionMode::Voice ||
         mode == SessionMode::MusicListen ||
         mode == SessionMode::StreamWatch;
}

QString producerSource(SessionMode mode) {
  if (mode == SessionMode::Voice) {
    return QStringLiteral("voice");
  }
  if (mode == SessionMode::MusicPublish ||
      mode == SessionMode::MusicListen) {
    return QStringLiteral("music");
  }
  return QStringLiteral("stream");
}

}  // namespace

class NativeSfuSession::Impl final
    : public mediasoupclient::SendTransport::Listener,
      public mediasoupclient::RecvTransport::Listener,
      public mediasoupclient::Producer::Listener,
      public mediasoupclient::Consumer::Listener {
 public:
  Impl(SessionConfiguration configuration,
       webrtc::PeerConnectionFactoryInterface* factory,
       webrtc::scoped_refptr<webrtc::AudioTrackInterface> localAudio,
       webrtc::scoped_refptr<webrtc::VideoTrackInterface> localVideo,
       Command command, StateCallback stateCallback,
       VideoCallback videoCallback, ErrorCallback errorCallback)
      : configuration_(std::move(configuration)),
        factory_(factory),
        localAudio_(std::move(localAudio)),
        localVideo_(std::move(localVideo)),
        command_(std::move(command)),
        stateCallback_(std::move(stateCallback)),
        videoCallback_(std::move(videoCallback)),
        errorCallback_(std::move(errorCallback)) {}

  ~Impl() override { stop(); }

  void start() {
    if (worker_.joinable()) {
      return;
    }
    stopped_.store(false);
    worker_ = std::jthread(
        [this](std::stop_token token) { setup(token); });
  }

  void stop() {
    if (stopped_.exchange(true)) {
      return;
    }
    if (worker_.joinable()) {
      worker_.request_stop();
      worker_.join();
    }
    std::scoped_lock lock(mutex_);
    for (auto& [id, record] : consumers_) {
      if (record.videoSink && record.consumer &&
          record.consumer->GetTrack() &&
          record.consumer->GetKind() == "video") {
        static_cast<webrtc::VideoTrackInterface*>(
            record.consumer->GetTrack())
            ->RemoveSink(record.videoSink.get());
      }
      if (record.consumer) {
        record.consumer->Close();
      }
    }
    consumers_.clear();
    for (auto& [id, producer] : producers_) {
      if (producer) {
        producer->Close();
      }
    }
    producers_.clear();
    if (sendTransport_) {
      sendTransport_->Close();
      sendTransport_.reset();
    }
    if (recvTransport_) {
      recvTransport_->Close();
      recvTransport_.reset();
    }
    stateCallback_(RuntimeState::Idle);
  }

  void addProducer(const QJsonObject& producer) {
    if (stopped_.load() || !matchesProducer(producer)) {
      return;
    }
    std::jthread consumerWorker(
        [this, producer](std::stop_token) {
          try {
            consume(producer);
          } catch (const std::exception& error) {
            errorCallback_(QStringLiteral("sfu-consume"),
                           QString::fromUtf8(error.what()));
          }
        });
    consumerWorker.detach();
  }

  void removeProducer(const QString& producerId) {
    std::scoped_lock lock(mutex_);
    const std::string id = producerId.toStdString();
    auto iterator = consumers_.find(id);
    if (iterator == consumers_.end()) {
      return;
    }
    if (iterator->second.videoSink && iterator->second.consumer &&
        iterator->second.consumer->GetTrack() &&
        iterator->second.consumer->GetKind() == "video") {
      static_cast<webrtc::VideoTrackInterface*>(
          iterator->second.consumer->GetTrack())
          ->RemoveSink(iterator->second.videoSink.get());
    }
    iterator->second.consumer->Close();
    consumers_.erase(iterator);
  }

  void setOutputState(bool muted, double volume) {
    std::scoped_lock lock(mutex_);
    outputMuted_ = muted;
    outputVolume_ = std::clamp(volume, 0.0, 10.0);
    for (auto& [id, record] : consumers_) {
      webrtc::MediaStreamTrackInterface* track =
          record.consumer ? record.consumer->GetTrack() : nullptr;
      if (!track) {
        continue;
      }
      track->set_enabled(!muted);
      if (record.consumer->GetKind() == "audio") {
        auto* audio =
            static_cast<webrtc::AudioTrackInterface*>(track);
        if (audio->GetSource()) {
          audio->GetSource()->SetVolume(outputVolume_);
        }
      }
    }
  }

  std::future<void> OnConnect(
      mediasoupclient::Transport* transport,
      const nlohmann::json& dtlsParameters) override {
    std::promise<void> promise;
    auto future = promise.get_future();
    try {
      QJsonObject data = baseDescriptor();
      data.insert(QStringLiteral("transportId"),
                  QString::fromStdString(transport->GetId()));
      data.insert(QStringLiteral("dtlsParameters"),
                  toQtObject(dtlsParameters));
      command_(QStringLiteral("media.sfu.connect_transport"), data);
      promise.set_value();
    } catch (...) {
      promise.set_exception(std::current_exception());
    }
    return future;
  }

  void OnConnectionStateChange(
      mediasoupclient::Transport*,
      const std::string& connectionState) override {
    const QString state = QString::fromStdString(connectionState);
    if (state == QStringLiteral("connected")) {
      stateCallback_(RuntimeState::Active);
    } else if (state == QStringLiteral("failed") ||
               state == QStringLiteral("closed")) {
      stateCallback_(RuntimeState::Failed);
    } else if (state == QStringLiteral("disconnected")) {
      stateCallback_(RuntimeState::Recovering);
    } else {
      stateCallback_(RuntimeState::Preparing);
    }
  }

  std::future<std::string> OnProduce(
      mediasoupclient::SendTransport* transport,
      const std::string& kind, nlohmann::json rtpParameters,
      const nlohmann::json& appData) override {
    std::promise<std::string> promise;
    auto future = promise.get_future();
    try {
      QJsonObject data = baseDescriptor();
      data.insert(QStringLiteral("transportId"),
                  QString::fromStdString(transport->GetId()));
      data.insert(QStringLiteral("kind"), QString::fromStdString(kind));
      data.insert(QStringLiteral("rtpParameters"),
                  toQtObject(rtpParameters));
      data.insert(QStringLiteral("appData"), toQtObject(appData));
      const QJsonObject response =
          command_(QStringLiteral("media.sfu.produce"), data);
      promise.set_value(
          response.value(QStringLiteral("producerId"))
              .toString()
              .toStdString());
    } catch (...) {
      promise.set_exception(std::current_exception());
    }
    return future;
  }

  std::future<std::string> OnProduceData(
      mediasoupclient::SendTransport*,
      const nlohmann::json&, const std::string&, const std::string&,
      const nlohmann::json&) override {
    std::promise<std::string> promise;
    auto future = promise.get_future();
    promise.set_exception(std::make_exception_ptr(
        std::runtime_error("Baker Lite does not use SCTP data producers.")));
    return future;
  }

  void OnTransportClose(mediasoupclient::Producer*) override {}
  void OnTransportClose(mediasoupclient::Consumer*) override {}

 private:
  struct ConsumerRecord {
    std::unique_ptr<mediasoupclient::Consumer> consumer;
    std::unique_ptr<QtVideoSink> videoSink;
  };

  void setup(std::stop_token token) {
    try {
      stateCallback_(RuntimeState::Preparing);
      mediasoupclient::PeerConnection::Options peerOptions;
      peerOptions.factory = factory_;
      peerOptions.config.sdp_semantics =
          webrtc::SdpSemantics::kUnifiedPlan;
      device_.Load(
          toNativeJson(configuration_.routerRtpCapabilities), &peerOptions);
      if (token.stop_requested()) {
        return;
      }
      if (publishingMode(configuration_.descriptor.mode)) {
        createSendTransport(peerOptions);
        produceLocalTracks();
      }
      if (receivingMode(configuration_.descriptor.mode)) {
        createRecvTransport(peerOptions);
        for (const QJsonValue& producer :
             configuration_.producers) {
          if (token.stop_requested()) {
            break;
          }
          if (matchesProducer(producer.toObject())) {
            consume(producer.toObject());
          }
        }
      }
      stateCallback_(RuntimeState::Active);
    } catch (const std::exception& error) {
      stateCallback_(RuntimeState::Failed);
      errorCallback_(QStringLiteral("sfu"),
                     QString::fromUtf8(error.what()));
    }
  }

  QJsonObject baseDescriptor() const {
    QJsonObject output{
        {QStringLiteral("channelId"),
         configuration_.descriptor.channelId},
        {QStringLiteral("mode"),
         sessionModeName(configuration_.descriptor.mode)},
        {QStringLiteral("sessionId"),
         configuration_.descriptor.sessionId}};
    if (!configuration_.descriptor.streamId.isEmpty()) {
      output.insert(QStringLiteral("streamId"),
                    configuration_.descriptor.streamId);
    }
    return output;
  }

  QJsonObject createTransport(const QString& direction) {
    QJsonObject data = baseDescriptor();
    data.insert(QStringLiteral("direction"), direction);
    return command_(QStringLiteral("media.sfu.create_transport"), data)
        .value(QStringLiteral("transportOptions"))
        .toObject();
  }

  void createSendTransport(
      const mediasoupclient::PeerConnection::Options& peerOptions) {
    const QJsonObject transport = createTransport(QStringLiteral("send"));
    const nlohmann::json options = toNativeJson(transport);
    const std::string id = nativeString(options, "id").toStdString();
    const nlohmann::json iceParameters = options.at("iceParameters");
    const nlohmann::json iceCandidates = options.at("iceCandidates");
    const nlohmann::json dtlsParameters = options.at("dtlsParameters");
    if (options.contains("sctpParameters")) {
      sendTransport_.reset(device_.CreateSendTransport(
          this, id, iceParameters, iceCandidates, dtlsParameters,
          options.at("sctpParameters"), &peerOptions));
    } else {
      sendTransport_.reset(device_.CreateSendTransport(
          this, id, iceParameters, iceCandidates, dtlsParameters,
          &peerOptions));
    }
  }

  void createRecvTransport(
      const mediasoupclient::PeerConnection::Options& peerOptions) {
    const QJsonObject transport = createTransport(QStringLiteral("recv"));
    const nlohmann::json options = toNativeJson(transport);
    const std::string id = nativeString(options, "id").toStdString();
    const nlohmann::json iceParameters = options.at("iceParameters");
    const nlohmann::json iceCandidates = options.at("iceCandidates");
    const nlohmann::json dtlsParameters = options.at("dtlsParameters");
    if (options.contains("sctpParameters")) {
      recvTransport_.reset(device_.CreateRecvTransport(
          this, id, iceParameters, iceCandidates, dtlsParameters,
          options.at("sctpParameters"), &peerOptions));
    } else {
      recvTransport_.reset(device_.CreateRecvTransport(
          this, id, iceParameters, iceCandidates, dtlsParameters,
          &peerOptions));
    }
  }

  void produceLocalTracks() {
    if (!sendTransport_) {
      return;
    }
    QJsonObject appData{
        {QStringLiteral("source"),
         producerSource(configuration_.descriptor.mode)}};
    if (!configuration_.descriptor.streamId.isEmpty()) {
      appData.insert(QStringLiteral("streamId"),
                     configuration_.descriptor.streamId);
    }
    const nlohmann::json nativeAppData = toNativeJson(appData);
    if (localAudio_) {
      std::unique_ptr<mediasoupclient::Producer> producer(
          sendTransport_->Produce(this, localAudio_.get(), nullptr, nullptr,
                                  nullptr, nativeAppData));
      producers_.insert_or_assign(producer->GetId(), std::move(producer));
    }
    if (localVideo_) {
      std::unique_ptr<mediasoupclient::Producer> producer(
          sendTransport_->Produce(this, localVideo_.get(), nullptr, nullptr,
                                  nullptr, nativeAppData));
      producers_.insert_or_assign(producer->GetId(), std::move(producer));
    }
  }

  bool matchesProducer(const QJsonObject& producer) const {
    if (producer.value(QStringLiteral("sessionId")).toString() ==
        configuration_.descriptor.sessionId) {
      return false;
    }
    if (producer.value(QStringLiteral("source")).toString() !=
        producerSource(configuration_.descriptor.mode)) {
      return false;
    }
    if (!configuration_.descriptor.streamId.isEmpty() &&
        producer.value(QStringLiteral("streamId")).toString() !=
            configuration_.descriptor.streamId) {
      return false;
    }
    return producer.value(QStringLiteral("channelId")).toString() ==
           configuration_.descriptor.channelId;
  }

  void consume(const QJsonObject& producer) {
    if (!recvTransport_ || stopped_.load()) {
      return;
    }
    const QString producerId =
        producer.value(QStringLiteral("id")).toString();
    if (producerId.isEmpty()) {
      return;
    }
    {
      std::scoped_lock lock(mutex_);
      if (consumers_.contains(producerId.toStdString())) {
        return;
      }
    }
    QJsonObject data = baseDescriptor();
    data.insert(QStringLiteral("transportId"),
                QString::fromStdString(recvTransport_->GetId()));
    data.insert(QStringLiteral("producerId"), producerId);
    data.insert(QStringLiteral("rtpCapabilities"),
                toQtObject(device_.GetRtpCapabilities()));
    const QJsonObject response =
        command_(QStringLiteral("media.sfu.consume"), data);

    nlohmann::json rtpParameters =
        toNativeJson(response.value(QStringLiteral("rtpParameters")));
    nlohmann::json appData = toNativeJson(producer);
    auto consumer = std::unique_ptr<mediasoupclient::Consumer>(
        recvTransport_->Consume(
            this,
            response.value(QStringLiteral("id"))
                .toString()
                .toStdString(),
            producerId.toStdString(),
            response.value(QStringLiteral("kind"))
                .toString()
                .toStdString(),
            &rtpParameters, appData));
    if (!consumer) {
      throw std::runtime_error("libmediasoupclient returned no consumer.");
    }

    ConsumerRecord record;
    if (consumer->GetKind() == "video" && consumer->GetTrack()) {
      record.videoSink = std::make_unique<QtVideoSink>(
          [callback = videoCallback_](QImage image) mutable {
            callback(std::move(image));
          });
      static_cast<webrtc::VideoTrackInterface*>(consumer->GetTrack())
          ->AddOrUpdateSink(record.videoSink.get(), {});
    } else if (consumer->GetKind() == "audio" && consumer->GetTrack()) {
      auto* audio = static_cast<webrtc::AudioTrackInterface*>(
          consumer->GetTrack());
      audio->set_enabled(!outputMuted_);
      if (audio->GetSource()) {
        audio->GetSource()->SetVolume(outputVolume_);
      }
    }
    const QString consumerId =
        response.value(QStringLiteral("consumerId")).toString();
    record.consumer = std::move(consumer);
    {
      std::scoped_lock lock(mutex_);
      consumers_.insert_or_assign(producerId.toStdString(),
                                  std::move(record));
    }
    QJsonObject resume = baseDescriptor();
    resume.insert(QStringLiteral("consumerId"), consumerId);
    command_(QStringLiteral("media.sfu.resume_consumer"), resume);
  }

  SessionConfiguration configuration_;
  webrtc::PeerConnectionFactoryInterface* factory_ = nullptr;
  webrtc::scoped_refptr<webrtc::AudioTrackInterface> localAudio_;
  webrtc::scoped_refptr<webrtc::VideoTrackInterface> localVideo_;
  Command command_;
  StateCallback stateCallback_;
  VideoCallback videoCallback_;
  ErrorCallback errorCallback_;
  mediasoupclient::Device device_;
  std::unique_ptr<mediasoupclient::SendTransport> sendTransport_;
  std::unique_ptr<mediasoupclient::RecvTransport> recvTransport_;
  std::unordered_map<std::string,
                     std::unique_ptr<mediasoupclient::Producer>>
      producers_;
  std::unordered_map<std::string, ConsumerRecord> consumers_;
  std::jthread worker_;
  std::mutex mutex_;
  std::atomic_bool stopped_ = true;
  bool outputMuted_ = false;
  double outputVolume_ = 1.0;
};

NativeSfuSession::NativeSfuSession(
    SessionConfiguration configuration,
    webrtc::PeerConnectionFactoryInterface* factory,
    webrtc::scoped_refptr<webrtc::AudioTrackInterface> localAudio,
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> localVideo,
    Command command, StateCallback stateCallback,
    VideoCallback videoCallback, ErrorCallback errorCallback)
    : impl_(std::make_unique<Impl>(
          std::move(configuration), factory, std::move(localAudio),
          std::move(localVideo), std::move(command),
          std::move(stateCallback), std::move(videoCallback),
          std::move(errorCallback))) {}

NativeSfuSession::~NativeSfuSession() = default;
void NativeSfuSession::start() { impl_->start(); }
void NativeSfuSession::stop() { impl_->stop(); }
void NativeSfuSession::addProducer(const QJsonObject& producer) {
  impl_->addProducer(producer);
}
void NativeSfuSession::removeProducer(const QString& producerId) {
  impl_->removeProducer(producerId);
}
void NativeSfuSession::setOutputState(bool muted, double volume) {
  impl_->setOutputState(muted, volume);
}

}  // namespace baker::media

#endif
