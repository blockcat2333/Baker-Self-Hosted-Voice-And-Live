#include "ui/Dialogs.h"

#include <QAbstractItemView>
#include <QCheckBox>
#include <QComboBox>
#include <QCoreApplication>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QIcon>
#include <QKeySequenceEdit>
#include <QLabel>
#include <QLineEdit>
#include <QListView>
#include <QListWidget>
#include <QLocale>
#include <QMessageBox>
#include <QProgressBar>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSlider>
#include <QTabWidget>
#include <QTextBrowser>
#include <QUuid>
#include <QVBoxLayout>
#include <QtMath>

#include <algorithm>

namespace baker::lite::ui {
namespace {

QDialogButtonBox *standardButtons(QDialog *dialog,
                                  const QString &acceptText = {}) {
  auto *buttons = new QDialogButtonBox(
      QDialogButtonBox::Ok | QDialogButtonBox::Cancel, dialog);
  if (!acceptText.isEmpty()) {
    buttons->button(QDialogButtonBox::Ok)->setText(acceptText);
  }
  buttons->button(QDialogButtonBox::Cancel)
      ->setText(
          QCoreApplication::translate("baker::lite::ui::Dialogs", "Cancel"));
  QObject::connect(buttons, &QDialogButtonBox::accepted, dialog,
                   &QDialog::accept);
  QObject::connect(buttons, &QDialogButtonBox::rejected, dialog,
                   &QDialog::reject);
  return buttons;
}

void selectComboValue(QComboBox *combo, const QString &value) {
  const int index = combo->findData(value);
  if (index >= 0) {
    combo->setCurrentIndex(index);
  }
}

} // namespace

LoginDialog::LoginDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Connect to Baker"));
  setModal(true);
  setMinimumWidth(430);

  auto *heading = new QLabel(tr("Sign in"), this);
  heading->setObjectName(QStringLiteral("dialogHeading"));
  auto *hint =
      new QLabel(tr("Use the account registered on this Baker server."), this);
  hint->setObjectName(QStringLiteral("dialogHint"));
  hint->setWordWrap(true);

  serverEdit_ = new QLineEdit(this);
  serverEdit_->setPlaceholderText(QStringLiteral("https://voice.example.com"));
  emailEdit_ = new QLineEdit(this);
  emailEdit_->setInputMethodHints(Qt::ImhEmailCharactersOnly);
  emailEdit_->setPlaceholderText(QStringLiteral("name@example.com"));
  passwordEdit_ = new QLineEdit(this);
  passwordEdit_->setEchoMode(QLineEdit::Password);
  rememberCheck_ = new QCheckBox(tr("Remember this login securely"), this);
  rememberCheck_->setChecked(true);

  auto *form = new QFormLayout();
  form->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  form->addRow(tr("Server"), serverEdit_);
  form->addRow(tr("Email"), emailEdit_);
  form->addRow(tr("Password"), passwordEdit_);

  auto *layout = new QVBoxLayout(this);
  layout->addWidget(heading);
  layout->addWidget(hint);
  layout->addSpacing(8);
  layout->addLayout(form);
  layout->addWidget(rememberCheck_);
  layout->addSpacing(8);
  auto *createAccountButton = new QPushButton(tr("Create account"), this);
  createAccountButton->setObjectName(
      QStringLiteral("loginCreateAccountButton"));
  auto *footer = new QHBoxLayout();
  footer->addWidget(createAccountButton);
  footer->addStretch();
  footer->addWidget(standardButtons(this, tr("Sign in")));
  layout->addLayout(footer);

  connect(createAccountButton, &QPushButton::clicked, this, [this] {
    emit createAccountRequested(serverEdit_->text().trimmed());
  });
}

void LoginDialog::setCredentials(const LoginCredentials &credentials) {
  serverEdit_->setText(credentials.serverUrl);
  emailEdit_->setText(credentials.email);
  passwordEdit_->setText(credentials.password);
  rememberCheck_->setChecked(credentials.rememberLogin);
}

LoginCredentials LoginDialog::credentials() const {
  return {
      serverEdit_->text().trimmed(),
      emailEdit_->text().trimmed(),
      passwordEdit_->text(),
      rememberCheck_->isChecked(),
  };
}

void LoginDialog::accept() {
  if (serverEdit_->text().trimmed().isEmpty() ||
      emailEdit_->text().trimmed().isEmpty() ||
      passwordEdit_->text().isEmpty()) {
    QMessageBox::warning(this, tr("Missing information"),
                         tr("Enter the server, email, and password."));
    return;
  }
  QDialog::accept();
}

RegistrationDialog::RegistrationDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Create Baker account"));
  setModal(true);
  setMinimumWidth(430);

  auto *heading = new QLabel(tr("Create an account"), this);
  heading->setObjectName(QStringLiteral("dialogHeading"));
  auto *hint = new QLabel(
      tr("Your account belongs to the selected self-hosted Baker server."),
      this);
  hint->setObjectName(QStringLiteral("dialogHint"));
  hint->setWordWrap(true);

  serverEdit_ = new QLineEdit(this);
  serverEdit_->setPlaceholderText(QStringLiteral("https://voice.example.com"));
  displayNameEdit_ = new QLineEdit(this);
  emailEdit_ = new QLineEdit(this);
  emailEdit_->setInputMethodHints(Qt::ImhEmailCharactersOnly);
  passwordEdit_ = new QLineEdit(this);
  passwordEdit_->setEchoMode(QLineEdit::Password);
  confirmPasswordEdit_ = new QLineEdit(this);
  confirmPasswordEdit_->setEchoMode(QLineEdit::Password);

  auto *form = new QFormLayout();
  form->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  form->addRow(tr("Server"), serverEdit_);
  form->addRow(tr("Display name"), displayNameEdit_);
  form->addRow(tr("Email"), emailEdit_);
  form->addRow(tr("Password"), passwordEdit_);
  form->addRow(tr("Confirm password"), confirmPasswordEdit_);

  auto *layout = new QVBoxLayout(this);
  layout->addWidget(heading);
  layout->addWidget(hint);
  layout->addSpacing(8);
  layout->addLayout(form);
  layout->addSpacing(8);
  layout->addWidget(standardButtons(this, tr("Create account")));
}

void RegistrationDialog::setServerUrl(const QString &serverUrl) {
  serverEdit_->setText(serverUrl);
}

