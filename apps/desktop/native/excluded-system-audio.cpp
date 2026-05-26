#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <avrt.h>
#include <combaseapi.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

namespace {

constexpr REFERENCE_TIME kBufferDuration = 10'000'000;
constexpr DWORD kEventTimeoutMs = 2000;

struct CoTaskMemDeleter {
  void operator()(void* pointer) const {
    CoTaskMemFree(pointer);
  }
};

class AudioInterfaceCompletionHandler final : public IActivateAudioInterfaceCompletionHandler {
 public:
  explicit AudioInterfaceCompletionHandler(HANDLE completed) : completed_(completed) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
    if (!object) {
      return E_POINTER;
    }

    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *object = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }

    *object = nullptr;
    return E_NOINTERFACE;
  }

  ULONG STDMETHODCALLTYPE AddRef() override {
    return ++references_;
  }

  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG references = --references_;
    if (references == 0) {
      delete this;
    }
    return references;
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> activated;
    HRESULT result = S_OK;
    const HRESULT hr = operation->GetActivateResult(&result, &activated);
    if (FAILED(hr)) {
      activation_result_ = hr;
    } else if (FAILED(result)) {
      activation_result_ = result;
    } else {
      activation_result_ = activated.As(&audio_client_);
    }

    SetEvent(completed_);
    return S_OK;
  }

  HRESULT activation_result() const {
    return activation_result_;
  }

  IAudioClient* audio_client() const {
    return audio_client_.Get();
  }

 private:
  std::atomic<ULONG> references_{1};
  HANDLE completed_ = nullptr;
  HRESULT activation_result_ = E_FAIL;
  ComPtr<IAudioClient> audio_client_;
};

void print_error(const char* message, HRESULT hr) {
  std::fprintf(stderr, "%s hr=0x%08lx\n", message, static_cast<unsigned long>(hr));
}

bool write_all(const void* data, size_t size) {
  const auto* cursor = static_cast<const std::uint8_t*>(data);
  while (size > 0) {
    const size_t written = std::fwrite(cursor, 1, size, stdout);
    if (written == 0) {
      return false;
    }
    cursor += written;
    size -= written;
  }
  return std::fflush(stdout) == 0;
}

bool is_float_format(const WAVEFORMATEX& format) {
  if (format.wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
    return true;
  }

  if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
    return false;
  }

  const auto& extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format);
  return extensible.SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
}

bool is_pcm_format(const WAVEFORMATEX& format) {
  if (format.wFormatTag == WAVE_FORMAT_PCM) {
    return true;
  }

  if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
    return false;
  }

  const auto& extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format);
  return extensible.SubFormat == KSDATAFORMAT_SUBTYPE_PCM;
}

float read_pcm_sample(const std::uint8_t* data, WORD bits_per_sample) {
  switch (bits_per_sample) {
    case 8:
      return (static_cast<int>(*data) - 128) / 128.0f;
    case 16: {
      std::int16_t sample = 0;
      std::memcpy(&sample, data, sizeof(sample));
      return std::clamp(sample / 32768.0f, -1.0f, 1.0f);
    }
    case 24: {
      std::int32_t sample =
          (static_cast<std::int32_t>(data[0])) |
          (static_cast<std::int32_t>(data[1]) << 8) |
          (static_cast<std::int32_t>(data[2]) << 16);
      if (sample & 0x00800000) {
        sample |= static_cast<std::int32_t>(0xff000000);
      }
      return std::clamp(sample / 8388608.0f, -1.0f, 1.0f);
    }
    case 32: {
      std::int32_t sample = 0;
      std::memcpy(&sample, data, sizeof(sample));
      return std::clamp(sample / 2147483648.0f, -1.0f, 1.0f);
    }
    default:
      return 0.0f;
  }
}

bool convert_to_float32(
    const BYTE* data,
    UINT32 frames,
    const WAVEFORMATEX& format,
    bool silent,
    std::vector<float>& output) {
  const UINT32 channels = format.nChannels;
  output.assign(static_cast<size_t>(frames) * channels, 0.0f);

  if (silent || frames == 0) {
    return true;
  }

  if (is_float_format(format) && format.wBitsPerSample == 32) {
    std::memcpy(output.data(), data, output.size() * sizeof(float));
    return true;
  }

  if (!is_pcm_format(format)) {
    return false;
  }

  const WORD bytes_per_sample = format.wBitsPerSample / 8;
  if (bytes_per_sample == 0 || format.nBlockAlign == 0) {
    return false;
  }

  for (UINT32 frame = 0; frame < frames; frame += 1) {
    const BYTE* frame_data = data + static_cast<size_t>(frame) * format.nBlockAlign;
    for (UINT32 channel = 0; channel < channels; channel += 1) {
      output[static_cast<size_t>(frame) * channels + channel] =
          read_pcm_sample(frame_data + static_cast<size_t>(channel) * bytes_per_sample, format.wBitsPerSample);
    }
  }

  return true;
}

