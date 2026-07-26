#include "MediaCatalog.hpp"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QPixmap>
#include <QScreen>

#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <wrl/client.h>
#endif

#ifdef BAKER_LITE_WITH_WEBRTC
#include "modules/desktop_capture/desktop_capture_options.h"
#include "modules/desktop_capture/desktop_capturer.h"
#include "modules/video_capture/video_capture_factory.h"
#endif

#include <memory>

namespace baker::media {
namespace {

#ifdef Q_OS_WIN
using Microsoft::WRL::ComPtr;

QList<AudioDeviceInfo> enumerateAudio(EDataFlow flow) {
  QList<AudioDeviceInfo> output;
  const HRESULT initialized =
      CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool uninitialize = SUCCEEDED(initialized);
  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                              CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) {
    if (uninitialize) {
      CoUninitialize();
    }
    return output;
  }

  LPWSTR defaultId = nullptr;
  ComPtr<IMMDevice> defaultDevice;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(
          flow, eConsole, &defaultDevice))) {
    defaultDevice->GetId(&defaultId);
  }
  const QString defaultIdentifier =
      defaultId ? QString::fromWCharArray(defaultId) : QString();
  CoTaskMemFree(defaultId);

  ComPtr<IMMDeviceCollection> collection;
  if (SUCCEEDED(enumerator->EnumAudioEndpoints(
          flow, DEVICE_STATE_ACTIVE, &collection))) {
    UINT count = 0;
    collection->GetCount(&count);
    for (UINT index = 0; index < count; ++index) {
      ComPtr<IMMDevice> device;
      if (FAILED(collection->Item(index, &device))) {
        continue;
      }
      LPWSTR rawId = nullptr;
      if (FAILED(device->GetId(&rawId))) {
        continue;
      }
      const QString id = QString::fromWCharArray(rawId);
      CoTaskMemFree(rawId);

      QString name = id;
      ComPtr<IPropertyStore> properties;
      if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties))) {
        PROPVARIANT value;
        PropVariantInit(&value);
        if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName,
                                           &value)) &&
            value.vt == VT_LPWSTR && value.pwszVal != nullptr) {
          name = QString::fromWCharArray(value.pwszVal);
        }
        PropVariantClear(&value);
      }
      output.append(
          AudioDeviceInfo{id, name, id == defaultIdentifier});
    }
  }
  if (uninitialize) {
    CoUninitialize();
  }
  return output;
}
#endif

#ifdef BAKER_LITE_WITH_WEBRTC
class ThumbnailCallback final : public webrtc::DesktopCapturer::Callback {
 public:
  void OnCaptureResult(
      webrtc::DesktopCapturer::Result result,
      std::unique_ptr<webrtc::DesktopFrame> frame) override {
    image = {};
    if (result != webrtc::DesktopCapturer::Result::SUCCESS || !frame) {
      return;
    }
    image = QImage(
                frame->data(),
                frame->size().width(),
                frame->size().height(),
                frame->stride(),
                QImage::Format_ARGB32)
                .copy()
                .scaled(
                    384,
                    216,
                    Qt::KeepAspectRatio,
                    Qt::SmoothTransformation);
  }

  QImage image;
};

void appendDesktopSources(
    QList<CaptureSourceInfo>& output,
    std::unique_ptr<webrtc::DesktopCapturer> capturer,
    CaptureKind kind) {
  if (!capturer) {
    return;
  }
  webrtc::DesktopCapturer::SourceList sources;
  if (!capturer->GetSourceList(&sources)) {
    return;
  }
  ThumbnailCallback callback;
  capturer->Start(&callback);
  int sourceIndex = 0;
  const QList<QScreen*> screens = QGuiApplication::screens();
  for (const auto& source : sources) {
    callback.image = {};
    if (capturer->SelectSource(source.id)) {
      capturer->CaptureFrame();
    }
    QString name = QString::fromUtf8(source.title).trimmed();
    if (kind == CaptureKind::Screen) {
      const QScreen* screen =
          sourceIndex < screens.size() ? screens.at(sourceIndex) : nullptr;
      const QString nativeName =
          screen != nullptr ? screen->name() : name;
      const QSize size =
          screen != nullptr ? screen->geometry().size() : QSize();
      name = QCoreApplication::translate(
                 "baker::media::MediaCatalog", "Screen %1")
                 .arg(sourceIndex + 1);
      if (!nativeName.isEmpty()) {
        name += QStringLiteral(" — %1").arg(nativeName);
      }
      if (size.isValid()) {
        name += QStringLiteral(" (%1×%2)")
                    .arg(size.width())
                    .arg(size.height());
      }
      if (screen != nullptr &&
          screen == QGuiApplication::primaryScreen()) {
        name += QStringLiteral(" — ") +
                QCoreApplication::translate(
                    "baker::media::MediaCatalog", "Primary");
      }
    } else if (name.isEmpty()) {
      name = QCoreApplication::translate(
                 "baker::media::MediaCatalog", "Window %1")
                 .arg(static_cast<qint64>(source.id));
    }
    output.append(CaptureSourceInfo{
        QString::number(static_cast<qint64>(source.id)),
        name, kind, callback.image});
    ++sourceIndex;
  }
}
#endif

}  // namespace

QList<AudioDeviceInfo> MediaCatalog::inputDevices() {
#ifdef Q_OS_WIN
  return enumerateAudio(eCapture);
#else
  return {};
#endif
}

QList<AudioDeviceInfo> MediaCatalog::outputDevices() {
#ifdef Q_OS_WIN
  return enumerateAudio(eRender);
#else
  return {};
#endif
}

QList<CaptureSourceInfo> MediaCatalog::captureSources() {
  QList<CaptureSourceInfo> output;
#ifdef BAKER_LITE_WITH_WEBRTC
  webrtc::DesktopCaptureOptions options =
      webrtc::DesktopCaptureOptions::CreateDefault();
  options.set_allow_directx_capturer(true);
#if defined(RTC_ENABLE_WIN_WGC)
  options.set_allow_wgc_screen_capturer(true);
  options.set_allow_wgc_window_capturer(true);
  options.set_allow_wgc_capturer_fallback(true);
#endif
  appendDesktopSources(
      output, webrtc::DesktopCapturer::CreateScreenCapturer(options),
      CaptureKind::Screen);
  appendDesktopSources(
      output, webrtc::DesktopCapturer::CreateWindowCapturer(options),
      CaptureKind::Window);

  std::unique_ptr<webrtc::VideoCaptureModule::DeviceInfo> deviceInfo(
      webrtc::VideoCaptureFactory::CreateDeviceInfo());
  if (deviceInfo) {
    const uint32_t count = deviceInfo->NumberOfDevices();
    for (uint32_t index = 0; index < count; ++index) {
      char name[256] = {};
      char id[256] = {};
      if (deviceInfo->GetDeviceName(index, name, sizeof(name), id,
                                    sizeof(id)) == 0) {
        output.append(CaptureSourceInfo{
            QString::fromUtf8(id), QString::fromUtf8(name),
            CaptureKind::Camera, {}});
      }
    }
  }
#else
  const QList<QScreen*> screens = QGuiApplication::screens();
  for (int index = 0; index < screens.size(); ++index) {
    output.append(CaptureSourceInfo{
        QString::number(index), screens[index]->name(),
        CaptureKind::Screen,
        screens[index]->grabWindow(0).scaled(
            320, 180, Qt::KeepAspectRatio, Qt::SmoothTransformation)
            .toImage()});
  }
#endif
  return output;
}

}  // namespace baker::media
