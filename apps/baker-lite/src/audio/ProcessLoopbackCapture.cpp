#include "ProcessLoopbackCapture.hpp"

#include <QMetaObject>
#include <QOperatingSystemVersion>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <vector>

#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <combaseapi.h>
#include <endpointvolume.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <windows.h>
#include <tlhelp32.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#endif

namespace baker::audio {
namespace {

#ifdef Q_OS_WIN
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

constexpr REFERENCE_TIME kBufferDuration = 10'000'000;
constexpr DWORD kWaitSliceMs = 80;

struct CoTaskMemDeleter {
  void operator()(void* pointer) const { CoTaskMemFree(pointer); }
};

class ActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  explicit ActivationHandler(HANDLE completed) : completed_(completed) {}

  HRESULT STDMETHODCALLTYPE ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> activated;
    HRESULT activationResult = E_FAIL;
    const HRESULT operationResult =
        operation->GetActivateResult(&activationResult, &activated);
    if (FAILED(operationResult)) {
      result_ = operationResult;
    } else if (FAILED(activationResult)) {
      result_ = activationResult;
    } else {
      result_ = activated.As(&client_);
    }
    SetEvent(completed_);
    return S_OK;
  }

  [[nodiscard]] HRESULT result() const noexcept { return result_; }
  [[nodiscard]] IAudioClient* client() const noexcept { return client_.Get(); }

 private:
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_FAIL;
  ComPtr<IAudioClient> client_;
};

QString hresultMessage(const QString& context, HRESULT result) {
  return QStringLiteral("%1 (HRESULT 0x%2)")
      .arg(context)
      .arg(static_cast<qulonglong>(static_cast<unsigned long>(result)), 8, 16,
           QLatin1Char('0'));
}

HRESULT activateProcessLoopback(quint32 processId,
                                ProcessLoopbackCapture::Mode mode,
                                IAudioClient** output) {
  if (output == nullptr) {
    return E_POINTER;
  }
  *output = nullptr;

  AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = processId;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode =
      mode == ProcessLoopbackCapture::Mode::IncludeProcessTree
          ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
          : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT property{};
  property.vt = VT_BLOB;
  property.blob.cbSize = sizeof(parameters);
  property.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);

  const HANDLE completed = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (completed == nullptr) {
    return HRESULT_FROM_WIN32(GetLastError());
  }

  ComPtr<ActivationHandler> handler =
      Microsoft::WRL::Make<ActivationHandler>(completed);
  if (!handler) {
    CloseHandle(completed);
    return E_OUTOFMEMORY;
  }

  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  const HRESULT activation = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &property,
      handler.Get(), &operation);
  if (FAILED(activation)) {
    CloseHandle(completed);
    return activation;
  }

  const DWORD waitResult = WaitForSingleObject(completed, 10'000);
  CloseHandle(completed);
  if (waitResult != WAIT_OBJECT_0) {
    return waitResult == WAIT_TIMEOUT ? HRESULT_FROM_WIN32(ERROR_TIMEOUT)
                                     : HRESULT_FROM_WIN32(GetLastError());
  }

  if (SUCCEEDED(handler->result()) && handler->client() != nullptr) {
    handler->client()->AddRef();
    *output = handler->client();
  }
  return handler->result();
}

HRESULT defaultRenderFormat(WAVEFORMATEX** format) {
  if (format == nullptr) {
    return E_POINTER;
  }
  *format = nullptr;
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                                    CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(result)) {
    return result;
  }
  ComPtr<IMMDevice> device;
  result = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(result)) {
    return result;
  }
  ComPtr<IAudioClient> client;
  result =
      device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
  return FAILED(result) ? result : client->GetMixFormat(format);
}

bool isFloatFormat(const WAVEFORMATEX& format) {
  if (format.wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
    return true;
  }
  if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
    return false;
  }
  return reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format).SubFormat ==
         KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
}

bool isPcmFormat(const WAVEFORMATEX& format) {
  if (format.wFormatTag == WAVE_FORMAT_PCM) {
    return true;
  }
  if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
    return false;
  }
  return reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format).SubFormat ==
         KSDATAFORMAT_SUBTYPE_PCM;
}

float pcmSample(const BYTE* data, WORD bits) {
  switch (bits) {
    case 8:
      return (static_cast<int>(*data) - 128) / 128.0F;
    case 16: {
      std::int16_t sample = 0;
      std::memcpy(&sample, data, sizeof(sample));
      return std::clamp(sample / 32768.0F, -1.0F, 1.0F);
    }
    case 24: {
      std::int32_t sample = static_cast<std::int32_t>(data[0]) |
                            (static_cast<std::int32_t>(data[1]) << 8) |
                            (static_cast<std::int32_t>(data[2]) << 16);
      if ((sample & 0x00800000) != 0) {
        sample |= static_cast<std::int32_t>(0xff000000);
      }
      return std::clamp(sample / 8388608.0F, -1.0F, 1.0F);
    }
    case 32: {
      std::int32_t sample = 0;
      std::memcpy(&sample, data, sizeof(sample));
      return std::clamp(sample / 2147483648.0F, -1.0F, 1.0F);
    }
    default:
      return 0.0F;
  }
}

