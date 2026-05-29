#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <combaseapi.h>
#include <endpointvolume.h>
#include <fcntl.h>
#include <io.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <tlhelp32.h>
#include <windows.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string_view>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr REFERENCE_TIME kBufferDuration = 10'000'000;
constexpr DWORD kEventTimeoutMs = 2000;

enum class CaptureMode {
  IncludeTargetProcessTree,
  ExcludeTargetProcessTree,
};

struct WindowInfo {
  HWND handle = nullptr;
  DWORD process_id = 0;
  std::wstring title;
};

struct CoTaskMemDeleter {
  void operator()(void* pointer) const {
    CoTaskMemFree(pointer);
  }
};

class AudioInterfaceCompletionHandler final
    : public RuntimeClass<
          RuntimeClassFlags<ClassicCom>,
          FtmBase,
          IActivateAudioInterfaceCompletionHandler> {
 public:
  explicit AudioInterfaceCompletionHandler(HANDLE completed) : completed_(completed) {}

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
  HANDLE completed_ = nullptr;
  HRESULT activation_result_ = E_FAIL;
  ComPtr<IAudioClient> audio_client_;
};

void print_error(const char* message, HRESULT hr) {
  std::fprintf(stderr, "%s hr=0x%08lx\n", message, static_cast<unsigned long>(hr));
}

std::string wide_to_utf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }

  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) {
    return {};
  }

  std::string output(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), size, nullptr, nullptr);
  return output;
}

std::string json_escape(std::string_view value) {
  std::string output;
  output.reserve(value.size() + 8);
  for (const char c : value) {
    switch (c) {
      case '\\':
        output += "\\\\";
        break;
      case '"':
        output += "\\\"";
        break;
      case '\b':
        output += "\\b";
        break;
      case '\f':
        output += "\\f";
        break;
      case '\n':
        output += "\\n";
        break;
      case '\r':
        output += "\\r";
        break;
      case '\t':
        output += "\\t";
        break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buffer[7] = {};
          std::snprintf(buffer, sizeof(buffer), "\\u%04x", static_cast<unsigned char>(c));
          output += buffer;
        } else {
          output += c;
        }
        break;
    }
  }
  return output;
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

HRESULT activate_process_loopback_client(DWORD target_process_id, CaptureMode mode, IAudioClient** audio_client) {
  AUDIOCLIENT_ACTIVATION_PARAMS activation_params = {};
  activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activation_params.ProcessLoopbackParams.TargetProcessId = target_process_id;
  activation_params.ProcessLoopbackParams.ProcessLoopbackMode =
      mode == CaptureMode::IncludeTargetProcessTree
          ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
          : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activate_params = {};
  activate_params.vt = VT_BLOB;
  activate_params.blob.cbSize = sizeof(activation_params);
  activate_params.blob.pBlobData = reinterpret_cast<BYTE*>(&activation_params);

  HANDLE completed = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!completed) {
    return HRESULT_FROM_WIN32(GetLastError());
  }

  ComPtr<AudioInterfaceCompletionHandler> completion_handler =
      Microsoft::WRL::Make<AudioInterfaceCompletionHandler>(completed);
  if (!completion_handler) {
    CloseHandle(completed);
    return E_OUTOFMEMORY;
  }

  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  const HRESULT activate_hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activate_params,
      completion_handler.Get(),
      &operation);
  if (FAILED(activate_hr)) {
    CloseHandle(completed);
    return activate_hr;
  }

  WaitForSingleObject(completed, INFINITE);
  const HRESULT result = completion_handler->activation_result();
  if (SUCCEEDED(result)) {
    completion_handler->audio_client()->AddRef();
    *audio_client = completion_handler->audio_client();
  }

  CloseHandle(completed);
  return result;
}

HRESULT get_default_render_mix_format(WAVEFORMATEX** format) {
  if (!format) {
    return E_POINTER;
  }

  *format = nullptr;
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    return hr;
  }

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) {
    return hr;
  }

  ComPtr<IAudioClient> endpoint_audio_client;
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &endpoint_audio_client);
  if (FAILED(hr)) {
    return hr;
  }

  return endpoint_audio_client->GetMixFormat(format);
}