HRESULT activate_process_loopback_client(DWORD target_process_id, IAudioClient** audio_client) {
  AUDIOCLIENT_ACTIVATION_PARAMS activation_params = {};
  activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activation_params.ProcessLoopbackParams.TargetProcessId = target_process_id;
  activation_params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activate_params = {};
  activate_params.vt = VT_BLOB;
  activate_params.blob.cbSize = sizeof(activation_params);
  activate_params.blob.pBlobData = reinterpret_cast<BYTE*>(&activation_params);

  HANDLE completed = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!completed) {
    return HRESULT_FROM_WIN32(GetLastError());
  }

  auto* completion_handler = new AudioInterfaceCompletionHandler(completed);
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  const HRESULT activate_hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activate_params,
      completion_handler,
      &operation);
  if (FAILED(activate_hr)) {
    completion_handler->Release();
    CloseHandle(completed);
    return activate_hr;
  }

  WaitForSingleObject(completed, INFINITE);
  const HRESULT result = completion_handler->activation_result();
  if (SUCCEEDED(result)) {
    completion_handler->audio_client()->AddRef();
    *audio_client = completion_handler->audio_client();
  }

  completion_handler->Release();
  CloseHandle(completed);
  return result;
}

int run_capture(DWORD target_process_id) {
  ComPtr<IAudioClient> audio_client;
  HRESULT hr = activate_process_loopback_client(target_process_id, &audio_client);
  if (FAILED(hr)) {
    print_error("Process loopback activation failed.", hr);
    return 2;
  }

  WAVEFORMATEX* raw_format = nullptr;
  hr = audio_client->GetMixFormat(&raw_format);
  if (FAILED(hr)) {
    print_error("GetMixFormat failed.", hr);
    return 3;
  }
  std::unique_ptr<WAVEFORMATEX, CoTaskMemDeleter> format(raw_format);

  hr = audio_client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      kBufferDuration,
      0,
      format.get(),
      nullptr);
  if (FAILED(hr)) {
    print_error("Audio client initialization failed.", hr);
    return 4;
  }

  HANDLE samples_ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!samples_ready) {
    print_error("CreateEvent failed.", HRESULT_FROM_WIN32(GetLastError()));
    return 5;
  }

  hr = audio_client->SetEventHandle(samples_ready);
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    print_error("SetEventHandle failed.", hr);
    return 6;
  }

  ComPtr<IAudioCaptureClient> capture_client;
  hr = audio_client->GetService(__uuidof(IAudioCaptureClient), &capture_client);
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    print_error("GetService(IAudioCaptureClient) failed.", hr);
    return 7;
  }

  std::printf(
      "{\"format\":\"f32le\",\"sampleRate\":%lu,\"channelCount\":%u}\n",
      static_cast<unsigned long>(format->nSamplesPerSec),
      static_cast<unsigned int>(format->nChannels));
  std::fflush(stdout);

  DWORD task_index = 0;
  HANDLE avrt_handle = AvSetMmThreadCharacteristicsW(L"Audio", &task_index);
  hr = audio_client->Start();
  if (FAILED(hr)) {
    if (avrt_handle) {
      AvRevertMmThreadCharacteristics(avrt_handle);
    }
    CloseHandle(samples_ready);
    print_error("Audio client start failed.", hr);
    return 8;
  }

  std::vector<float> converted;
  bool running = true;
  while (running) {
    const DWORD wait_result = WaitForSingleObject(samples_ready, kEventTimeoutMs);
    if (wait_result == WAIT_FAILED) {
      print_error("WaitForSingleObject failed.", HRESULT_FROM_WIN32(GetLastError()));
      break;
    }

    UINT32 packet_size = 0;
    hr = capture_client->GetNextPacketSize(&packet_size);
    if (FAILED(hr)) {
      print_error("GetNextPacketSize failed.", hr);
      break;
    }

    while (packet_size > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        print_error("GetBuffer failed.", hr);
        running = false;
        break;
      }

      const bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
      if (!convert_to_float32(data, frames, *format, silent, converted)) {
        std::fprintf(stderr, "Unsupported capture format: tag=%u bits=%u channels=%u\n",
                     format->wFormatTag,
                     format->wBitsPerSample,
                     format->nChannels);
        capture_client->ReleaseBuffer(frames);
        running = false;
        break;
      }

      if (!converted.empty() && !write_all(converted.data(), converted.size() * sizeof(float))) {
        running = false;
        break;
      }

      hr = capture_client->ReleaseBuffer(frames);
      if (FAILED(hr)) {
        print_error("ReleaseBuffer failed.", hr);
        running = false;
        break;
      }

      hr = capture_client->GetNextPacketSize(&packet_size);
      if (FAILED(hr)) {
        print_error("GetNextPacketSize failed.", hr);
        running = false;
        break;
      }
    }
  }

  audio_client->Stop();
  if (avrt_handle) {
    AvRevertMmThreadCharacteristics(avrt_handle);
  }
  CloseHandle(samples_ready);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Usage: excluded-system-audio.exe <target-process-id>\n");
    return 1;
  }

  char* end = nullptr;
  const unsigned long pid = std::strtoul(argv[1], &end, 10);
  if (!end || *end != '\0' || pid == 0 || pid > 0xffffffffUL) {
    std::fprintf(stderr, "Invalid target process id.\n");
    return 1;
  }

  const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    print_error("CoInitializeEx failed.", hr);
    return 1;
  }

  const int result = run_capture(static_cast<DWORD>(pid));
  CoUninitialize();
  return result;
}