RegistrationData RegistrationDialog::registration() const {
  return {
      serverEdit_->text().trimmed(),
      displayNameEdit_->text().trimmed(),
      emailEdit_->text().trimmed(),
      passwordEdit_->text(),
  };
}

void RegistrationDialog::accept() {
  if (serverEdit_->text().trimmed().isEmpty() ||
      displayNameEdit_->text().trimmed().isEmpty() ||
      emailEdit_->text().trimmed().isEmpty() ||
      passwordEdit_->text().isEmpty()) {
    QMessageBox::warning(
        this, tr("Missing information"),
        tr("Complete every field before creating the account."));
    return;
  }
  if (passwordEdit_->text().size() < 8) {
    QMessageBox::warning(this, tr("Password too short"),
                         tr("Use at least 8 characters."));
    return;
  }
  if (passwordEdit_->text() != confirmPasswordEdit_->text()) {
    QMessageBox::warning(this, tr("Passwords do not match"),
                         tr("Enter the same password twice."));
    return;
  }
  QDialog::accept();
}

ServerManagerDialog::ServerManagerDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Server manager"));
  resize(680, 420);

  list_ = new QListWidget(this);
  list_->setObjectName(QStringLiteral("serverBookmarkList"));
  list_->setMinimumWidth(220);
  list_->setSelectionMode(QAbstractItemView::SingleSelection);

  auto *addButton = new QPushButton(tr("Add"), this);
  removeButton_ = new QPushButton(tr("Remove"), this);
  auto *listButtons = new QHBoxLayout();
  listButtons->addWidget(addButton);
  listButtons->addWidget(removeButton_);
  listButtons->addStretch();

  nameEdit_ = new QLineEdit(this);
  urlEdit_ = new QLineEdit(this);
  urlEdit_->setPlaceholderText(QStringLiteral("https://voice.example.com"));
  emailEdit_ = new QLineEdit(this);
  emailEdit_->setInputMethodHints(Qt::ImhEmailCharactersOnly);
  emailEdit_->setPlaceholderText(QStringLiteral("name@example.com"));
  passwordEdit_ = new QLineEdit(this);
  passwordEdit_->setEchoMode(QLineEdit::Password);
  passwordEdit_->setPlaceholderText(
      tr("Stored securely in Windows Credential Manager"));
  defaultCheck_ = new QCheckBox(tr("Use as default server"), this);
  savePasswordCheck_ = new QCheckBox(
      tr("Save this password in Windows Credential Manager"), this);
  autoLoginCheck_ = new QCheckBox(tr("Sign in automatically"), this);
  auto *testButton = new QPushButton(tr("Test connection"), this);
  auto *registerButton =
      new QPushButton(tr("Create an account on this server"), this);

  auto *editorForm = new QFormLayout();
  editorForm->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  editorForm->addRow(tr("Name"), nameEdit_);
  editorForm->addRow(tr("Address"), urlEdit_);
  editorForm->addRow(QString(), defaultCheck_);
  editorForm->addRow(QString(), testButton);

  auto *accountForm = new QFormLayout();
  accountForm->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  accountForm->addRow(tr("Account email"), emailEdit_);
  accountForm->addRow(tr("Password"), passwordEdit_);
  accountForm->addRow(QString(), savePasswordCheck_);
  accountForm->addRow(QString(), autoLoginCheck_);
  accountForm->addRow(QString(), registerButton);

  auto *listPane = new QVBoxLayout();
  listPane->addWidget(new QLabel(tr("Saved servers"), this));
  listPane->addWidget(list_, 1);
  listPane->addLayout(listButtons);

  auto *editorGroup = new QGroupBox(tr("Server details"), this);
  editorGroup->setLayout(editorForm);
  auto *accountGroup = new QGroupBox(tr("Account for this server"), this);
  accountGroup->setLayout(accountForm);
  auto *editorPane = new QVBoxLayout();
  editorPane->addWidget(editorGroup);
  editorPane->addWidget(accountGroup);
  editorPane->addStretch();

  auto *content = new QHBoxLayout();
  content->addLayout(listPane, 1);
  content->addLayout(editorPane, 2);

  auto *layout = new QVBoxLayout(this);
  layout->addLayout(content, 1);
  layout->addWidget(standardButtons(this, tr("Connect")));

  connect(addButton, &QPushButton::clicked, this,
          &ServerManagerDialog::addBookmark);
  connect(removeButton_, &QPushButton::clicked, this,
          &ServerManagerDialog::removeSelectedBookmark);
  connect(list_, &QListWidget::currentRowChanged, this,
          &ServerManagerDialog::updateEditorFromSelection);
  connect(list_, &QListWidget::itemDoubleClicked, this, [this] { accept(); });
  connect(nameEdit_, &QLineEdit::editingFinished, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(urlEdit_, &QLineEdit::editingFinished, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(emailEdit_, &QLineEdit::editingFinished, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(passwordEdit_, &QLineEdit::editingFinished, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(defaultCheck_, &QCheckBox::toggled, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(savePasswordCheck_, &QCheckBox::toggled, this,
          [this](const bool save) {
            passwordEdit_->setEnabled(save);
            applyEditorToSelection();
          });
  connect(autoLoginCheck_, &QCheckBox::toggled, this,
          &ServerManagerDialog::applyEditorToSelection);
  connect(testButton, &QPushButton::clicked, this,
          [this] { emit testServerRequested(urlEdit_->text().trimmed()); });
  connect(registerButton, &QPushButton::clicked, this, [this] {
    applyEditorToSelection();
    emit createAccountRequested(urlEdit_->text().trimmed());
  });
}

void ServerManagerDialog::setBookmarks(const QList<ServerBookmark> &bookmarks) {
  bookmarks_ = bookmarks;
  refreshList();
}

QList<ServerBookmark> ServerManagerDialog::bookmarks() const {
  return bookmarks_;
}

ServerBookmark ServerManagerDialog::selectedBookmark() const {
  const int row = list_->currentRow();
  return row >= 0 && row < bookmarks_.size() ? bookmarks_.at(row)
                                             : ServerBookmark{};
}

void ServerManagerDialog::addBookmark() {
  bookmarks_.push_back({
      QUuid::createUuid().toString(QUuid::WithoutBraces),
      tr("New server"),
      QStringLiteral("https://"),
      bookmarks_.isEmpty(),
  });
  refreshList();
  list_->setCurrentRow(bookmarks_.size() - 1);
  nameEdit_->selectAll();
  nameEdit_->setFocus();
}

void ServerManagerDialog::removeSelectedBookmark() {
  const int row = list_->currentRow();
  if (row < 0 || row >= bookmarks_.size()) {
    return;
  }
  bookmarks_.removeAt(row);
  refreshList();
  if (!bookmarks_.isEmpty()) {
    list_->setCurrentRow(
        std::min(row, static_cast<int>(bookmarks_.size()) - 1));
  }
}

void ServerManagerDialog::updateEditorFromSelection() {
  const int row = list_->currentRow();
  const bool valid = row >= 0 && row < bookmarks_.size();
  nameEdit_->setEnabled(valid);
  urlEdit_->setEnabled(valid);
  emailEdit_->setEnabled(valid);
  passwordEdit_->setEnabled(valid && savePasswordCheck_->isChecked());
  defaultCheck_->setEnabled(valid);
  savePasswordCheck_->setEnabled(valid);
  autoLoginCheck_->setEnabled(valid);
  removeButton_->setEnabled(valid);

  if (!valid) {
    nameEdit_->clear();
    urlEdit_->clear();
    emailEdit_->clear();
    passwordEdit_->clear();
    defaultCheck_->setChecked(false);
    savePasswordCheck_->setChecked(false);
    autoLoginCheck_->setChecked(false);
    return;
  }

  const QSignalBlocker nameBlocker(nameEdit_);
  const QSignalBlocker urlBlocker(urlEdit_);
  const QSignalBlocker emailBlocker(emailEdit_);
  const QSignalBlocker passwordBlocker(passwordEdit_);
  const QSignalBlocker defaultBlocker(defaultCheck_);
  const QSignalBlocker savePasswordBlocker(savePasswordCheck_);
  const QSignalBlocker autoLoginBlocker(autoLoginCheck_);
  const auto &bookmark = bookmarks_.at(row);
  nameEdit_->setText(bookmark.name);
  urlEdit_->setText(bookmark.url);
  emailEdit_->setText(bookmark.accountEmail);
  passwordEdit_->setText(bookmark.password);
  defaultCheck_->setChecked(bookmark.isDefault);
  savePasswordCheck_->setChecked(bookmark.savePassword);
  autoLoginCheck_->setChecked(bookmark.autoLogin);
  passwordEdit_->setEnabled(bookmark.savePassword);
}

void ServerManagerDialog::applyEditorToSelection() {
  const int row = list_->currentRow();
  if (row < 0 || row >= bookmarks_.size()) {
    return;
  }
  if (defaultCheck_->isChecked()) {
    for (auto &bookmark : bookmarks_) {
      bookmark.isDefault = false;
    }
  }
  auto &bookmark = bookmarks_[row];
  bookmark.name = nameEdit_->text().trimmed();
  bookmark.url = urlEdit_->text().trimmed();
  bookmark.isDefault = defaultCheck_->isChecked();
  bookmark.accountEmail = emailEdit_->text().trimmed();
  bookmark.password =
      savePasswordCheck_->isChecked() ? passwordEdit_->text() : QString();
  bookmark.savePassword = savePasswordCheck_->isChecked();
  bookmark.autoLogin = autoLoginCheck_->isChecked();
  refreshList();
  list_->setCurrentRow(row);
}

void ServerManagerDialog::refreshList() {
  const int oldRow = list_->currentRow();
  const QSignalBlocker blocker(list_);
  list_->clear();
  for (const auto &bookmark : bookmarks_) {
    auto *item = new QListWidgetItem(
        QIcon(QStringLiteral(":/icons/server.svg")),
        bookmark.name.isEmpty() ? bookmark.url : bookmark.name, list_);
    item->setToolTip(bookmark.url);
    if (bookmark.isDefault) {
      item->setText(item->text() + tr("  (default)"));
    }
  }
  if (!bookmarks_.isEmpty()) {
    list_->setCurrentRow(
        qBound(0, oldRow, static_cast<int>(bookmarks_.size()) - 1));
  }
  updateEditorFromSelection();
}

SettingsDialog::SettingsDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Settings"));
  resize(720, 620);

  auto *tabs = new QTabWidget(this);

  auto *generalPage = new QWidget(tabs);
  languageCombo_ = new QComboBox(generalPage);
  languageCombo_->addItem(QStringLiteral("English"),
                          QVariant::fromValue(UiLanguage::English));
  languageCombo_->addItem(QStringLiteral("简体中文"),
                          QVariant::fromValue(UiLanguage::SimplifiedChinese));
  minimizeToTrayCheck_ =
      new QCheckBox(tr("Minimize to the notification area"), generalPage);
  notificationsCheck_ =
      new QCheckBox(tr("Show desktop notifications"), generalPage);
  soundsCheck_ = new QCheckBox(tr("Play notification sounds"), generalPage);
  auto *generalForm = new QFormLayout(generalPage);
  generalForm->addRow(tr("Language"), languageCombo_);
  generalForm->addRow(QString(), minimizeToTrayCheck_);
  generalForm->addRow(QString(), notificationsCheck_);
  generalForm->addRow(QString(), soundsCheck_);
  generalForm->setFormAlignment(Qt::AlignTop);
  tabs->addTab(generalPage, tr("General"));

  auto *voicePage = new QWidget(tabs);
  startMutedCheck_ =
      new QCheckBox(tr("Mute microphone when Baker Lite starts"), voicePage);
  pushToTalkCheck_ = new QCheckBox(tr("Use push-to-talk"), voicePage);
  pushToTalkEdit_ = new QKeySequenceEdit(voicePage);
  pushToTalkEdit_->setClearButtonEnabled(true);
  pushToTalkEdit_->setEnabled(false);
  connect(pushToTalkCheck_, &QCheckBox::toggled, pushToTalkEdit_,
          &QKeySequenceEdit::setEnabled);
  auto *voiceForm = new QFormLayout(voicePage);
  voiceForm->addRow(QString(), startMutedCheck_);
  voiceForm->addRow(QString(), pushToTalkCheck_);
  voiceForm->addRow(tr("Push-to-talk shortcut"), pushToTalkEdit_);
  voiceForm->setFormAlignment(Qt::AlignTop);
  tabs->addTab(voicePage, tr("Voice"));

  auto *shortcutsPage = new QWidget(tabs);
  connectShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  disconnectShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  leaveVoiceShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  microphoneShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  outputShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  musicMuteShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  microphoneVolumeDownShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  microphoneVolumeUpShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  outputVolumeDownShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  outputVolumeUpShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  musicVolumeDownShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  musicVolumeUpShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  stopStreamShortcutEdit_ = new QKeySequenceEdit(shortcutsPage);
  const QList<QKeySequenceEdit *> shortcutEditors = {
      connectShortcutEdit_,
      disconnectShortcutEdit_,
      leaveVoiceShortcutEdit_,
      microphoneShortcutEdit_,
      outputShortcutEdit_,
      musicMuteShortcutEdit_,
      microphoneVolumeDownShortcutEdit_,
      microphoneVolumeUpShortcutEdit_,
      outputVolumeDownShortcutEdit_,
      outputVolumeUpShortcutEdit_,
      musicVolumeDownShortcutEdit_,
      musicVolumeUpShortcutEdit_,
      stopStreamShortcutEdit_,
  };
  for (QKeySequenceEdit *editor : shortcutEditors) {
    editor->setClearButtonEnabled(true);
  }
  auto *shortcutsForm = new QFormLayout();
  shortcutsForm->addRow(tr("Connect to server"), connectShortcutEdit_);
  shortcutsForm->addRow(tr("Disconnect from server"), disconnectShortcutEdit_);
  shortcutsForm->addRow(tr("Leave voice channel"), leaveVoiceShortcutEdit_);
  shortcutsForm->addRow(tr("Mute / unmute microphone"),
                        microphoneShortcutEdit_);
  shortcutsForm->addRow(tr("Mute / unmute speakers"), outputShortcutEdit_);
  shortcutsForm->addRow(tr("Mute / unmute shared music"),
                        musicMuteShortcutEdit_);
  shortcutsForm->addRow(tr("Microphone volume down"),
                        microphoneVolumeDownShortcutEdit_);
  shortcutsForm->addRow(tr("Microphone volume up"),
                        microphoneVolumeUpShortcutEdit_);
  shortcutsForm->addRow(tr("Speaker volume down"),
                        outputVolumeDownShortcutEdit_);
  shortcutsForm->addRow(tr("Speaker volume up"), outputVolumeUpShortcutEdit_);
  shortcutsForm->addRow(tr("Shared music volume down"),
                        musicVolumeDownShortcutEdit_);
  shortcutsForm->addRow(tr("Shared music volume up"),
                        musicVolumeUpShortcutEdit_);
  shortcutsForm->addRow(tr("Stop live stream"), stopStreamShortcutEdit_);
  shortcutsForm->setFormAlignment(Qt::AlignTop);
  auto *shortcutsLayout = new QVBoxLayout(shortcutsPage);
  shortcutsLayout->setContentsMargins(0, 0, 0, 0);
  shortcutsLayout->addLayout(shortcutsForm);
  auto *shortcutHint =
      new QLabel(tr("Shortcuts are active while Baker Lite is running. Leave a "
                    "field empty to keep it unbound."),
                 shortcutsPage);
  shortcutHint->setWordWrap(true);
  shortcutsLayout->addWidget(shortcutHint);
  shortcutsLayout->addStretch();
  tabs->addTab(shortcutsPage, tr("Shortcuts"));

  auto *devicesPage = new QWidget(tabs);
  inputDeviceCombo_ = new QComboBox(devicesPage);
  outputDeviceCombo_ = new QComboBox(devicesPage);
  auto *testInputButton = new QPushButton(tr("Test microphone"), devicesPage);
  auto *testOutputButton = new QPushButton(tr("Play test sound"), devicesPage);
  auto *refreshDevicesButton =
      new QPushButton(tr("Refresh devices"), devicesPage);
  auto *inputRow = new QHBoxLayout();
  inputRow->addWidget(inputDeviceCombo_, 1);
  inputRow->addWidget(testInputButton);
  auto *outputRow = new QHBoxLayout();
  outputRow->addWidget(outputDeviceCombo_, 1);
  outputRow->addWidget(testOutputButton);
  auto *devicesForm = new QFormLayout(devicesPage);
  devicesForm->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  devicesForm->addRow(tr("Microphone"), inputRow);
  devicesForm->addRow(tr("Speakers"), outputRow);
  devicesForm->addRow(QString(), refreshDevicesButton);
  devicesForm->setFormAlignment(Qt::AlignTop);
  tabs->addTab(devicesPage, tr("Audio devices"));

  connect(refreshDevicesButton, &QPushButton::clicked, this,
          &SettingsDialog::refreshDevicesRequested);
  connect(testInputButton, &QPushButton::clicked, this, [this] {
    emit testInputRequested(inputDeviceCombo_->currentData().toString());
  });
  connect(testOutputButton, &QPushButton::clicked, this, [this] {
    emit testOutputRequested(outputDeviceCombo_->currentData().toString());
  });

  auto *layout = new QVBoxLayout(this);
  layout->addWidget(tabs, 1);
  layout->addWidget(standardButtons(this, tr("Save")));
}

void SettingsDialog::setSettings(const ClientSettings &settings) {
  const int languageIndex =
      languageCombo_->findData(QVariant::fromValue(settings.language));
  if (languageIndex >= 0) {
    languageCombo_->setCurrentIndex(languageIndex);
  }
  minimizeToTrayCheck_->setChecked(settings.minimizeToTray);
  notificationsCheck_->setChecked(settings.showDesktopNotifications);
  soundsCheck_->setChecked(settings.playNotificationSounds);
  startMutedCheck_->setChecked(settings.startMuted);
  pushToTalkCheck_->setChecked(settings.pushToTalk);
  pushToTalkEdit_->setKeySequence(QKeySequence::fromString(
      settings.pushToTalkShortcut, QKeySequence::PortableText));
  connectShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.connectShortcut, QKeySequence::PortableText));
  disconnectShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.disconnectShortcut, QKeySequence::PortableText));
  leaveVoiceShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.leaveVoiceShortcut, QKeySequence::PortableText));
  microphoneShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.toggleMicrophoneShortcut, QKeySequence::PortableText));
  outputShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.toggleOutputShortcut, QKeySequence::PortableText));
  musicMuteShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.toggleMusicMuteShortcut, QKeySequence::PortableText));
  microphoneVolumeDownShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.microphoneVolumeDownShortcut, QKeySequence::PortableText));
  microphoneVolumeUpShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.microphoneVolumeUpShortcut, QKeySequence::PortableText));
  outputVolumeDownShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.outputVolumeDownShortcut, QKeySequence::PortableText));
  outputVolumeUpShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.outputVolumeUpShortcut, QKeySequence::PortableText));
  musicVolumeDownShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.musicVolumeDownShortcut, QKeySequence::PortableText));
  musicVolumeUpShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.musicVolumeUpShortcut, QKeySequence::PortableText));
  stopStreamShortcutEdit_->setKeySequence(QKeySequence::fromString(
      settings.stopStreamShortcut, QKeySequence::PortableText));
}

