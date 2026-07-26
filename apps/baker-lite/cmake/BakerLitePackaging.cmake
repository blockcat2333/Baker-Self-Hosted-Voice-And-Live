if(TARGET Qt6::windeployqt)
    get_target_property(_baker_lite_windeployqt Qt6::windeployqt IMPORTED_LOCATION)
endif()
if(NOT _baker_lite_windeployqt)
    find_program(
        _baker_lite_windeployqt
        NAMES windeployqt windeployqt.exe
        HINTS "${BAKER_LITE_QT_ROOT}/bin"
        NO_DEFAULT_PATH
        REQUIRED
    )
endif()

set(BAKER_LITE_WINDEPLOYQT "${_baker_lite_windeployqt}")
configure_file(
    "${CMAKE_CURRENT_LIST_DIR}/DeployQt.cmake.in"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/DeployQt.cmake"
    @ONLY
)
install(
    SCRIPT "${CMAKE_CURRENT_BINARY_DIR}/generated/DeployQt.cmake"
    COMPONENT Runtime
)

set(CPACK_GENERATOR "NSIS")
set(CPACK_PACKAGE_NAME "Baker Lite")
set(CPACK_PACKAGE_VENDOR "Baker")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "${PROJECT_DESCRIPTION}")
set(CPACK_PACKAGE_HOMEPAGE_URL "${PROJECT_HOMEPAGE_URL}")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "Baker Lite")
set(CPACK_PACKAGE_INSTALL_REGISTRY_KEY "BakerLite")
set(CPACK_PACKAGE_FILE_NAME "Baker-Lite-Setup-${PROJECT_VERSION}-x64")
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/../../LICENSE")
set(CPACK_MONOLITHIC_INSTALL ON)

set(CPACK_NSIS_PACKAGE_NAME "Baker Lite")
set(CPACK_NSIS_DISPLAY_NAME "Baker Lite")
set(CPACK_NSIS_UNINSTALL_NAME "Uninstall Baker Lite")
set(CPACK_NSIS_INSTALLED_ICON_NAME "Baker Lite.exe")
set(CPACK_NSIS_MUI_ICON
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/icons/baker-lite.ico"
)
set(CPACK_NSIS_MUI_UNIICON
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/icons/baker-lite.ico"
)
set(CPACK_NSIS_INSTALL_ROOT "$LOCALAPPDATA")
set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
set(CPACK_NSIS_MODIFY_PATH OFF)
set(CPACK_NSIS_CREATE_ICONS_EXTRA
    "CreateDirectory '$SMPROGRAMS\\\\Baker Lite'\nCreateShortCut '$SMPROGRAMS\\\\Baker Lite\\\\Baker Lite.lnk' '$INSTDIR\\\\Baker Lite.exe'\nCreateShortCut '$DESKTOP\\\\Baker Lite.lnk' '$INSTDIR\\\\Baker Lite.exe'"
)
set(CPACK_NSIS_DELETE_ICONS_EXTRA
    "Delete '$SMPROGRAMS\\\\Baker Lite\\\\Baker Lite.lnk'\nRMDir '$SMPROGRAMS\\\\Baker Lite'\nDelete '$DESKTOP\\\\Baker Lite.lnk'"
)

list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/packaging")
include(CPack)