int run_capture(DWORD target_process_id, CaptureMode mode) {
  ComPtr<IAudioClient> audio_client;
  HRESULT hr = activate_process_loopback_client(target_process_id, mode, &audio_client);
  if (FAILED(hr)) {
    print_error("Process loopback activation failed.", hr);
    return 2;
  }

  WAVEFORMATEX* raw_format = nullptr;
  hr = audio_client->GetMixFormat(&raw_format);
  if (FAILED(hr)) {
    const HRESULT fallback_hr = get_default_render_mix_format(&raw_format);
    if (FAILED(fallback_hr)) {
      print_error("GetMixFormat failed.", hr);
      print_error("Default endpoint GetMixFormat failed.", fallback_hr);
      return 3;
    }
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

float measure_process_peak(DWORD target_process_id, DWORD duration_ms) {
  ComPtr<IAudioClient> audio_client;
  HRESULT hr = activate_process_loopback_client(
      target_process_id,
      CaptureMode::IncludeTargetProcessTree,
      &audio_client);
  if (FAILED(hr)) {
    return 0.0f;
  }

  WAVEFORMATEX* raw_format = nullptr;
  hr = audio_client->GetMixFormat(&raw_format);
  if (FAILED(hr)) {
    hr = get_default_render_mix_format(&raw_format);
    if (FAILED(hr)) {
      return 0.0f;
    }
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
    return 0.0f;
  }

  HANDLE samples_ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!samples_ready) {
    return 0.0f;
  }

  hr = audio_client->SetEventHandle(samples_ready);
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    return 0.0f;
  }

  ComPtr<IAudioCaptureClient> capture_client;
  hr = audio_client->GetService(__uuidof(IAudioCaptureClient), &capture_client);
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    return 0.0f;
  }

  hr = audio_client->Start();
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    return 0.0f;
  }

  std::vector<float> converted;
  float peak = 0.0f;
  const ULONGLONG started_at = GetTickCount64();
  while (GetTickCount64() - started_at < duration_ms) {
    const ULONGLONG elapsed = GetTickCount64() - started_at;
    const DWORD remaining = elapsed >= duration_ms
        ? 0
        : static_cast<DWORD>(duration_ms - elapsed);
    const DWORD wait_result = WaitForSingleObject(samples_ready, std::min<DWORD>(remaining, 80));
    if (wait_result == WAIT_TIMEOUT) {
      continue;
    }
    if (wait_result == WAIT_FAILED) {
      break;
    }

    UINT32 packet_size = 0;
    hr = capture_client->GetNextPacketSize(&packet_size);
    if (FAILED(hr)) {
      break;
    }

    while (packet_size > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        packet_size = 0;
        break;
      }

      const bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
      if (convert_to_float32(data, frames, *format, silent, converted)) {
        for (const float sample : converted) {
          peak = std::max(peak, std::abs(sample));
        }
      }

      capture_client->ReleaseBuffer(frames);
      hr = capture_client->GetNextPacketSize(&packet_size);
      if (FAILED(hr)) {
        break;
      }
    }
  }

  audio_client->Stop();
  CloseHandle(samples_ready);
  return std::clamp(peak, 0.0f, 1.0f);
}

BOOL CALLBACK enum_windows_proc(HWND window, LPARAM parameter) {
  auto* windows = reinterpret_cast<std::vector<WindowInfo>*>(parameter);
  if (!IsWindowVisible(window) || GetAncestor(window, GA_ROOT) != window) {
    return TRUE;
  }

  const int title_length = GetWindowTextLengthW(window);
  if (title_length <= 0) {
    return TRUE;
  }

  std::wstring title(static_cast<size_t>(title_length + 1), L'\0');
  const int copied = GetWindowTextW(window, title.data(), title_length + 1);
  if (copied <= 0) {
    return TRUE;
  }
  title.resize(static_cast<size_t>(copied));

  DWORD process_id = 0;
  GetWindowThreadProcessId(window, &process_id);
  if (process_id == 0) {
    return TRUE;
  }

  windows->push_back({window, process_id, title});
  return TRUE;
}

int list_windows() {
  std::vector<WindowInfo> windows;
  EnumWindows(enum_windows_proc, reinterpret_cast<LPARAM>(&windows));

  std::printf("[");
  bool first = true;
  for (const auto& window : windows) {
    if (!first) {
      std::printf(",");
    }
    first = false;
    const auto title = json_escape(wide_to_utf8(window.title));
    std::printf(
        "{\"id\":\"%p\",\"processId\":%lu,\"title\":\"%s\"}",
        window.handle,
        static_cast<unsigned long>(window.process_id),
        title.c_str());
  }
  std::printf("]\n");
  return 0;
}

std::unordered_set<DWORD> collect_process_tree(DWORD root_process_id) {
  std::unordered_map<DWORD, DWORD> parent_by_pid;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return {root_process_id};
  }

  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      parent_by_pid[entry.th32ProcessID] = entry.th32ParentProcessID;
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  std::unordered_set<DWORD> tree{root_process_id};
  bool changed = true;
  while (changed) {
    changed = false;
    for (const auto& [pid, parent] : parent_by_pid) {
      if (tree.count(pid) == 0 && tree.count(parent) > 0) {
        tree.insert(pid);
        changed = true;
      }
    }
  }

  return tree;
}