ClientSettings SettingsDialog::settings() const {
  ClientSettings result;
  result.language = languageCombo_->currentData().value<UiLanguage>();
  result.minimizeToTray = minimizeToTrayCheck_->isChecked();
  result.showDesktopNotifications = notificationsCheck_->isChecked();
  result.playNotificationSounds = soundsCheck_->isChecked();
  result.startMuted = startMutedCheck_->isChecked();
  result.pushToTalk = pushToTalkCheck_->isChecked();
  result.pushToTalkShortcut =
      pushToTalkEdit_->keySequence().toString(QKeySequence::PortableText);
  result.connectShortcut =
      connectShortcutEdit_->keySequence().toString(QKeySequence::PortableText);
  result.disconnectShortcut = disconnectShortcutEdit_->keySequence().toString(
      QKeySequence::PortableText);
  result.leaveVoiceShortcut = leaveVoiceShortcutEdit_->keySequence().toString(
      QKeySequence::PortableText);
  result.toggleMicrophoneShortcut =
      microphoneShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.toggleOutputShortcut =
      outputShortcutEdit_->keySequence().toString(QKeySequence::PortableText);
  result.toggleMusicMuteShortcut =
      musicMuteShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.microphoneVolumeDownShortcut =
      microphoneVolumeDownShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.microphoneVolumeUpShortcut =
      microphoneVolumeUpShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.outputVolumeDownShortcut =
      outputVolumeDownShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.outputVolumeUpShortcut =
      outputVolumeUpShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.musicVolumeDownShortcut =
      musicVolumeDownShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.musicVolumeUpShortcut =
      musicVolumeUpShortcutEdit_->keySequence().toString(
          QKeySequence::PortableText);
  result.stopStreamShortcut = stopStreamShortcutEdit_->keySequence().toString(
      QKeySequence::PortableText);
  return result;
}

