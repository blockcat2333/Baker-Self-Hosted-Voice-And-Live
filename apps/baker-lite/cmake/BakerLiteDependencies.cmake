add_library(baker-lite-media-dependencies INTERFACE)
add_library(BakerLite::MediaDependencies ALIAS baker-lite-media-dependencies)

if(NOT BAKER_LITE_WITH_WEBRTC)
    message(STATUS "Baker Lite media backend: disabled (shell build)")
    return()
endif()

set(BAKER_LITE_LIBMEDIASOUPCLIENT_VERSION "3.5.0")
set(BAKER_LITE_LIBMEDIASOUPCLIENT_TAG_OBJECT "643a09a6c4244618330c0e75531ace5bbc1bda0d")
set(BAKER_LITE_LIBMEDIASOUPCLIENT_COMMIT "e345bc4720b8d7cf679e95bde93913969c9cd01d")
set(BAKER_LITE_WEBRTC_COMMIT "36ea4535a500ac137dbf1f577ce40dc1aaa774ef")

set(
    BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE
    "${BAKER_LITE_DEPS_ROOT}/libmediasoupclient/3.5.0/source"
    CACHE PATH
    "Pinned libmediasoupclient source directory"
)
set(
    BAKER_LITE_LIBSDPTRANSFORM_SOURCE
    "${BAKER_LITE_DEPS_ROOT}/libsdptransform/1.2.10/source"
    CACHE PATH
    "Pinned libsdptransform source directory"
)
set(
    BAKER_LITE_WEBRTC_SOURCE
    "${BAKER_LITE_DEPS_ROOT}/webrtc/m140/src"
    CACHE PATH
    "Pinned libwebrtc source directory"
)
set(
    BAKER_LITE_WEBRTC_BINARY_PATH
    "${BAKER_LITE_WEBRTC_SOURCE}/out/baker-lite/obj"
    CACHE PATH
    "Directory containing libwebrtc.lib"
)

foreach(_required_path IN ITEMS
    "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}/CMakeLists.txt"
    "${BAKER_LITE_LIBSDPTRANSFORM_SOURCE}/CMakeLists.txt"
    "${BAKER_LITE_WEBRTC_SOURCE}/api/peer_connection_interface.h"
    "${BAKER_LITE_WEBRTC_BINARY_PATH}/libwebrtc.lib"
)
    if(NOT EXISTS "${_required_path}")
        message(
            FATAL_ERROR
            "Missing native media dependency: ${_required_path}\n"
            "Run scripts/bootstrap-dependencies.ps1 -Component All first."
        )
    endif()
endforeach()

function(baker_lite_verify_git_revision repository expected_revision label)
    execute_process(
        COMMAND git -C "${repository}" rev-parse HEAD
        OUTPUT_VARIABLE _actual_revision
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE _git_result
    )
    if(NOT _git_result EQUAL 0)
        message(FATAL_ERROR "Cannot inspect ${label} checkout at ${repository}")
    endif()
    if(NOT _actual_revision STREQUAL expected_revision)
        message(
            FATAL_ERROR
            "${label} revision mismatch: expected ${expected_revision}, got ${_actual_revision}.\n"
            "Re-run scripts/bootstrap-dependencies.ps1 for the pinned checkout."
        )
    endif()
endfunction()

baker_lite_verify_git_revision(
    "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}"
    "${BAKER_LITE_LIBMEDIASOUPCLIENT_COMMIT}"
    "libmediasoupclient"
)
baker_lite_verify_git_revision(
    "${BAKER_LITE_WEBRTC_SOURCE}"
    "${BAKER_LITE_WEBRTC_COMMIT}"
    "libwebrtc"
)

set(LIBWEBRTC_INCLUDE_PATH "${BAKER_LITE_WEBRTC_SOURCE}" CACHE PATH "" FORCE)
set(LIBWEBRTC_BINARY_PATH "${BAKER_LITE_WEBRTC_BINARY_PATH}" CACHE PATH "" FORCE)
set(MEDIASOUPCLIENT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(MEDIASOUPCLIENT_LOG_DEV OFF CACHE BOOL "" FORCE)
set(MEDIASOUPCLIENT_LOG_TRACE OFF CACHE BOOL "" FORCE)
# libsdptransform 1.2.10 predates CMake's removal of compatibility modes.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)
set(
    FETCHCONTENT_SOURCE_DIR_LIBSDPTRANSFORM
    "${BAKER_LITE_LIBSDPTRANSFORM_SOURCE}"
    CACHE PATH
    "" FORCE
)
set(FETCHCONTENT_FULLY_DISCONNECTED ON)

add_subdirectory(
    "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}"
    "${CMAKE_CURRENT_BINARY_DIR}/_deps/libmediasoupclient"
    EXCLUDE_FROM_ALL
)

target_include_directories(
    baker-lite-media-dependencies
    INTERFACE
        "${BAKER_LITE_LIBMEDIASOUPCLIENT_SOURCE}/include"
        "${BAKER_LITE_WEBRTC_SOURCE}/third_party/libyuv/include"
)

target_link_libraries(
    baker-lite-media-dependencies
    INTERFACE
        mediasoupclient
        Advapi32
        Bcrypt
        Crypt32
        D3D11
        Dmoguids
        Dwmapi
        Dxgi
        Iphlpapi
        Msdmo
        Ole32
        OleAut32
        Secur32
        Shcore
        Shlwapi
        Strmiids
        User32
        Version
        Winmm
        Wmcodecdspuuid
        Ws2_32
)

message(STATUS "Baker Lite media backend: libmediasoupclient ${BAKER_LITE_LIBMEDIASOUPCLIENT_VERSION} + libwebrtc m140")
