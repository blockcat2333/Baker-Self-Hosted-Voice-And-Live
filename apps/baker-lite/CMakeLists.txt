cmake_minimum_required(VERSION 3.24)

project(
    BakerLite
    VERSION 1.1.2
    DESCRIPTION "Native lightweight Baker client"
    HOMEPAGE_URL "https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live"
    LANGUAGES CXX
)

# CMake project versions are numeric-only; the public client version may use
# Baker's lettered client-release suffix.
set(BAKER_LITE_VERSION "1.1.2a")
set(BAKER_LITE_WINDOWS_VERSION_REVISION 1)

if(NOT WIN32)
    message(FATAL_ERROR "Baker Lite currently supports Windows x64 only.")
endif()

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "Baker Lite must be configured with a 64-bit toolchain.")
endif()

enable_language(RC)

option(BAKER_LITE_WITH_WEBRTC "Build native P2P/SFU media support" OFF)
option(BAKER_LITE_BUILD_TESTS "Build Baker Lite unit tests" ON)
option(BAKER_LITE_WARNINGS_AS_ERRORS "Treat Baker Lite warnings as errors" OFF)

set(
    BAKER_LITE_DEPS_ROOT
    "$ENV{BAKER_LITE_DEPS_ROOT}"
    CACHE PATH
    "External dependency cache populated by scripts/bootstrap-dependencies.ps1"
)
if(NOT BAKER_LITE_DEPS_ROOT)
    if(DEFINED ENV{LOCALAPPDATA})
        file(TO_CMAKE_PATH "$ENV{LOCALAPPDATA}/BakerLite/deps" BAKER_LITE_DEPS_ROOT)
    else()
        set(BAKER_LITE_DEPS_ROOT "${CMAKE_BINARY_DIR}/dependency-cache")
    endif()
    set(BAKER_LITE_DEPS_ROOT "${BAKER_LITE_DEPS_ROOT}" CACHE PATH "" FORCE)
endif()

set(
    BAKER_LITE_QT_ROOT
    "$ENV{BAKER_LITE_QT_ROOT}"
    CACHE PATH
    "Qt 6.8.3 msvc2022_64 prefix"
)
if(NOT BAKER_LITE_QT_ROOT)
    set(
        BAKER_LITE_QT_ROOT
        "${BAKER_LITE_DEPS_ROOT}/qt/6.8.3/msvc2022_64"
        CACHE PATH
        "" FORCE
    )
endif()
list(PREPEND CMAKE_PREFIX_PATH "${BAKER_LITE_QT_ROOT}")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")

find_package(
    Qt6 6.8.3 EXACT
    REQUIRED COMPONENTS
        Core
        Gui
        Widgets
        Network
        WebSockets
        Svg
        Concurrent
        OpenGLWidgets
        LinguistTools
)

include(cmake/BakerLiteDependencies.cmake)

file(
    GLOB_RECURSE BAKER_LITE_ALL_SOURCES
    CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.hpp"
)