void SettingsDialog::accept() {
  QHash<QString, QString> used;
  const QList<QPair<QString, QKeySequenceEdit *>> shortcuts = {
      {tr("Push-to-talk"), pushToTalkEdit_},
      {tr("Connect to server"), connectShortcutEdit_},
      {tr("Disconnect from server"), disconnectShortcutEdit_},
      {tr("Leave voice channel"), leaveVoiceShortcutEdit_},
      {tr("Mute / unmute microphone"), microphoneShortcutEdit_},
      {tr("Mute / unmute speakers"), outputShortcutEdit_},
      {tr("Mute / unmute shared music"), musicMuteShortcutEdit_},
      {tr("Microphone volume down"), microphoneVolumeDownShortcutEdit_},
      {tr("Microphone volume up"), microphoneVolumeUpShortcutEdit_},
      {tr("Speaker volume down"), outputVolumeDownShortcutEdit_},
      {tr("Speaker volume up"), outputVolumeUpShortcutEdit_},
      {tr("Shared music volume down"), musicVolumeDownShortcutEdit_},
      {tr("Shared music volume up"), musicVolumeUpShortcutEdit_},
      {tr("Stop live stream"), stopStreamShortcutEdit_},
  };
  for (const auto &[name, editor] : shortcuts) {
    const QString sequence =
        editor->keySequence().toString(QKeySequence::PortableText);
    if (sequence.isEmpty()) {
      continue;
    }
    if (used.contains(sequence)) {
      QMessageBox::warning(this, tr("Duplicate shortcut"),
                           tr("%1 and %2 use the same shortcut (%3).")
                               .arg(used.value(sequence), name, sequence));
      return;
    }
    used.insert(sequence, name);
  }
  QDialog::accept();
}

