#include "UpdateService.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>

#include <algorithm>

namespace baker::update {
namespace {

QString networkError(QNetworkReply* reply) {
  const QByteArray body = reply->readAll();
  const QJsonObject object = QJsonDocument::fromJson(body).object();
  const QString remote = object.value(QStringLiteral("message")).toString();
  return remote.isEmpty() ? reply->errorString() : remote;
}

}  // namespace

UpdateService::UpdateService(QObject* parent) : QObject(parent) {}

void UpdateService::setRepository(const QString& owner,
                                  const QString& repository) {
  if (!owner.trimmed().isEmpty()) {
    owner_ = owner.trimmed();
  }
  if (!repository.trimmed().isEmpty()) {
    repository_ = repository.trimmed();
  }
}

void UpdateService::refreshCatalog() {
  ++catalogGeneration_;
  const int generation = catalogGeneration_;
  releases_.clear();
  manifests_.clear();
  pendingManifests_ = 0;

  const QUrl url(QStringLiteral(
                     "https://api.github.com/repos/%1/%2/releases?per_page=100")
                     .arg(owner_, repository_));
  QNetworkRequest request(url);
  request.setRawHeader("Accept", "application/vnd.github+json");
  request.setRawHeader("User-Agent", "Baker-Lite");
  QNetworkReply* reply = network_.get(request);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply, generation] {
            reply->deleteLater();
            if (generation != catalogGeneration_) {
              return;
            }
            if (reply->error() != QNetworkReply::NoError) {
              emit catalogFailed(networkError(reply));
              return;
            }
            const QJsonArray releases =
                QJsonDocument::fromJson(reply->readAll()).array();
            for (const QJsonValue& value : releases) {
              const QJsonObject release = value.toObject();
              QUrl manifestUrl;
              for (const QJsonValue& assetValue :
                   release.value(QStringLiteral("assets")).toArray()) {
                const QJsonObject asset = assetValue.toObject();
                if (asset.value(QStringLiteral("name")).toString() ==
                    QStringLiteral("baker-lite-update.json")) {
                  manifestUrl = QUrl(
                      asset.value(QStringLiteral("browser_download_url"))
                          .toString());
                  break;
                }
              }
              if (!manifestUrl.isValid()) {
                continue;
              }
              ++pendingManifests_;
              loadManifest(release, manifestUrl);
            }
            finishCatalogIfReady();
          });
}

void UpdateService::downloadAndInstall(const QString& version) {
  const auto iterator = manifests_.constFind(version);
  if (iterator == manifests_.cend()) {
    emit updateFailed(
        version,
        QStringLiteral("This release has no Baker Lite update manifest."));
    return;
  }
  downloadInstaller(iterator.value());
}

QList<ReleaseInfo> UpdateService::releases() const { return releases_; }

void UpdateService::loadManifest(const QJsonObject& release,
                                 const QUrl& manifestUrl) {
  const int generation = catalogGeneration_;
  QNetworkRequest request(manifestUrl);
  request.setRawHeader("Accept", "application/json");
  request.setRawHeader("User-Agent", "Baker-Lite");
  QNetworkReply* reply = network_.get(request);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply, release, generation] {
            reply->deleteLater();
            if (generation != catalogGeneration_) {
              return;
            }
            --pendingManifests_;
            if (reply->error() == QNetworkReply::NoError) {
              QString error;
              const QJsonObject object =
                  QJsonDocument::fromJson(reply->readAll()).object();
              if (auto manifest = parseManifest(object, &error)) {
                ReleaseInfo info;
                info.version = manifest->version;
                info.publishedAt =
                    QDateTime::fromString(
                        release.value(QStringLiteral("published_at"))
                            .toString(),
                        Qt::ISODate);
                info.notes =
                    release.value(QStringLiteral("body")).toString();
                info.current =
                    info.version ==
                    QCoreApplication::applicationVersion();
                info.prerelease =
                    release.value(QStringLiteral("prerelease")).toBool();
                manifests_.insert(info.version, *manifest);
                releases_.append(std::move(info));
              }
            }
            finishCatalogIfReady();
          });
}

