#pragma once

#include <QDateTime>
#include <QHash>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QUrl>

#include <optional>

namespace baker::update {

struct ReleaseInfo {
  QString version;
  QDateTime publishedAt;
  QString notes;
  bool current = false;
  bool prerelease = false;
};

struct UpdateManifest {
  int schemaVersion = 0;
  QString version;
  QUrl downloadUrl;
  QByteArray sha512Hex;
  QDateTime publishedAt;
  QString fileName;
};

class UpdateService final : public QObject {
  Q_OBJECT

 public:
  explicit UpdateService(QObject* parent = nullptr);

  void setRepository(const QString& owner, const QString& repository);
  void refreshCatalog();
  void downloadAndInstall(const QString& version);
  [[nodiscard]] QList<ReleaseInfo> releases() const;

 signals:
  void catalogReady(const QList<baker::update::ReleaseInfo>& releases);
  void catalogFailed(const QString& message);
  void downloadProgress(const QString& version, qint64 received,
                        qint64 total);
  void updateReady(const QString& version, const QString& installerPath);
  void updateFailed(const QString& version, const QString& message);

 private:
  void loadManifest(const QJsonObject& release, const QUrl& manifestUrl);
  void finishCatalogIfReady();
  void downloadInstaller(const UpdateManifest& manifest);
  static std::optional<UpdateManifest> parseManifest(
      const QJsonObject& object, QString* error);

  QNetworkAccessManager network_;
  QString owner_ = QStringLiteral("blockcat2333");
  QString repository_ =
      QStringLiteral("Baker-Self-Hosted-Voice-And-Live");
  QList<ReleaseInfo> releases_;
  QHash<QString, UpdateManifest> manifests_;
  int pendingManifests_ = 0;
  int catalogGeneration_ = 0;
};

}  // namespace baker::update

Q_DECLARE_METATYPE(baker::update::ReleaseInfo)
