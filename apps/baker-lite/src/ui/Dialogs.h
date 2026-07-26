#pragma once

#include "ui/UiTypes.h"

#include <QDialog>
#include <QList>
#include <QString>

class QCheckBox;
class QComboBox;
class QDialogButtonBox;
class QFormLayout;
class QKeySequenceEdit;
class QLabel;
class QLineEdit;
class QListWidget;
class QProgressBar;
class QPushButton;
class QSlider;
class QTabWidget;
class QTextBrowser;

namespace baker::lite::ui {

class LoginDialog final : public QDialog {
  Q_OBJECT

public:
  explicit LoginDialog(QWidget *parent = nullptr);

  void setCredentials(const LoginCredentials &credentials);
  [[nodiscard]] LoginCredentials credentials() const;

signals:
  void createAccountRequested(const QString &serverUrl);

protected:
  void accept() override;

private:
  QLineEdit *serverEdit_ = nullptr;
  QLineEdit *emailEdit_ = nullptr;
  QLineEdit *passwordEdit_ = nullptr;
  QCheckBox *rememberCheck_ = nullptr;
};

class RegistrationDialog final : public QDialog {
  Q_OBJECT

public:
  explicit RegistrationDialog(QWidget *parent = nullptr);

  void setServerUrl(const QString &serverUrl);
  [[nodiscard]] RegistrationData registration() const;

protected:
  void accept() override;

private:
  QLineEdit *serverEdit_ = nullptr;
  QLineEdit *displayNameEdit_ = nullptr;
  QLineEdit *emailEdit_ = nullptr;
  QLineEdit *passwordEdit_ = nullptr;
  QLineEdit *confirmPasswordEdit_ = nullptr;
};

class ServerManagerDialog final : public QDialog {
  Q_OBJECT

public:
  explicit ServerManagerDialog(QWidget *parent = nullptr);

  void setBookmarks(const QList<ServerBookmark> &bookmarks);
  [[nodiscard]] QList<ServerBookmark> bookmarks() const;
  [[nodiscard]] ServerBookmark selectedBookmark() const;

signals:
  void testServerRequested(const QString &url);
  void createAccountRequested(const QString &url);

private:
  void addBookmark();
  void removeSelectedBookmark();
  void updateEditorFromSelection();
  void applyEditorToSelection();
  void refreshList();

  QList<ServerBookmark> bookmarks_;
  QListWidget *list_ = nullptr;
  QLineEdit *nameEdit_ = nullptr;
  QLineEdit *urlEdit_ = nullptr;
  QLineEdit *emailEdit_ = nullptr;
  QLineEdit *passwordEdit_ = nullptr;
  QCheckBox *defaultCheck_ = nullptr;
  QCheckBox *savePasswordCheck_ = nullptr;
  QCheckBox *autoLoginCheck_ = nullptr;
  QPushButton *removeButton_ = nullptr;
};

class SettingsDialog final : public QDialog {
  Q_OBJECT

public:
  explicit SettingsDialog(QWidget *parent = nullptr);

