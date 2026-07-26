#pragma once

#include <QImage>
#include <QList>
#include <QString>

namespace baker::media {

struct AudioDeviceInfo {
  QString id;
  QString name;
  bool isDefault = false;
};

enum class CaptureKind {
  Screen,
  Window,
  Camera,
};

struct CaptureSourceInfo {
  QString id;
  QString name;
  CaptureKind kind = CaptureKind::Screen;
  QImage thumbnail;
};

class MediaCatalog {
 public:
  [[nodiscard]] static QList<AudioDeviceInfo> inputDevices();
  [[nodiscard]] static QList<AudioDeviceInfo> outputDevices();
  [[nodiscard]] static QList<CaptureSourceInfo> captureSources();
};

}  // namespace baker::media
