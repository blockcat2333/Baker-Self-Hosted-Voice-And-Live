#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QList>
#include <QMetaType>
#include <QSize>
#include <QString>

namespace baker::media {

enum class TransportMode {
  P2p,
  Sfu,
};

enum class SessionMode {
  Voice,
  MusicPublish,
  MusicListen,
  StreamPublish,
  StreamWatch,
};

enum class RuntimeState {
  Idle,
  Preparing,
  Active,
  Recovering,
  Closing,
  Failed,
};

enum class StreamSourceType {
  Screen,
  Window,
  Camera,
};

enum class VideoCodec {
  Default,
  H264,
  Vp8,
  Vp9,
  Av1,
};

struct IceServer {
  QStringList urls;
  QString username;
  QString credential;
};

struct SessionDescriptor {
  QString channelId;
  QString sessionId;
  QString streamId;
  QString userId;
  SessionMode mode = SessionMode::Voice;
  TransportMode transportMode = TransportMode::P2p;
};

struct SessionConfiguration {
  SessionDescriptor descriptor;
  QList<IceServer> iceServers;
  QJsonObject routerRtpCapabilities;
  QJsonArray producers;
  QJsonArray participants;
};

struct StreamQuality {
  QString resolution = QStringLiteral("720p");
  int frameRate = 30;
  int bitrateKbps = 4000;
  VideoCodec codec = VideoCodec::Default;
};

struct VoiceParticipant {
  QString userId;
  QString sessionId;
  bool muted = false;
  bool speaking = false;
  double volume = 1.0;
  double gatewayRttMs = 0.0;
  double packetLossPercent = 0.0;
  bool stale = false;
};

struct MediaStatistics {
  QString codec;
  QSize frameSize;
  double framesPerSecond = 0.0;
  double bitrateKbps = 0.0;
  double packetLossPercent = 0.0;
  double roundTripTimeMs = 0.0;
  QString qualityLimitationReason;
};

inline QString transportModeName(TransportMode mode) {
  return mode == TransportMode::Sfu ? QStringLiteral("sfu")
                                    : QStringLiteral("p2p");
}

inline TransportMode parseTransportMode(const QJsonValue& value) {
  return value.toString() == QStringLiteral("sfu") ? TransportMode::Sfu
                                                   : TransportMode::P2p;
}

inline QString sessionModeName(SessionMode mode) {
  switch (mode) {
    case SessionMode::Voice:
      return QStringLiteral("voice");
    case SessionMode::MusicPublish:
      return QStringLiteral("music_publish");
    case SessionMode::MusicListen:
      return QStringLiteral("music_listen");
    case SessionMode::StreamPublish:
      return QStringLiteral("stream_publish");
    case SessionMode::StreamWatch:
      return QStringLiteral("stream_watch");
  }
  return QStringLiteral("voice");
}

inline QList<IceServer> parseIceServers(const QJsonArray& input) {
  QList<IceServer> output;
  output.reserve(input.size());
  for (const QJsonValue& value : input) {
    const QJsonObject object = value.toObject();
    IceServer server;
    const QJsonValue urls = object.value(QStringLiteral("urls"));
    if (urls.isArray()) {
      for (const QJsonValue& url : urls.toArray()) {
        if (url.isString() && !url.toString().isEmpty()) {
          server.urls.append(url.toString());
        }
      }
    } else if (urls.isString() && !urls.toString().isEmpty()) {
      server.urls.append(urls.toString());
    }
    server.username = object.value(QStringLiteral("username")).toString();
    server.credential = object.value(QStringLiteral("credential")).toString();
    if (!server.urls.isEmpty()) {
      output.append(std::move(server));
    }
  }
  return output;
}

}  // namespace baker::media

Q_DECLARE_METATYPE(baker::media::RuntimeState)
Q_DECLARE_METATYPE(baker::media::MediaStatistics)
