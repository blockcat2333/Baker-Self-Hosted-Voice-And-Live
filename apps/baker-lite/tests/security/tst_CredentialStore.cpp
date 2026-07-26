#include "../../src/security/CredentialStore.h"

#include <QtTest>
#include <QUuid>

using baker::security::CredentialStore;

namespace {

class CredentialCleanup final {
public:
    CredentialCleanup(CredentialStore& store, QString key)
        : store_(store)
        , key_(std::move(key))
    {
    }

    ~CredentialCleanup()
    {
        QString error;
        (void)store_.remove(key_, &error);
    }

private:
    CredentialStore& store_;
    QString key_;
};

} // namespace

class CredentialStoreTest final : public QObject {
    Q_OBJECT

private slots:
    void rejectsInvalidInput();
    void roundTripsAndRemovesCredential();
};

void CredentialStoreTest::rejectsInvalidInput()
{
    CredentialStore store(QStringLiteral("BakerLiteCredentialStoreTest"));
    QString error;

    QVERIFY(!store.write(QString(), QStringLiteral("user"), QByteArrayLiteral("secret"), &error));
    QVERIFY(!error.isEmpty());

    error.clear();
    QVERIFY(!store.write(QStringLiteral("key"), QStringLiteral("user"), QByteArray(), &error));
    QVERIFY(!error.isEmpty());
}

void CredentialStoreTest::roundTripsAndRemovesCredential()
{
    const QString uniqueId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    CredentialStore store(QStringLiteral("BakerLiteCredentialStoreTest-%1").arg(uniqueId));
    const QString key = QStringLiteral("session:https://127.0.0.1/%1").arg(uniqueId);
    CredentialCleanup cleanup(store, key);
    QString error;

    QVERIFY2(store.isPersistent(), "Windows Credential Manager must be available.");
    QVERIFY2(
        store.write(
            key,
            QStringLiteral("test@example.invalid"),
            QByteArrayLiteral("synthetic-refresh-token"),
            &error),
        qPrintable(error));

    const auto credential = store.read(key, &error);
    QVERIFY2(credential.has_value(), qPrintable(error));
    QCOMPARE(credential->username, QStringLiteral("test@example.invalid"));
    QCOMPARE(credential->secret, QByteArrayLiteral("synthetic-refresh-token"));

    QVERIFY2(store.remove(key, &error), qPrintable(error));
    const auto removedCredential = store.read(key, &error);
    QVERIFY(!removedCredential.has_value());
    QVERIFY(error.isEmpty());
}

QTEST_MAIN(CredentialStoreTest)

#include "tst_CredentialStore.moc"
