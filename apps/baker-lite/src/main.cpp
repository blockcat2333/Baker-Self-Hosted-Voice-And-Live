#include "app/ApplicationController.hpp"
#include "ui/MainWindow.h"

#include <QApplication>
#include <QCoreApplication>

int main(int argc, char* argv[]) {
  QApplication application(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("Baker"));
  QCoreApplication::setOrganizationDomain(
      QStringLiteral("blockcat2333.github.io"));
  QCoreApplication::setApplicationName(QStringLiteral("Baker Lite"));
  QCoreApplication::setApplicationVersion(
      QStringLiteral(BAKER_LITE_VERSION));

  baker::lite::ui::MainWindow window;
  baker::lite::app::ApplicationController controller(&window);
  window.show();
  controller.start();
  return application.exec();
}