bool toFloat32(const BYTE* data, UINT32 frames, const WAVEFORMATEX& format,
               bool silent, std::vector<float>& output) {
  output.assign(static_cast<std::size_t>(frames) * format.nChannels, 0.0F);
  if (silent || frames == 0) {
    return true;
  }
  if (isFloatFormat(format) && format.wBitsPerSample == 32) {
    std::memcpy(output.data(), data, output.size() * sizeof(float));
    return true;
  }
  if (!isPcmFormat(format) || format.wBitsPerSample % 8 != 0 ||
      format.nBlockAlign == 0) {
    return false;
  }
  const WORD bytesPerSample = format.wBitsPerSample / 8;
  for (UINT32 frame = 0; frame < frames; ++frame) {
    const BYTE* frameData =
        data + static_cast<std::size_t>(frame) * format.nBlockAlign;
    for (UINT32 channel = 0; channel < format.nChannels; ++channel) {
      output[static_cast<std::size_t>(frame) * format.nChannels + channel] =
          pcmSample(frameData + static_cast<std::size_t>(channel) *
                                    bytesPerSample,
                    format.wBitsPerSample);
    }
  }
  return true;
}

BOOL CALLBACK enumerateWindowsCallback(HWND window, LPARAM parameter) {
  auto* output = reinterpret_cast<QList<WindowAudioSource>*>(parameter);
  if (!IsWindowVisible(window) || GetAncestor(window, GA_ROOT) != window) {
    return TRUE;
  }
  const int length = GetWindowTextLengthW(window);
  if (length <= 0) {
    return TRUE;
  }
  std::wstring title(static_cast<std::size_t>(length + 1), L'\0');
  const int copied = GetWindowTextW(window, title.data(), length + 1);
  if (copied <= 0) {
    return TRUE;
  }
  title.resize(static_cast<std::size_t>(copied));
  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  if (processId != 0) {
    output->append(WindowAudioSource{
        reinterpret_cast<quintptr>(window), static_cast<quint32>(processId),
        QString::fromStdWString(title)});
  }
  return TRUE;
}

struct CaptureClient {
  ComPtr<IAudioClient> audioClient;
  ComPtr<IAudioCaptureClient> captureClient;
  std::unique_ptr<WAVEFORMATEX, CoTaskMemDeleter> format;
  HANDLE samplesReady = nullptr;

  ~CaptureClient() {
    if (audioClient) {
      audioClient->Stop();
    }
    if (samplesReady != nullptr) {
      CloseHandle(samplesReady);
    }
  }
};

HRESULT prepareCapture(quint32 processId, ProcessLoopbackCapture::Mode mode,
                       CaptureClient& capture) {
  HRESULT result =
      activateProcessLoopback(processId, mode, &capture.audioClient);
  if (FAILED(result)) {
    return result;
  }
  WAVEFORMATEX* rawFormat = nullptr;
  result = capture.audioClient->GetMixFormat(&rawFormat);
  if (FAILED(result)) {
    result = defaultRenderFormat(&rawFormat);
  }
  if (FAILED(result)) {
    return result;
  }
  capture.format.reset(rawFormat);
  result = capture.audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      kBufferDuration, 0, capture.format.get(), nullptr);
  if (FAILED(result)) {
    return result;
  }
  capture.samplesReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (capture.samplesReady == nullptr) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  result = capture.audioClient->SetEventHandle(capture.samplesReady);
  if (FAILED(result)) {
    return result;
  }
  return capture.audioClient->GetService(__uuidof(IAudioCaptureClient),
                                         &capture.captureClient);
}
#endif

}  // namespace

ProcessLoopbackCapture::ProcessLoopbackCapture(QObject* parent)
    : QObject(parent) {}

ProcessLoopbackCapture::~ProcessLoopbackCapture() { stop(); }

bool ProcessLoopbackCapture::isRunning() const noexcept {
  return running_.load(std::memory_order_acquire);
}

bool ProcessLoopbackCapture::start(quint32 processId, Mode mode) {
  if (processId == 0 || running_.exchange(true, std::memory_order_acq_rel)) {
    return false;
  }
  worker_ = std::jthread(
      [this, processId, mode](std::stop_token token) {
        run(token, processId, mode);
      });
  return true;
}

void ProcessLoopbackCapture::stop() {
  if (worker_.joinable()) {
    worker_.request_stop();
    worker_.join();
  }
}

