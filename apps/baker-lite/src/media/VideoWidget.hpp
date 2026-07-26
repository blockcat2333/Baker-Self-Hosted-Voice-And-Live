#pragma once

#include <QImage>
#include <QMutex>
#include <QOpenGLWidget>

namespace baker::media {

class VideoWidget final : public QOpenGLWidget {
  Q_OBJECT

 public:
  explicit VideoWidget(QWidget* parent = nullptr);

 public slots:
  void setFrame(const QImage& frame);

 protected:
  void paintGL() override;

 private:
  QMutex frameMutex_;
  QImage frame_;
};

}  // namespace baker::media
