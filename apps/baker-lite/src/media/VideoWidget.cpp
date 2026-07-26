#include "VideoWidget.hpp"

#include <QMutexLocker>
#include <QPainter>

namespace baker::media {

VideoWidget::VideoWidget(QWidget* parent) : QOpenGLWidget(parent) {
  setMinimumSize(320, 180);
  setAutoFillBackground(false);
}

void VideoWidget::setFrame(const QImage& frame) {
  {
    QMutexLocker lock(&frameMutex_);
    frame_ = frame;
  }
  update();
}

void VideoWidget::paintGL() {
  QImage frame;
  {
    QMutexLocker lock(&frameMutex_);
    frame = frame_;
  }

  QPainter painter(this);
  painter.fillRect(rect(), QColor(12, 14, 18));
  if (frame.isNull()) {
    painter.setPen(QColor(150, 156, 166));
    painter.drawText(rect(), Qt::AlignCenter, tr("Waiting for video..."));
    return;
  }

  const QSize targetSize = frame.size().scaled(size(), Qt::KeepAspectRatio);
  const QRect target((width() - targetSize.width()) / 2,
                     (height() - targetSize.height()) / 2,
                     targetSize.width(), targetSize.height());
  painter.drawImage(target, frame);
}

}  // namespace baker::media