bool ProcessLoopbackCapture::isSupported() noexcept {
#ifdef Q_OS_WIN
  return QOperatingSystemVersion::current() >=
         QOperatingSystemVersion(QOperatingSystemVersion::Windows, 10, 0,
                                 20348);
#else
  return false;
#endif
}

QList<WindowAudioSource> ProcessLoopbackCapture::enumerateWindowSources() {
  QList<WindowAudioSource> sources;
#ifdef Q_OS_WIN
  EnumWindows(enumerateWindowsCallback, reinterpret_cast<LPARAM>(&sources));
  std::sort(sources.begin(), sources.end(),
            [](const WindowAudioSource& left,
               const WindowAudioSource& right) {
              return left.title.localeAwareCompare(right.title) < 0;
            });
#endif
  return sources;
}

QHash<quint32, float> ProcessLoopbackCapture::measureActivePeaks(
    const QList<quint32>& processIds) {
  QHash<quint32, float> peaks;
  for (const quint32 processId : processIds) {
    if (processId != 0) {
      peaks.insert(processId, 0.0F);
    }
  }
#ifdef Q_OS_WIN
  if (peaks.isEmpty()) {
    return peaks;
  }

  const HRESULT comResult =
      CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(comResult);
  if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
    return peaks;
  }

  QHash<DWORD, DWORD> parentByProcess;
  const HANDLE snapshot =
      CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot != INVALID_HANDLE_VALUE) {
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) {
      do {
        parentByProcess.insert(
            entry.th32ProcessID, entry.th32ParentProcessID);
      } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
  }

  ComPtr<IMMDeviceEnumerator> deviceEnumerator;
  ComPtr<IMMDevice> outputDevice;
  ComPtr<IAudioSessionManager2> sessionManager;
  ComPtr<IAudioSessionEnumerator> sessionEnumerator;
  HRESULT result = CoCreateInstance(
      __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
      IID_PPV_ARGS(&deviceEnumerator));
  if (SUCCEEDED(result)) {
    result = deviceEnumerator->GetDefaultAudioEndpoint(
        eRender, eConsole, &outputDevice);
  }
  if (SUCCEEDED(result)) {
    result = outputDevice->Activate(
        __uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
        reinterpret_cast<void**>(sessionManager.GetAddressOf()));
  }
  if (SUCCEEDED(result)) {
    result = sessionManager->GetSessionEnumerator(&sessionEnumerator);
  }
  if (SUCCEEDED(result)) {
    int sessionCount = 0;
    sessionEnumerator->GetCount(&sessionCount);
    for (int index = 0; index < sessionCount; ++index) {
      ComPtr<IAudioSessionControl> control;
      ComPtr<IAudioSessionControl2> control2;
      ComPtr<IAudioMeterInformation> meter;
      DWORD sessionProcessId = 0;
      float peak = 0.0F;
      if (FAILED(sessionEnumerator->GetSession(index, &control)) ||
          FAILED(control.As(&control2)) ||
          FAILED(control2->GetProcessId(&sessionProcessId)) ||
          sessionProcessId == 0 ||
          FAILED(control.As(&meter)) ||
          FAILED(meter->GetPeakValue(&peak))) {
        continue;
      }

      DWORD candidate = sessionProcessId;
      for (int depth = 0; candidate != 0 && depth < 64; ++depth) {
        auto source = peaks.find(candidate);
        if (source != peaks.end()) {
          source.value() =
              std::max(source.value(), std::clamp(peak, 0.0F, 1.0F));
          break;
        }
        const DWORD parent = parentByProcess.value(candidate, 0);
        if (parent == candidate) {
          break;
        }
        candidate = parent;
      }
    }
  }
  if (shouldUninitialize) {
    CoUninitialize();
  }
#else
  Q_UNUSED(processIds)
#endif
  return peaks;
}

