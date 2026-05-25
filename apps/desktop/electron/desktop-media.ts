export const desktopMediaCapturePatchScript = String.raw`
(() => {
  const marker = '__bakerDesktopMediaCapturePatchInstalled';
  if (globalThis[marker]) {
    return;
  }

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return;
  }

  Object.defineProperty(globalThis, marker, {
    configurable: true,
    value: true,
  });

  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

  function getDesktopVideoConstraints(constraints) {
    if (!constraints || typeof constraints !== 'object') {
      return null;
    }

    const video = constraints.video;
    if (!video || typeof video !== 'object') {
      return null;
    }

    const mandatory = video.mandatory;
    if (!mandatory || mandatory.chromeMediaSource !== 'desktop' || typeof mandatory.chromeMediaSourceId !== 'string') {
      return null;
    }

    return video;
  }

  function buildDesktopCaptureConstraints(constraints, includeAudio) {
    const desktopVideoConstraints = getDesktopVideoConstraints(constraints);
    if (!desktopVideoConstraints) {
      return constraints;
    }

    return {
      audio: includeAudio ? constraints.audio : false,
      video: {
        mandatory: {
          ...desktopVideoConstraints.mandatory,
        },
      },
    };
  }

  function getLiveVideoTracks(stream) {
    if (!stream || typeof stream.getVideoTracks !== 'function') {
      return [];
    }

    return stream.getVideoTracks().filter((track) => track.readyState !== 'ended');
  }

  function getLiveAudioTracks(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') {
      return [];
    }

    return stream.getAudioTracks().filter((track) => track.readyState !== 'ended');
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') {
      return;
    }

    for (const track of stream.getTracks()) {
      if (typeof track.stop === 'function') {
        track.stop();
      }
    }
  }

  mediaDevices.getUserMedia = async (constraints) => {
    const desktopVideoConstraints = getDesktopVideoConstraints(constraints);
    if (!desktopVideoConstraints) {
      return originalGetUserMedia(constraints);
    }

    const firstStream = await originalGetUserMedia(buildDesktopCaptureConstraints(constraints, true));
    if (getLiveVideoTracks(firstStream).length > 0) {
      return firstStream;
    }

    let videoOnlyStream = null;
    try {
      videoOnlyStream = await originalGetUserMedia(buildDesktopCaptureConstraints(constraints, false));
    } catch (error) {
      stopStream(firstStream);
      throw error;
    }

    const videoTracks = getLiveVideoTracks(videoOnlyStream);
    if (videoTracks.length === 0) {
      stopStream(firstStream);
      stopStream(videoOnlyStream);
      throw new Error('Desktop capture did not provide a video track.');
    }

    const mergedStream = new MediaStream();
    for (const track of videoTracks) {
      mergedStream.addTrack(track);
    }
    for (const track of getLiveAudioTracks(firstStream)) {
      mergedStream.addTrack(track);
    }

    return mergedStream;
  };
})();
`;

export function isDesktopMediaPermissionAllowed(permission: string): boolean {
  return ['display-capture', 'fullscreen', 'media', 'speaker-selection'].includes(permission);
}
