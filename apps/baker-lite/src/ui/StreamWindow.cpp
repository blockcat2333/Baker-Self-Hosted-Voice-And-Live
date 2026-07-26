#include "ui/StreamWindow.h"

#include <QAction>
#include <QCloseEvent>
#include <QIcon>
#include <QKeyEvent>
#include <QLabel>
#include <QSignalBlocker>
#include <QSlider>
#include <QStatusBar>
#include <QToolBar>
#include <QVBoxLayout>
#include <QWidget>

#include <utility>

namespace baker::lite::ui {

StreamWindow::StreamWindow(QString streamId, QWidget* parent)
    : QMainWindow(parent), streamId_(std::move(streamId)) {
    setAttribute(Qt::WA_DeleteOnClose);
    setObjectName(QStringLiteral("streamWindow"));
    resize(960, 600);
    setWindowTitle(tr("Live stream"));

    auto* toolbar = addToolBar(tr("Stream controls"));
    toolbar->setObjectName(QStringLiteral("streamControlsToolBar"));
    toolbar->setMovable(false);
    toolbar->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);

    fullScreenAction_ = toolbar->addAction(
        QIcon(QStringLiteral(":/icons/fullscreen.svg")),
        tr("Full screen"));
    connect(fullScreenAction_, &QAction::triggered, this, &StreamWindow::toggleFullScreen);

    toolbar->addSeparator();
    muteAction_ = toolbar->addAction(
        QIcon(QStringLiteral(":/icons/speaker.svg")),
        tr("Mute"));
    muteAction_->setCheckable(true);
    connect(muteAction_, &QAction::toggled, this, [this](const bool muted) {
        emit muteChanged(streamId_, muted);
    });

    volumeSlider_ = new QSlider(Qt::Horizontal, toolbar);
    volumeSlider_->setAccessibleName(tr("Stream volume"));
    volumeSlider_->setRange(0, 200);
    volumeSlider_->setValue(100);
    volumeSlider_->setFixedWidth(120);
    toolbar->addWidget(volumeSlider_);
    connect(volumeSlider_, &QSlider::valueChanged, this, [this](const int value) {
        emit volumeChanged(streamId_, value);
    });

    videoHost_ = new QWidget(this);
    videoHost_->setObjectName(QStringLiteral("streamVideoHost"));
    videoLayout_ = new QVBoxLayout(videoHost_);
    videoLayout_->setContentsMargins(0, 0, 0, 0);

    placeholder_ = new QLabel(tr("Waiting for video frames…"), videoHost_);
    placeholder_->setObjectName(QStringLiteral("streamPlaceholder"));
    placeholder_->setAlignment(Qt::AlignCenter);
    videoLayout_->addWidget(placeholder_);
    setCentralWidget(videoHost_);

    statusLabel_ = new QLabel(tr("Connecting…"), this);
    statusLabel_->setObjectName(QStringLiteral("streamStatusLabel"));
    statusBar()->addPermanentWidget(statusLabel_, 1);
}

StreamWindow::~StreamWindow() = default;

QString StreamWindow::streamId() const {
    return streamId_;
}

QWidget* StreamWindow::videoWidget() const {
    return videoWidget_;
}

QWidget* StreamWindow::takeVideoWidget() {
    QWidget* widget = videoWidget_;
    if (widget != nullptr) {
        videoLayout_->removeWidget(widget);
        widget->setParent(nullptr);
        videoWidget_.clear();
        placeholder_->show();
    }
    return widget;
}

void StreamWindow::setVideoWidget(QWidget* videoWidget) {
    if (videoWidget_ == videoWidget) {
        return;
    }
    if (videoWidget_ != nullptr) {
        videoLayout_->removeWidget(videoWidget_);
        videoWidget_->setParent(nullptr);
    }
    videoWidget_ = videoWidget;
    if (videoWidget_ != nullptr) {
        placeholder_->hide();
        videoWidget_->setParent(videoHost_);
        videoLayout_->addWidget(videoWidget_);
        videoWidget_->show();
    } else {
        placeholder_->show();
    }
}

void StreamWindow::setStreamTitle(const QString& title) {
    setWindowTitle(title.isEmpty() ? tr("Live stream") : title);
}

void StreamWindow::setStreamStatus(const QString& status) {
    statusLabel_->setText(status);
}

void StreamWindow::setMuted(const bool muted) {
    const QSignalBlocker blocker(muteAction_);
    muteAction_->setChecked(muted);
}

void StreamWindow::setVolumePercent(const int volumePercent) {
    const QSignalBlocker blocker(volumeSlider_);
    volumeSlider_->setValue(qBound(0, volumePercent, 200));
}

void StreamWindow::toggleFullScreen() {
    if (isFullScreen()) {
        showNormal();
    } else {
        showFullScreen();
    }
    updateFullScreenAction();
    emit fullScreenChanged(streamId_, isFullScreen());
}

void StreamWindow::closeEvent(QCloseEvent* event) {
    if (!closeEmitted_) {
        closeEmitted_ = true;
        emit closeRequested(streamId_);
    }
    QMainWindow::closeEvent(event);
}

void StreamWindow::keyPressEvent(QKeyEvent* event) {
    if (event->key() == Qt::Key_Escape && isFullScreen()) {
        toggleFullScreen();
        event->accept();
        return;
    }
    QMainWindow::keyPressEvent(event);
}

void StreamWindow::updateFullScreenAction() {
    fullScreenAction_->setText(isFullScreen() ? tr("Exit full screen") : tr("Full screen"));
}

}  // namespace baker::lite::ui
