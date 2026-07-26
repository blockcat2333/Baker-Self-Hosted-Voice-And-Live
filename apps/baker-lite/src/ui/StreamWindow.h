#pragma once

#include <QMainWindow>
#include <QPointer>
#include <QString>

class QAction;
class QLabel;
class QSlider;
class QToolBar;
class QVBoxLayout;
class QWidget;

namespace baker::lite::ui {

class StreamWindow final : public QMainWindow {
    Q_OBJECT

public:
    explicit StreamWindow(QString streamId, QWidget* parent = nullptr);
    ~StreamWindow() override;

    [[nodiscard]] QString streamId() const;
    [[nodiscard]] QWidget* videoWidget() const;
    [[nodiscard]] QWidget* takeVideoWidget();

public slots:
    void setVideoWidget(QWidget* videoWidget);
    void setStreamTitle(const QString& title);
    void setStreamStatus(const QString& status);
    void setMuted(bool muted);
    void setVolumePercent(int volumePercent);
    void toggleFullScreen();

signals:
    void closeRequested(const QString& streamId);
    void muteChanged(const QString& streamId, bool muted);
    void volumeChanged(const QString& streamId, int volumePercent);
    void fullScreenChanged(const QString& streamId, bool fullScreen);

protected:
    void closeEvent(QCloseEvent* event) override;
    void keyPressEvent(QKeyEvent* event) override;

private:
    void updateFullScreenAction();

    QString streamId_;
    QPointer<QWidget> videoWidget_;
    QWidget* videoHost_ = nullptr;
    QVBoxLayout* videoLayout_ = nullptr;
    QLabel* placeholder_ = nullptr;
    QLabel* statusLabel_ = nullptr;
    QAction* fullScreenAction_ = nullptr;
    QAction* muteAction_ = nullptr;
    QSlider* volumeSlider_ = nullptr;
    bool closeEmitted_ = false;
};

}  // namespace baker::lite::ui
