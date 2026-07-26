#pragma once

#ifdef BAKER_LITE_WITH_WEBRTC

#include "MediaTypes.hpp"
#include "WebRtcQtCompatibility.hpp"

#include "api/media_stream_interface.h"
#include "api/peer_connection_interface.h"
#include "api/scoped_refptr.h"

#include <QImage>
#include <QJsonObject>

#include <functional>
#include <memory>

namespace baker::media {

class NativeSfuSession final {
 public:
  using Command = std::function<QJsonObject(
      const QString& command, const QJsonObject& data)>;
  using StateCallback = std::function<void(RuntimeState)>;
  using VideoCallback = std::function<void(QImage)>;
  using ErrorCallback =
      std::function<void(const QString& scope, const QString& message)>;

  NativeSfuSession(
      SessionConfiguration configuration,
      webrtc::PeerConnectionFactoryInterface* factory,
      webrtc::scoped_refptr<webrtc::AudioTrackInterface> localAudio,
      webrtc::scoped_refptr<webrtc::VideoTrackInterface> localVideo,
      Command command, StateCallback stateCallback,
      VideoCallback videoCallback, ErrorCallback errorCallback);
  ~NativeSfuSession();

  NativeSfuSession(const NativeSfuSession&) = delete;
  NativeSfuSession& operator=(const NativeSfuSession&) = delete;

  void start();
  void stop();
  void addProducer(const QJsonObject& producer);
  void removeProducer(const QString& producerId);
  void setOutputState(bool muted, double volume);

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace baker::media

#endif
