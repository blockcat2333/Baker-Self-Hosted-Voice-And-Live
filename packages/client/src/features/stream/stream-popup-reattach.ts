import { hasPlayableStreamAudioTrack } from './stream-media';

function getMediaStreamTracks(value: unknown): MediaStreamTrack[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const stream = value as { getTracks?: () => MediaStreamTrack[] };
  if (typeof stream.getTracks !== 'function') {
    return [];
  }

  return stream.getTracks();
}

export function getPopupStreamTrackSignature(stream: Pick<MediaStream, 'getTracks'> | null): string {
  return getMediaStreamTracks(stream)
    .map((track) => `${track.kind}:${track.id}:${track.readyState}`)
    .join('|');
}

export function shouldReattachPopupStreamAfterSourceTrackChange(
  element: Pick<HTMLVideoElement, 'muted' | 'paused' | 'srcObject'>,
  stream: Pick<MediaStream, 'getAudioTracks' | 'getTracks'>,
): boolean {
  if (element.paused || (element.muted && hasPlayableStreamAudioTrack(stream))) {
    return true;
  }

  const attachedTracks = getMediaStreamTracks(element.srcObject);
  const sourceTracks = getMediaStreamTracks(stream);
  if (attachedTracks.length !== sourceTracks.length) {
    return true;
  }

  const attachedTrackIds = new Set(attachedTracks.map((track) => track.id));
  return sourceTracks.some((track) => !attachedTrackIds.has(track.id));
}