void SettingsDialog::setDevices(const QList<AudioDeviceOption> &inputDevices,
                                const QList<AudioDeviceOption> &outputDevices) {
  const QString previousInput = inputDeviceCombo_->currentData().toString();
  const QString previousOutput = outputDeviceCombo_->currentData().toString();
  inputDeviceCombo_->clear();
  outputDeviceCombo_->clear();
  for (const auto &device : inputDevices) {
    inputDeviceCombo_->addItem(
        device.name + (device.isDefault ? tr(" (default)") : QString()),
        device.id);
  }
  for (const auto &device : outputDevices) {
    outputDeviceCombo_->addItem(
        device.name + (device.isDefault ? tr(" (default)") : QString()),
        device.id);
  }
  selectComboValue(inputDeviceCombo_, previousInput);
  selectComboValue(outputDeviceCombo_, previousOutput);
}

void SettingsDialog::setDeviceSelection(const DeviceSelection &selection) {
  selectComboValue(inputDeviceCombo_, selection.inputDeviceId);
  selectComboValue(outputDeviceCombo_, selection.outputDeviceId);
}

DeviceSelection SettingsDialog::deviceSelection() const {
  return {
      inputDeviceCombo_->currentData().toString(),
      outputDeviceCombo_->currentData().toString(),
  };
}