float ProcessLoopbackCapture::measurePeak(quint32 processId, int durationMs) {
#ifdef Q_OS_WIN
  if (processId == 0 || durationMs <= 0) {
    return 0.0F;
  }
  const HRESULT comResult =
      CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(comResult);
  CaptureClient capture;
  const HRESULT result = prepareCapture(
      processId, Mode::IncludeProcessTree, capture);
  if (FAILED(result) || FAILED(capture.audioClient->Start())) {
    if (shouldUninitialize) {
      CoUninitialize();
    }
    return 0.0F;
  }

  const ULONGLONG started = GetTickCount64();
  std::vector<float> converted;
  float peak = 0.0F;
  while (GetTickCount64() - started <
         static_cast<ULONGLONG>(durationMs)) {
    if (WaitForSingleObject(capture.samplesReady, kWaitSliceMs) !=
        WAIT_OBJECT_0) {
      continue;
    }
    UINT32 packetSize = 0;
    if (FAILED(capture.captureClient->GetNextPacketSize(&packetSize))) {
      break;
    }
    while (packetSize > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture.captureClient->GetBuffer(&data, &frames, &flags,
                                                  nullptr, nullptr))) {
        packetSize = 0;
        break;
      }
      if (toFloat32(data, frames, *capture.format,
                    (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0, converted)) {
        for (const float sample : converted) {
          peak = std::max(peak, std::abs(sample));
        }
      }
      capture.captureClient->ReleaseBuffer(frames);
      if (FAILED(capture.captureClient->GetNextPacketSize(&packetSize))) {
        break;
      }
    }
  }
  capture.audioClient->Stop();
  if (shouldUninitialize) {
    CoUninitialize();
  }
  return std::clamp(peak, 0.0F, 1.0F);
#else
  Q_UNUSED(processId)
  Q_UNUSED(durationMs)
  return 0.0F;
#endif
}

void ProcessLoopbackCapture::run(std::stop_token stopToken, quint32 processId,
                                 Mode mode) {
#ifdef Q_OS_WIN
  const HRESULT comResult =
      CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(comResult);
  if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
    postError(hresultMessage(QStringLiteral("COM initialization failed"),
                             comResult));
    running_.store(false, std::memory_order_release);
    return;
  }

  CaptureClient capture;
  HRESULT result = prepareCapture(processId, mode, capture);
  if (FAILED(result)) {
    postError(hresultMessage(
        QStringLiteral("Windows process-loopback initialization failed"),
        result));
    if (shouldUninitialize) {
      CoUninitialize();
    }
    running_.store(false, std::memory_order_release);
    return;
  }

  QMetaObject::invokeMethod(
      this,
      [this, rate = static_cast<int>(capture.format->nSamplesPerSec),
       channels = static_cast<int>(capture.format->nChannels)] {
        emit formatReady(rate, channels);
      },
      Qt::QueuedConnection);

  DWORD taskIndex = 0;
  const HANDLE avrt =
      AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);
  result = capture.audioClient->Start();
  if (FAILED(result)) {
    postError(hresultMessage(QStringLiteral("Loopback capture start failed"),
                             result));
  } else {
    std::vector<float> converted;
    while (!stopToken.stop_requested()) {
      const DWORD waitResult =
          WaitForSingleObject(capture.samplesReady, kWaitSliceMs);
      if (waitResult == WAIT_TIMEOUT) {
        continue;
      }
      if (waitResult != WAIT_OBJECT_0) {
        postError(QStringLiteral("Loopback capture wait failed"));
        break;
      }

      UINT32 packetSize = 0;
      if (FAILED(capture.captureClient->GetNextPacketSize(&packetSize))) {
        postError(QStringLiteral("Unable to read loopback packet size"));
        break;
      }
      while (packetSize > 0 && !stopToken.stop_requested()) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        result = capture.captureClient->GetBuffer(&data, &frames, &flags,
                                                  nullptr, nullptr);
        if (FAILED(result)) {
          postError(
              hresultMessage(QStringLiteral("Loopback read failed"), result));
          break;
        }
        const bool convertedOk =
            toFloat32(data, frames, *capture.format,
                      (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0, converted);
        capture.captureClient->ReleaseBuffer(frames);
        if (!convertedOk) {
          postError(QStringLiteral("Unsupported Windows loopback format"));
          break;
        }
        if (!converted.empty()) {
          QByteArray bytes(
              reinterpret_cast<const char*>(converted.data()),
              static_cast<qsizetype>(converted.size() * sizeof(float)));
          QMetaObject::invokeMethod(
              this,
              [this, bytes = std::move(bytes)] {
                emit samplesReady(bytes);
              },
              Qt::QueuedConnection);
        }
        if (FAILED(
                capture.captureClient->GetNextPacketSize(&packetSize))) {
          packetSize = 0;
        }
      }
    }
  }

  capture.audioClient->Stop();
  if (avrt != nullptr) {
    AvRevertMmThreadCharacteristics(avrt);
  }
  if (shouldUninitialize) {
    CoUninitialize();
  }
#else
  Q_UNUSED(stopToken)
  Q_UNUSED(processId)
  Q_UNUSED(mode)
  postError(QStringLiteral("Process loopback is only available on Windows"));
#endif
  running_.store(false, std::memory_order_release);
  QMetaObject::invokeMethod(this, [this] { emit stopped(); },
                            Qt::QueuedConnection);
}

void ProcessLoopbackCapture::postError(const QString& message) {
  QMetaObject::invokeMethod(
      this, [this, message] { emit errorOccurred(message); },
      Qt::QueuedConnection);
}

}  // namespace baker::audio