set(BAKER_LITE_MAIN_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp")
if(NOT EXISTS "${BAKER_LITE_MAIN_SOURCE}")
    message(FATAL_ERROR "Missing Baker Lite entry point: ${BAKER_LITE_MAIN_SOURCE}")
endif()

set(BAKER_LITE_CORE_SOURCES ${BAKER_LITE_ALL_SOURCES})
list(REMOVE_ITEM BAKER_LITE_CORE_SOURCES "${BAKER_LITE_MAIN_SOURCE}")

add_library(baker-lite-core STATIC ${BAKER_LITE_CORE_SOURCES})
add_library(BakerLite::Core ALIAS baker-lite-core)

target_include_directories(
    baker-lite-core
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/src"
)
target_link_libraries(
    baker-lite-core
    PUBLIC
        Qt6::Core
        Qt6::Gui
        Qt6::Widgets
        Qt6::Network
        Qt6::WebSockets
        Qt6::Svg
        Qt6::Concurrent
        Qt6::OpenGLWidgets
        BakerLite::MediaDependencies
    PRIVATE
        Advapi32
        Avrt
        Mmdevapi
        Winmm
)
target_compile_definitions(
    baker-lite-core
    PUBLIC
        BAKER_LITE_VERSION="${BAKER_LITE_VERSION}"
        $<$<BOOL:${BAKER_LITE_WITH_WEBRTC}>:BAKER_LITE_WITH_WEBRTC=1>
        NOMINMAX
        UNICODE
        _UNICODE
        WIN32_LEAN_AND_MEAN
)

if(MSVC)
    target_compile_options(
        baker-lite-core
        PRIVATE
            /EHsc
            /permissive-
            /utf-8
            /W4
            /Zc:__cplusplus
            $<$<BOOL:${BAKER_LITE_WARNINGS_AS_ERRORS}>:/WX>
    )
endif()

configure_file(
    packaging/BakerLite.rc.in
    "${CMAKE_CURRENT_BINARY_DIR}/generated/BakerLite.rc"
    @ONLY
)

file(
    GLOB_RECURSE BAKER_LITE_RESOURCES
    CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/*.qrc"
)

qt_add_executable(
    baker-lite
    WIN32
    MANUAL_FINALIZATION
    "${BAKER_LITE_MAIN_SOURCE}"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/BakerLite.rc"
    ${BAKER_LITE_RESOURCES}
)
target_link_libraries(baker-lite PRIVATE BakerLite::Core)
set_target_properties(
    baker-lite
    PROPERTIES
        OUTPUT_NAME "Baker Lite"
        DEBUG_POSTFIX "d"
        WIN32_EXECUTABLE TRUE
)

file(
    GLOB BAKER_LITE_TRANSLATIONS
    CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/translations/*.ts"
)
if(BAKER_LITE_TRANSLATIONS)
    qt_add_translations(
        baker-lite
        TS_FILES ${BAKER_LITE_TRANSLATIONS}
        RESOURCE_PREFIX "/i18n"
        LUPDATE_OPTIONS -no-obsolete
    )
endif()

qt_finalize_executable(baker-lite)

include(GNUInstallDirs)
install(
    TARGETS baker-lite
    RUNTIME DESTINATION .
    COMPONENT Runtime
)
install(
    FILES
        "${CMAKE_CURRENT_SOURCE_DIR}/../../LICENSE"
        "${CMAKE_CURRENT_SOURCE_DIR}/LICENSES/THIRD_PARTY_NOTICES.md"
    DESTINATION licenses
    COMPONENT Runtime
)
install(
    DIRECTORY "${BAKER_LITE_QT_ROOT}/LICENSES/"
    DESTINATION licenses/qt
    COMPONENT Runtime
    OPTIONAL
)
if(BAKER_LITE_WITH_WEBRTC)
    foreach(_license_file IN ITEMS LICENSE PATENTS AUTHORS)
        if(EXISTS "${BAKER_LITE_WEBRTC_SOURCE}/${_license_file}")
            install(
                FILES "${BAKER_LITE_WEBRTC_SOURCE}/${_license_file}"
                DESTINATION licenses/libwebrtc
                COMPONENT Runtime
            )
        endif()
    endforeach()
    if(EXISTS "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}/LICENSE")
        install(
            FILES "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}/LICENSE"
            DESTINATION licenses/libmediasoupclient
            COMPONENT Runtime
        )
    endif()
endif()

include(cmake/BakerLitePackaging.cmake)

if(BAKER_LITE_BUILD_TESTS)
    include(CTest)
    file(
        GLOB_RECURSE BAKER_LITE_TEST_SOURCES
        CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp"
    )
    if(BAKER_LITE_TEST_SOURCES)
        find_package(Qt6 6.8.3 EXACT REQUIRED COMPONENTS Test)
        foreach(_test_source IN LISTS BAKER_LITE_TEST_SOURCES)
            file(RELATIVE_PATH _test_relative "${CMAKE_CURRENT_SOURCE_DIR}/tests" "${_test_source}")
            string(MAKE_C_IDENTIFIER "${_test_relative}" _test_identifier)
            set(_test_target "baker-lite-test-${_test_identifier}")
            set(_test_resources)
            if(_test_relative MATCHES "^ui/")
                set(_test_resources ${BAKER_LITE_RESOURCES})
            endif()
            qt_add_executable(
                "${_test_target}"
                "${_test_source}"
                ${_test_resources}
            )
            target_link_libraries("${_test_target}" PRIVATE BakerLite::Core Qt6::Test)
            add_test(NAME "${_test_target}" COMMAND "${_test_target}")
            set_tests_properties(
                "${_test_target}"
                PROPERTIES
                    ENVIRONMENT_MODIFICATION
                        "PATH=path_list_prepend:${BAKER_LITE_QT_ROOT}/bin"
            )
        endforeach()
    endif()
endif()
