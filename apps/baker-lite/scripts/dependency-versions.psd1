@{
    QtVersion                         = '6.8.3'
    QtArchitecture                    = 'win64_msvc2022_64'
    # Qt Tools and Qt SVG are part of the standard desktop archives for 6.8.3.
    # Only WebSockets is exposed by aqt as an optional module.
    QtModules                         = @('qtwebsockets')
    AqtInstallVersion                 = '3.3.0'
    NsisVersion                       = '3.12'
    NsisArchiveUrl                    = 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.12/nsis-3.12.zip/download'
    NsisArchiveSha256                 = '56581F90DB321581C5381193D796FFFCF2D24B2F8FED2160A6C6A3BAA67F2C4F'

    DepotToolsRepository              = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git'
    DepotToolsCommit                  = 'f394ab2c993283e94680ca13db98b99927868e98'

    WebRtcRepository                  = 'https://webrtc.googlesource.com/src.git'
    WebRtcMilestone                   = 'm140'
    WebRtcBranch                      = 'branch-heads/7339'
    WebRtcCommit                      = '36ea4535a500ac137dbf1f577ce40dc1aaa774ef'

    LibMediasoupClientRepository      = 'https://github.com/versatica/libmediasoupclient.git'
    LibMediasoupClientVersion         = '3.5.0'
    LibMediasoupClientTagObject       = '643a09a6c4244618330c0e75531ace5bbc1bda0d'
    LibMediasoupClientCommit          = 'e345bc4720b8d7cf679e95bde93913969c9cd01d'

    LibSdpTransformRepository         = 'https://github.com/ibc/libsdptransform.git'
    LibSdpTransformVersion            = '1.2.10'
    LibSdpTransformCommit             = 'e33aba7005c563286b19a8c90b9520a4384cc259'
}