DeviceDialog::DeviceDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Audio devices"));
  setMinimumWidth(520);

  inputCombo_ = new QComboBox(this);
  outputCombo_ = new QComboBox(this);
  inputLevel_ = new QProgressBar(this);
  inputLevel_->setRange(0, 1000);
  inputLevel_->setValue(0);
  inputLevel_->setTextVisible(false);
  inputLevel_->setAccessibleName(tr("Microphone level"));

  auto *testInputButton = new QPushButton(tr("Test microphone"), this);
  auto *testOutputButton = new QPushButton(tr("Play test sound"), this);
  auto *refreshButton = new QPushButton(tr("Refresh devices"), this);

  auto *inputRow = new QHBoxLayout();
  inputRow->addWidget(inputCombo_, 1);
  inputRow->addWidget(testInputButton);
  auto *outputRow = new QHBoxLayout();
  outputRow->addWidget(outputCombo_, 1);
  outputRow->addWidget(testOutputButton);

  auto *form = new QFormLayout();
  form->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
  form->addRow(tr("Microphone"), inputRow);
  form->addRow(tr("Input level"), inputLevel_);
  form->addRow(tr("Speakers"), outputRow);

  auto *footer = new QHBoxLayout();
  footer->addWidget(refreshButton);
  footer->addStretch();
  footer->addWidget(standardButtons(this, tr("Apply")));

  auto *layout = new QVBoxLayout(this);
  layout->addLayout(form);
  layout->addSpacing(8);
  layout->addLayout(footer);

  connect(refreshButton, &QPushButton::clicked, this,
          &DeviceDialog::refreshRequested);
  connect(testInputButton, &QPushButton::clicked, this, [this] {
    emit testInputRequested(inputCombo_->currentData().toString());
  });
  connect(testOutputButton, &QPushButton::clicked, this, [this] {
    emit testOutputRequested(outputCombo_->currentData().toString());
  });
}

void DeviceDialog::setDevices(const QList<AudioDeviceOption> &inputDevices,
                              const QList<AudioDeviceOption> &outputDevices) {
  const QString previousInput = inputCombo_->currentData().toString();
  const QString previousOutput = outputCombo_->currentData().toString();
  inputCombo_->clear();
  outputCombo_->clear();
  for (const auto &device : inputDevices) {
    inputCombo_->addItem(device.name +
                             (device.isDefault ? tr(" (default)") : QString()),
                         device.id);
  }
  for (const auto &device : outputDevices) {
    outputCombo_->addItem(device.name +
                              (device.isDefault ? tr(" (default)") : QString()),
                          device.id);
  }
  selectComboValue(inputCombo_, previousInput);
  selectComboValue(outputCombo_, previousOutput);
}

void DeviceDialog::setSelection(const DeviceSelection &selection) {
  selectComboValue(inputCombo_, selection.inputDeviceId);
  selectComboValue(outputCombo_, selection.outputDeviceId);
}

void DeviceDialog::setInputLevel(const double normalizedLevel) {
  inputLevel_->setValue(qBound(0, qRound(normalizedLevel * 1000.0), 1000));
}

DeviceSelection DeviceDialog::selection() const {
  return {
      inputCombo_->currentData().toString(),
      outputCombo_->currentData().toString(),
  };
}

UpdateDialog::UpdateDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Baker Lite updates"));
  resize(680, 460);

  releaseList_ = new QListWidget(this);
  releaseList_->setMinimumWidth(190);
  releaseNotes_ = new QTextBrowser(this);
  releaseNotes_->setOpenExternalLinks(true);
  statusLabel_ = new QLabel(tr("Choose a version to install."), this);
  statusLabel_->setObjectName(QStringLiteral("dialogHint"));
  auto *refreshButton = new QPushButton(tr("Refresh"), this);
  buttons_ = standardButtons(this, tr("Install selected"));

  auto *content = new QHBoxLayout();
  content->addWidget(releaseList_, 1);
  content->addWidget(releaseNotes_, 2);

  auto *footer = new QHBoxLayout();
  footer->addWidget(refreshButton);
  footer->addWidget(statusLabel_, 1);
  footer->addWidget(buttons_);

  auto *layout = new QVBoxLayout(this);
  layout->addLayout(content, 1);
  layout->addLayout(footer);

  connect(releaseList_, &QListWidget::currentRowChanged, this,
          &UpdateDialog::updateReleaseDetails);
  connect(refreshButton, &QPushButton::clicked, this,
          &UpdateDialog::refreshRequested);
}

void UpdateDialog::setReleases(const QList<UpdateRelease> &releases) {
  releases_ = releases;
  releaseList_->clear();
  int currentRow = 0;
  for (int row = 0; row < releases_.size(); ++row) {
    const auto &release = releases_.at(row);
    QString label = release.version;
    if (release.current) {
      label += tr("  (installed)");
      currentRow = row;
    } else if (release.prerelease) {
      label += tr("  (preview)");
    }
    auto *item = new QListWidgetItem(
        QIcon(QStringLiteral(":/icons/update.svg")), label, releaseList_);
    item->setToolTip(
        QLocale::system().toString(release.publishedAt, QLocale::ShortFormat));
  }
  if (!releases_.isEmpty()) {
    releaseList_->setCurrentRow(currentRow);
  }
  buttons_->button(QDialogButtonBox::Ok)->setEnabled(!releases_.isEmpty());
}

void UpdateDialog::setBusy(const bool busy, const QString &status) {
  releaseList_->setEnabled(!busy);
  buttons_->button(QDialogButtonBox::Ok)
      ->setEnabled(!busy && !releases_.isEmpty());
  statusLabel_->setText(
      status.isEmpty()
          ? (busy ? tr("Working…") : tr("Choose a version to install."))
          : status);
}

UpdateRelease UpdateDialog::selectedRelease() const {
  const int row = releaseList_->currentRow();
  return row >= 0 && row < releases_.size() ? releases_.at(row)
                                            : UpdateRelease{};
}

void UpdateDialog::updateReleaseDetails() {
  const auto release = selectedRelease();
  if (release.version.isEmpty()) {
    releaseNotes_->clear();
    return;
  }
  const QString state =
      release.current
          ? tr("Installed version")
          : (release.prerelease ? tr("Preview release") : tr("Stable release"));
  releaseNotes_->setHtml(
      QStringLiteral("<h2>%1</h2><p><b>%2</b> · %3</p><hr><p>%4</p>")
          .arg(release.version.toHtmlEscaped(), state.toHtmlEscaped(),
               QLocale::system()
                   .toString(release.publishedAt, QLocale::LongFormat)
                   .toHtmlEscaped(),
               release.notes.toHtmlEscaped().replace(QStringLiteral("\n"),
                                                     QStringLiteral("<br>"))));
}

