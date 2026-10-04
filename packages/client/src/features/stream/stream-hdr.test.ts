import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStreamHdrStatus,
  hdrPlaneFormat,
  hdrTransfer,
  normalizeStreamHdr,
} from './stream-hdr';

class Track extends EventTarget {
  kind = 'video';
  contentHint = 'detail';
  readyState = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  applyConstraints = vi.fn(async () => undefined);
  getSettings = vi.fn(() => ({ frameRate: 60 }));
}
class Stream {
  constructor(public tracks: Track[]) {}
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('HDR normalization', () => {
  it('uses standardized HDR transfers, never image brightness or wide gamut alone', () => {
    expect(hdrTransfer('pq')).toBe('pq');
    expect(hdrTransfer('hlg')).toBe('hlg');
    expect(hdrTransfer('bt709')).toBeNull();
    expect(hdrTransfer(null)).toBeNull();
    expect(hdrPlaneFormat('I420P10')).toEqual({
      bits: 10,
      planes: 3,
      x: 2,
      y: 2,
    });
    expect(hdrPlaneFormat('I444')).toEqual({ bits: 8, planes: 3, x: 1, y: 1 });
    expect(hdrPlaneFormat('NV12')).toEqual({ bits: 8, planes: 2, x: 2, y: 2 });
    expect(hdrPlaneFormat('RGBA')).toBeNull();
  });

  it('preserves the original stream when processing APIs are absent', () => {
    vi.stubGlobal('MediaStreamTrackProcessor', undefined);
    const stream = new Stream([new Track()]) as unknown as MediaStream;
    expect(normalizeStreamHdr(stream)).toBe(stream);
    expect(getStreamHdrStatus(stream)).toBe('unavailable');
  });

  it.each(['iec61966-2-1', null])(
    'passes through %s frames, keeps audio and forwards capture cleanup',
    async (transfer) => {
      const source = new Track();
      const audio = new Track();
      audio.kind = 'audio';
      const frame = { colorSpace: { transfer }, close: vi.fn() };
      let controller: ReadableStreamDefaultController<unknown>;
      const write = vi.fn();
      vi.stubGlobal('MediaStream', Stream);
      vi.stubGlobal('VideoFrame', class {});
      vi.stubGlobal('OffscreenCanvas', class {});
      vi.stubGlobal(
        'MediaStreamTrackProcessor',
        class {
          readable = new ReadableStream({
            start(next) {
              controller = next;
            },
          });
        },
      );
      vi.stubGlobal(
        'MediaStreamTrackGenerator',
        class extends Track {
          writable = new WritableStream({
            write(frame) {
              write(frame);
            },
          });
        },
      );
      const result = normalizeStreamHdr(
        new Stream([source, audio]) as unknown as MediaStream,
      );
      controller!.enqueue(frame);
      await vi.waitFor(() => expect(write).toHaveBeenCalledWith(frame));
      await vi.waitFor(() => expect(frame.close).toHaveBeenCalledOnce());
      expect(getStreamHdrStatus(result)).toBe(transfer ? 'sdr' : 'unknown');
      expect(result.getAudioTracks()[0]).toBe(audio);
      const output = result.getVideoTracks()[0]!;
      await output.applyConstraints({ frameRate: 30 });
      expect(source.applyConstraints).toHaveBeenCalledWith({ frameRate: 30 });
      const ended = vi.fn();
      output.addEventListener('ended', ended);
      source.dispatchEvent(new Event('ended'));
      expect(ended).toHaveBeenCalledOnce();
      output.stop();
      expect(source.stop).toHaveBeenCalledOnce();
      expect(audio.stop).not.toHaveBeenCalled();
    },
  );
});