  void setSettings(const ClientSettings &settings);
  [[nodiscard]] ClientSettings settings() const;
  void setDevices(const QList<AudioDeviceOption> &inputDevices,
                  const QList<AudioDeviceOption> &outputDevices);
  void setDeviceSelection(const DeviceSelection &selection);
  [[nodiscard]] DeviceSelection deviceSelection() const;

signals:
  void refreshDevicesRequested();
  void testInputRequested(const QString &deviceId);
  void testOutputRequested(const QString &deviceId);

private:
  QComboBox *languageCombo_ = nullptr;
  QCheckBox *minimizeToTrayCheck_ = nullptr;
  QCheckBox *notificationsCheck_ = nullptr;
  QCheckBox *soundsCheck_ = nullptr;
  QCheckBox *startMutedCheck_ = nullptr;
  QCheckBox *pushToTalkCheck_ = nullptr;
  QKeySequenceEdit *pushToTalkEdit_ = nullptr;
  QKeySequenceEdit *connectShortcutEdit_ = nullptr;
  QKeySequenceEdit *disconnectShortcutEdit_ = nullptr;
  QKeySequenceEdit *leaveVoiceShortcutEdit_ = nullptr;
  QKeySequenceEdit *microphoneShortcutEdit_ = nullptr;
  QKeySequenceEdit *outputShortcutEdit_ = nullptr;
  QKeySequenceEdit *musicMuteShortcutEdit_ = nullptr;
  QKeySequenceEdit *microphoneVolumeDownShortcutEdit_ = nullptr;
  QKeySequenceEdit *microphoneVolumeUpShortcutEdit_ = nullptr;
  QKeySequenceEdit *outputVolumeDownShortcutEdit_ = nullptr;
  QKeySequenceEdit *outputVolumeUpShortcutEdit_ = nullptr;
  QKeySequenceEdit *musicVolumeDownShortcutEdit_ = nullptr;
  QKeySequenceEdit *musicVolumeUpShortcutEdit_ = nullptr;
  QKeySequenceEdit *stopStreamShortcutEdit_ = nullptr;
  QComboBox *inputDeviceCombo_ = nullptr;
  QComboBox *outputDeviceCombo_ = nullptr;

protected:
  void accept() override;
};

class DeviceDialog final : public QDialog {
  Q_OBJECT

public:
  explicit DeviceDialog(QWidget *parent = nullptr);

  void setDevices(const QList<AudioDeviceOption> &inputDevices,
                  const QList<AudioDeviceOption> &outputDevices);
  void setSelection(const DeviceSelection &selection);
  void setInputLevel(double normalizedLevel);
  [[nodiscard]] DeviceSelection selection() const;

signals:
  void refreshRequested();
  void testInputRequested(const QString &deviceId);
  void testOutputRequested(const QString &deviceId);

private:
  QComboBox *inputCombo_ = nullptr;
  QComboBox *outputCombo_ = nullptr;
  QProgressBar *inputLevel_ = nullptr;
};

class UpdateDialog final : public QDialog {
  Q_OBJECT

public:
  explicit UpdateDialog(QWidget *parent = nullptr);

  void setReleases(const QList<UpdateRelease> &releases);
  void setBusy(bool busy, const QString &status = {});
  [[nodiscard]] UpdateRelease selectedRelease() const;

signals:
  void refreshRequested();

private:
  void updateReleaseDetails();

  QList<UpdateRelease> releases_;
  QListWidget *releaseList_ = nullptr;
  QTextBrowser *releaseNotes_ = nullptr;
  QLabel *statusLabel_ = nullptr;
  QDialogButtonBox *buttons_ = nullptr;
};

class ScreenSourceDialog final : public QDialog {
  Q_OBJECT

public:
  explicit ScreenSourceDialog(QWidget *parent = nullptr);

  void setSources(const QList<CaptureSourceOption> &sources);
  void setSelection(const CaptureSelection &selection);
  [[nodiscard]] CaptureSelection selection() const;

signals:
  void refreshRequested();

protected:
  void accept() override;

private:
  QList<CaptureSourceOption> sources_;
  QListWidget *sourceList_ = nullptr;
  QCheckBox *shareAudioCheck_ = nullptr;
  QSlider *sharedAudioVolumeSlider_ = nullptr;
  QLabel *sharedAudioVolumeValue_ = nullptr;
  QCheckBox *excludeOwnProcessCheck_ = nullptr;
  QComboBox *resolutionCombo_ = nullptr;
  QComboBox *fpsCombo_ = nullptr;
  QComboBox *bitrateCombo_ = nullptr;
  QComboBox *codecCombo_ = nullptr;
};

class MusicSourceDialog final : public QDialog {
  Q_OBJECT

public:
  explicit MusicSourceDialog(QWidget *parent = nullptr);

  void setSources(const QList<MusicSourceOption> &sources);
  void setSelection(const MusicSourceSelection &selection);
  [[nodiscard]] MusicSourceSelection selection() const;

signals:
  void refreshRequested();

protected:
  void accept() override;

private:
  QList<MusicSourceOption> sources_;
  QListWidget *sourceList_ = nullptr;
  QSlider *volumeSlider_ = nullptr;
  QLabel *volumeValue_ = nullptr;
  QCheckBox *excludeOwnProcessCheck_ = nullptr;
};

} // namespace baker::lite::ui