ScreenSourceDialog::ScreenSourceDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Choose a screen or window"));
  resize(760, 590);

  sourceList_ = new QListWidget(this);
  sourceList_->setObjectName(QStringLiteral("captureSourceList"));
  sourceList_->setViewMode(QListView::IconMode);
  sourceList_->setResizeMode(QListView::Adjust);
  sourceList_->setIconSize(QSize(192, 108));
  sourceList_->setGridSize(QSize(220, 150));
  sourceList_->setMovement(QListView::Static);
  sourceList_->setSelectionMode(QAbstractItemView::SingleSelection);

  auto *refreshButton = new QPushButton(tr("Refresh sources"), this);
  shareAudioCheck_ = new QCheckBox(tr("Share source audio"), this);
  sharedAudioVolumeSlider_ = new QSlider(Qt::Horizontal, this);
  sharedAudioVolumeSlider_->setObjectName(
      QStringLiteral("sharedAudioVolumeSlider"));
  sharedAudioVolumeSlider_->setAccessibleName(tr("Shared audio volume"));
  sharedAudioVolumeSlider_->setRange(0, 200);
  sharedAudioVolumeSlider_->setValue(100);
  sharedAudioVolumeValue_ = new QLabel(QStringLiteral("100%"), this);
  sharedAudioVolumeValue_->setMinimumWidth(48);
  excludeOwnProcessCheck_ = new QCheckBox(tr("Exclude Baker Lite audio"), this);
  shareAudioCheck_->setChecked(true);
  excludeOwnProcessCheck_->setChecked(true);

  resolutionCombo_ = new QComboBox(this);
  resolutionCombo_->addItems({
      QStringLiteral("854x480"),
      QStringLiteral("1280x720"),
      QStringLiteral("1920x1080"),
      QStringLiteral("2560x1440"),
  });
  fpsCombo_ = new QComboBox(this);
  fpsCombo_->addItems(
      {QStringLiteral("15"), QStringLiteral("30"), QStringLiteral("60")});
  bitrateCombo_ = new QComboBox(this);
  bitrateCombo_->setObjectName(QStringLiteral("streamBitrateCombo"));
  for (const int bitrate : {2000, 4000, 6000, 10000, 16000}) {
    bitrateCombo_->addItem(tr("%1 kbps").arg(bitrate), bitrate);
  }
  bitrateCombo_->setCurrentIndex(bitrateCombo_->findData(4000));
  codecCombo_ = new QComboBox(this);
  codecCombo_->addItems({
      QStringLiteral("H264"),
      QStringLiteral("VP8"),
      QStringLiteral("VP9"),
      QStringLiteral("AV1"),
  });

  auto *qualityRow = new QFormLayout();
  auto *sharedAudioVolumeWidget = new QWidget(this);
  auto *sharedAudioVolumeLayout = new QHBoxLayout(sharedAudioVolumeWidget);
  sharedAudioVolumeLayout->setContentsMargins(0, 0, 0, 0);
  sharedAudioVolumeLayout->addWidget(sharedAudioVolumeSlider_, 1);
  sharedAudioVolumeLayout->addWidget(sharedAudioVolumeValue_);
  qualityRow->addRow(tr("Shared audio volume"), sharedAudioVolumeWidget);
  qualityRow->addRow(tr("Resolution"), resolutionCombo_);
  qualityRow->addRow(tr("Frame rate"), fpsCombo_);
  qualityRow->addRow(tr("Bitrate"), bitrateCombo_);
  qualityRow->addRow(tr("Codec"), codecCombo_);

  auto *options = new QHBoxLayout();
  options->addWidget(refreshButton);
  options->addSpacing(12);
  options->addWidget(shareAudioCheck_);
  options->addWidget(excludeOwnProcessCheck_);
  options->addStretch();

  auto *layout = new QVBoxLayout(this);
  layout->addWidget(new QLabel(tr("Screens and windows"), this));
  layout->addWidget(sourceList_, 1);
  layout->addLayout(options);
  layout->addLayout(qualityRow);
  layout->addWidget(standardButtons(this, tr("Start sharing")));

  connect(refreshButton, &QPushButton::clicked, this,
          &ScreenSourceDialog::refreshRequested);
  connect(shareAudioCheck_, &QCheckBox::toggled, sharedAudioVolumeWidget,
          &QWidget::setEnabled);
  connect(sharedAudioVolumeSlider_, &QSlider::valueChanged, this,
          [this](const int value) {
            sharedAudioVolumeValue_->setText(QStringLiteral("%1%").arg(value));
          });
  connect(sourceList_, &QListWidget::itemDoubleClicked, this,
          [this] { accept(); });
}

void ScreenSourceDialog::setSources(const QList<CaptureSourceOption> &sources) {
  const QString previousId =
      sourceList_->currentItem()
          ? sourceList_->currentItem()->data(Qt::UserRole).toString()
          : QString();
  sources_ = sources;
  sourceList_->clear();
  for (const auto &source : sources_) {
    QIcon icon;
    if (!source.thumbnail.isNull()) {
      icon = QIcon(source.thumbnail);
    } else {
      icon = QIcon(source.kind == CaptureSourceKind::Camera
                       ? QStringLiteral(":/icons/camera.svg")
                       : QStringLiteral(":/icons/screen.svg"));
    }
    auto *item = new QListWidgetItem(icon, source.name, sourceList_);
    item->setData(Qt::UserRole, source.id);
    item->setTextAlignment(Qt::AlignHCenter);
    if (source.id == previousId) {
      sourceList_->setCurrentItem(item);
    }
  }
  if (sourceList_->currentRow() < 0 && !sources_.isEmpty()) {
    sourceList_->setCurrentRow(0);
  }
}

void ScreenSourceDialog::setSelection(const CaptureSelection &selection) {
  for (int row = 0; row < sourceList_->count(); ++row) {
    if (sourceList_->item(row)->data(Qt::UserRole).toString() ==
        selection.sourceId) {
      sourceList_->setCurrentRow(row);
      break;
    }
  }
  shareAudioCheck_->setChecked(selection.shareAudio);
  sharedAudioVolumeSlider_->setValue(selection.sharedAudioVolumePercent);
  excludeOwnProcessCheck_->setChecked(selection.excludeOwnProcess);
  resolutionCombo_->setCurrentText(selection.resolution);
  fpsCombo_->setCurrentText(QString::number(selection.framesPerSecond));
  const int bitrateIndex = bitrateCombo_->findData(selection.bitrateKbps);
  bitrateCombo_->setCurrentIndex(
      bitrateIndex >= 0 ? bitrateIndex : bitrateCombo_->findData(4000));
  codecCombo_->setCurrentText(selection.codec);
}

