#pragma once

#include <QByteArray>
#include <QHash>
#include <QList>
#include <QObject>
#include <QString>

#include <atomic>
#include <cstdint>
#include <thread>

namespace baker::audio {

struct WindowAudioSource {
  quintptr nativeHandle = 0;
  quint32 processId = 0;
  QString title;
};

class ProcessLoopbackCapture final : public QObject {
  Q_OBJECT

 public:
  enum class Mode {
    IncludeProcessTree,
    ExcludeProcessTree,
  };
  Q_ENUM(Mode)

  explicit ProcessLoopbackCapture(QObject* parent = nullptr);
  ~ProcessLoopbackCapture() override;

  ProcessLoopbackCapture(const ProcessLoopbackCapture&) = delete;
  ProcessLoopbackCapture& operator=(const ProcessLoopbackCapture&) = delete;

  [[nodiscard]] bool isRunning() const noexcept;
  bool start(quint32 processId, Mode mode);
  void stop();

  [[nodiscard]] static bool isSupported() noexcept;
  [[nodiscard]] static QList<WindowAudioSource> enumerateWindowSources();
  [[nodiscard]] static QHash<quint32, float> measureActivePeaks(
      const QList<quint32>& processIds);
  [[nodiscard]] static float measurePeak(quint32 processId, int durationMs = 180);

 signals:
  void formatReady(int sampleRate, int channelCount);
  void samplesReady(const QByteArray& interleavedFloat32);
  void errorOccurred(const QString& message);
  void stopped();

 private:
  void run(std::stop_token stopToken, quint32 processId, Mode mode);
  void postError(const QString& message);

  std::atomic_bool running_ = false;
  std::jthread worker_;
};

}  // namespace baker::audio