void UpdateService::finishCatalogIfReady() {
  if (pendingManifests_ != 0) {
    return;
  }
  std::sort(releases_.begin(), releases_.end(),
            [](const ReleaseInfo& left, const ReleaseInfo& right) {
              return left.publishedAt > right.publishedAt;
            });
  emit catalogReady(releases_);
}

void UpdateService::downloadInstaller(
    const UpdateManifest& manifest) {
  QNetworkRequest request(manifest.downloadUrl);
  request.setRawHeader("User-Agent", "Baker-Lite");
  QNetworkReply* reply = network_.get(request);
  connect(reply, &QNetworkReply::downloadProgress, this,
          [this, version = manifest.version](qint64 received,
                                             qint64 total) {
            emit downloadProgress(version, received, total);
          });
  connect(reply, &QNetworkReply::finished, this,
          [this, reply, manifest] {
            reply->deleteLater();
            if (reply->error() != QNetworkReply::NoError) {
              emit updateFailed(manifest.version, networkError(reply));
              return;
            }
            const QByteArray bytes = reply->readAll();
            const QByteArray digest =
                QCryptographicHash::hash(bytes,
                                         QCryptographicHash::Sha512)
                    .toHex();
            if (digest.compare(manifest.sha512Hex, Qt::CaseInsensitive) != 0) {
              emit updateFailed(
                  manifest.version,
                  QStringLiteral("Downloaded installer SHA-512 mismatch."));
              return;
            }

            const QString directory =
                QStandardPaths::writableLocation(
                    QStandardPaths::TempLocation) +
                QStringLiteral("/BakerLiteUpdate");
            if (!QDir().mkpath(directory)) {
              emit updateFailed(
                  manifest.version,
                  QStringLiteral("Unable to create the update directory."));
              return;
            }
            const QString path =
                QDir(directory).filePath(manifest.fileName);
            QSaveFile file(path);
            if (!file.open(QIODevice::WriteOnly) ||
                file.write(bytes) != bytes.size() || !file.commit()) {
              emit updateFailed(
                  manifest.version,
                  QStringLiteral("Unable to save the downloaded installer."));
              return;
            }
            emit updateReady(manifest.version, path);
            if (!QProcess::startDetached(path, {})) {
              emit updateFailed(
                  manifest.version,
                  QStringLiteral("Unable to launch the update installer."));
              return;
            }
            QCoreApplication::quit();
          });
}

std::optional<UpdateManifest> UpdateService::parseManifest(
    const QJsonObject& object, QString* error) {
  UpdateManifest manifest;
  manifest.schemaVersion =
      object.value(QStringLiteral("schemaVersion")).toInt();
  manifest.version =
      object.value(QStringLiteral("version")).toString();
  manifest.downloadUrl =
      QUrl(object.value(QStringLiteral("downloadUrl")).toString());
  manifest.sha512Hex =
      object.value(QStringLiteral("sha512")).toString().toLatin1();
  manifest.publishedAt = QDateTime::fromString(
      object.value(QStringLiteral("publishedAt")).toString(), Qt::ISODate);
  manifest.fileName =
      object.value(QStringLiteral("fileName")).toString();

  QString message;
  if (manifest.schemaVersion != 1) {
    message = QStringLiteral("Unsupported update manifest schema.");
  } else if (manifest.version.isEmpty()) {
    message = QStringLiteral("Update manifest version is missing.");
  } else if (!manifest.downloadUrl.isValid() ||
             manifest.downloadUrl.scheme() != QStringLiteral("https")) {
    message = QStringLiteral("Update download URL must use HTTPS.");
  } else if (manifest.sha512Hex.size() != 128) {
    message = QStringLiteral("Update manifest SHA-512 is invalid.");
  } else if (manifest.fileName.isEmpty() ||
             QFileInfo(manifest.fileName).fileName() !=
                 manifest.fileName) {
    message = QStringLiteral("Update installer file name is invalid.");
  }
  if (!message.isEmpty()) {
    if (error) {
      *error = message;
    }
    return std::nullopt;
  }
  return manifest;
}

}  // namespace baker::update