CaptureSelection ScreenSourceDialog::selection() const {
  const int row = sourceList_->currentRow();
  const CaptureSourceOption source = row >= 0 && row < sources_.size()
                                         ? sources_.at(row)
                                         : CaptureSourceOption{};
  return {
      source.id,
      source.kind,
      shareAudioCheck_->isChecked(),
      sharedAudioVolumeSlider_->value(),
      excludeOwnProcessCheck_->isChecked(),
      resolutionCombo_->currentText(),
      fpsCombo_->currentText().toInt(),
      bitrateCombo_->currentData().toInt(),
      codecCombo_->currentText(),
  };
}

void ScreenSourceDialog::accept() {
  if (sourceList_->currentRow() < 0) {
    QMessageBox::warning(this, tr("No source selected"),
                         tr("Choose a screen, window, or camera."));
    return;
  }
  QDialog::accept();
}

MusicSourceDialog::MusicSourceDialog(QWidget *parent) : QDialog(parent) {
  setWindowTitle(tr("Share application audio"));
  resize(590, 470);

  sourceList_ = new QListWidget(this);
  sourceList_->setObjectName(QStringLiteral("musicSourceList"));
  sourceList_->setSelectionMode(QAbstractItemView::SingleSelection);

  volumeSlider_ = new QSlider(Qt::Horizontal, this);
  volumeSlider_->setRange(0, 200);
  volumeSlider_->setValue(100);
  volumeValue_ = new QLabel(QStringLiteral("100%"), this);
  volumeValue_->setMinimumWidth(48);
  excludeOwnProcessCheck_ = new QCheckBox(tr("Exclude Baker Lite audio"), this);
  excludeOwnProcessCheck_->setChecked(true);
  auto *refreshButton = new QPushButton(tr("Refresh applications"), this);

  auto *volumeRow = new QHBoxLayout();
  volumeRow->addWidget(new QLabel(tr("Shared volume"), this));
  volumeRow->addWidget(volumeSlider_, 1);
  volumeRow->addWidget(volumeValue_);

  auto *actions = new QHBoxLayout();
  actions->addWidget(refreshButton);
  actions->addStretch();
  actions->addWidget(excludeOwnProcessCheck_);

  auto *layout = new QVBoxLayout(this);
  layout->addWidget(new QLabel(tr("Applications producing audio"), this));
  layout->addWidget(sourceList_, 1);
  layout->addLayout(volumeRow);
  layout->addLayout(actions);
  layout->addWidget(standardButtons(this, tr("Start sharing")));

  connect(refreshButton, &QPushButton::clicked, this,
          &MusicSourceDialog::refreshRequested);
  connect(volumeSlider_, &QSlider::valueChanged, this, [this](const int value) {
    volumeValue_->setText(QStringLiteral("%1%").arg(value));
  });
  connect(sourceList_, &QListWidget::itemDoubleClicked, this,
          [this] { accept(); });
}

void MusicSourceDialog::setSources(const QList<MusicSourceOption> &sources) {
  const QString previousId =
      sourceList_->currentItem()
          ? sourceList_->currentItem()->data(Qt::UserRole).toString()
          : QString();
  bool rebuild = sourceList_->count() != sources.size();
  if (!rebuild) {
    for (int row = 0; row < sources.size(); ++row) {
      if (sourceList_->item(row)->data(Qt::UserRole).toString() !=
          sources.at(row).id) {
        rebuild = true;
        break;
      }
    }
  }
  sources_ = sources;
  if (rebuild) {
    sourceList_->clear();
    for (const auto &source : sources_) {
      auto *item = new QListWidgetItem(sourceList_);
      item->setData(Qt::UserRole, source.id);
      item->setSizeHint(QSize(0, 44));
      auto *row = new QWidget(sourceList_);
      auto *name = new QLabel(row);
      name->setObjectName(QStringLiteral("musicSourceName"));
      name->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
      auto *level = new QProgressBar(row);
      level->setObjectName(QStringLiteral("musicSourceLevel"));
      level->setRange(0, 100);
      level->setFixedWidth(140);
      level->setFormat(tr("Live %p%"));
      auto *rowLayout = new QHBoxLayout(row);
      rowLayout->setContentsMargins(6, 3, 6, 3);
      rowLayout->addWidget(name, 1);
      rowLayout->addWidget(level);
      sourceList_->setItemWidget(item, row);
    }
  }
  for (int row = 0; row < sources_.size(); ++row) {
    const auto &source = sources_.at(row);
    QListWidgetItem *item = sourceList_->item(row);
    item->setData(Qt::UserRole, source.id);
    item->setToolTip(source.details);
    QWidget *rowWidget = sourceList_->itemWidget(item);
    auto *name =
        rowWidget != nullptr
            ? rowWidget->findChild<QLabel *>(QStringLiteral("musicSourceName"))
            : nullptr;
    auto *level = rowWidget != nullptr ? rowWidget->findChild<QProgressBar *>(
                                             QStringLiteral("musicSourceLevel"))
                                       : nullptr;
    if (name != nullptr) {
      name->setText(source.name);
      name->setToolTip(source.details);
    }
    if (level != nullptr) {
      level->setValue(qBound(0, source.peakLevelPercent, 100));
    }
    if (source.id == previousId) {
      sourceList_->setCurrentItem(item);
    }
  }
  if (sourceList_->currentRow() < 0 && !sources_.isEmpty()) {
    sourceList_->setCurrentRow(0);
  }
}

void MusicSourceDialog::setSelection(const MusicSourceSelection &selection) {
  for (int row = 0; row < sourceList_->count(); ++row) {
    if (sourceList_->item(row)->data(Qt::UserRole).toString() ==
        selection.sourceId) {
      sourceList_->setCurrentRow(row);
      break;
    }
  }
  volumeSlider_->setValue(selection.volumePercent);
  excludeOwnProcessCheck_->setChecked(selection.excludeOwnProcess);
}

MusicSourceSelection MusicSourceDialog::selection() const {
  const int row = sourceList_->currentRow();
  const QString sourceId =
      row >= 0 && row < sources_.size() ? sources_.at(row).id : QString();
  return {
      sourceId,
      volumeSlider_->value(),
      excludeOwnProcessCheck_->isChecked(),
  };
}

void MusicSourceDialog::accept() {
  if (sourceList_->currentRow() < 0) {
    QMessageBox::warning(this, tr("No application selected"),
                         tr("Choose an application that is producing audio."));
    return;
  }
  QDialog::accept();
}

} // namespace baker::lite::ui