int meter_once(const std::vector<DWORD>& root_process_ids) {
  std::unordered_map<DWORD, std::unordered_set<DWORD>> trees;
  std::unordered_map<DWORD, float> peaks;
  for (const DWORD root : root_process_ids) {
    trees[root] = collect_process_tree(root);
    peaks[root] = 0.0f;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    print_error("Create MMDeviceEnumerator failed.", hr);
    return 9;
  }

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) {
    print_error("GetDefaultAudioEndpoint failed.", hr);
    return 10;
  }

  ComPtr<IAudioSessionManager2> manager;
  hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, &manager);
  if (FAILED(hr)) {
    print_error("Activate IAudioSessionManager2 failed.", hr);
    return 11;
  }

  ComPtr<IAudioSessionEnumerator> sessions;
  hr = manager->GetSessionEnumerator(&sessions);
  if (FAILED(hr)) {
    print_error("GetSessionEnumerator failed.", hr);
    return 12;
  }

  int count = 0;
  hr = sessions->GetCount(&count);
  if (FAILED(hr)) {
    print_error("Get session count failed.", hr);
    return 13;
  }

  for (int index = 0; index < count; index += 1) {
    ComPtr<IAudioSessionControl> session;
    if (FAILED(sessions->GetSession(index, &session)) || !session) {
      continue;
    }

    ComPtr<IAudioSessionControl2> session2;
    if (FAILED(session.As(&session2)) || !session2) {
      continue;
    }

    DWORD process_id = 0;
    if (FAILED(session2->GetProcessId(&process_id)) || process_id == 0) {
      continue;
    }

    ComPtr<IAudioMeterInformation> meter;
    if (FAILED(session.As(&meter)) || !meter) {
      continue;
    }

    float peak = 0.0f;
    if (FAILED(meter->GetPeakValue(&peak))) {
      continue;
    }

    for (const auto& [root, tree] : trees) {
      if (tree.count(process_id) > 0) {
        peaks[root] = std::max(peaks[root], peak);
      }
    }
  }

  for (const DWORD root : root_process_ids) {
    if (peaks[root] <= 0.0001f) {
      peaks[root] = measure_process_peak(root, 180);
    }
  }

  std::printf("{");
  bool first = true;
  for (const DWORD root : root_process_ids) {
    if (!first) {
      std::printf(",");
    }
    first = false;
    std::printf("\"%lu\":%.4f", static_cast<unsigned long>(root), static_cast<double>(peaks[root]));
  }
  std::printf("}\n");
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  _setmode(_fileno(stdout), _O_BINARY);

  if (argc >= 2 && std::strcmp(argv[1], "--list-windows") == 0) {
    return list_windows();
  }

  if (argc >= 3 && std::strcmp(argv[1], "--meter-once") == 0) {
    std::vector<DWORD> process_ids;
    for (int index = 2; index < argc; index += 1) {
      char* end = nullptr;
      const unsigned long pid = std::strtoul(argv[index], &end, 10);
      if (!end || *end != '\0' || pid == 0 || pid > 0xffffffffUL) {
        std::fprintf(stderr, "Invalid process id.\n");
        return 1;
      }
      process_ids.push_back(static_cast<DWORD>(pid));
    }

    const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) {
      print_error("CoInitializeEx failed.", hr);
      return 1;
    }
    const int result = meter_once(process_ids);
    CoUninitialize();
    return result;
  }

  CaptureMode mode = CaptureMode::ExcludeTargetProcessTree;
  const char* pid_argument = nullptr;
  if (argc == 2) {
    pid_argument = argv[1];
  } else if (argc == 4 && std::strcmp(argv[1], "--capture") == 0) {
    if (std::strcmp(argv[2], "include") == 0) {
      mode = CaptureMode::IncludeTargetProcessTree;
    } else if (std::strcmp(argv[2], "exclude") == 0) {
      mode = CaptureMode::ExcludeTargetProcessTree;
    } else {
      std::fprintf(stderr, "Invalid capture mode.\n");
      return 1;
    }
    pid_argument = argv[3];
  }

  if (!pid_argument) {
    std::fprintf(stderr, "Usage: excluded-system-audio.exe <target-process-id>\n");
    std::fprintf(stderr, "       excluded-system-audio.exe --capture <include|exclude> <target-process-id>\n");
    std::fprintf(stderr, "       excluded-system-audio.exe --list-windows\n");
    std::fprintf(stderr, "       excluded-system-audio.exe --meter-once <process-id> [...]\n");
    return 1;
  }

  char* end = nullptr;
  const unsigned long pid = std::strtoul(pid_argument, &end, 10);
  if (!end || *end != '\0' || pid == 0 || pid > 0xffffffffUL) {
    std::fprintf(stderr, "Invalid target process id.\n");
    return 1;
  }

  const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    print_error("CoInitializeEx failed.", hr);
    return 1;
  }

  const int result = run_capture(static_cast<DWORD>(pid), mode);
  CoUninitialize();
  return result;
}
