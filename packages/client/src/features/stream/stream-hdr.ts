// Convert only explicitly tagged HDR frames. Display HDR support and image
// brightness cannot tell us whether capture has already tone-mapped to SDR.
export type StreamHdrStatus =
  | 'checking'
  | 'sdr'
  | 'pq'
  | 'hlg'
  | 'unknown'
  | 'unavailable'
  | 'unsupported';
const statuses = new WeakMap<MediaStreamTrack, StreamHdrStatus>();

export function getStreamHdrStatus(
  stream: MediaStream | null | undefined,
): StreamHdrStatus {
  const track = stream?.getVideoTracks()[0];
  return (track && statuses.get(track)) ?? 'unavailable';
}

export function hdrTransfer(transfer: string | null): 'pq' | 'hlg' | null {
  return transfer === 'pq' ? 'pq' : transfer === 'hlg' ? 'hlg' : null;
}

export function hdrPlaneFormat(format: string | null) {
  if (format === 'NV12') return { bits: 8, planes: 2, x: 2, y: 2 };
  const match = /^I(420|422|444)(P10)?$/.exec(format ?? '');
  if (!match) return null;
  return {
    bits: match[2] ? 10 : 8,
    planes: 3,
    x: match[1] === '444' ? 1 : 2,
    y: match[1] === '420' ? 2 : 1,
  };
}

const vertexShader = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Raw YUV planes avoid an implicit browser HDR -> sRGB conversion before our
// EOTF. All tone mapping and gamut conversion happens in linear light on GPU.
const fragmentShader = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 uv;
out vec4 color;
uniform usampler2D yPlane;
uniform usampler2D uPlane;
uniform usampler2D vPlane;
uniform vec4 sourceRect;
uniform float codeMax;
uniform float codeScale;
uniform bool fullRange;
uniform bool nv12;
uniform bool pq;
uniform bool bt2020;
uniform bool matrix2020;

vec3 decode(vec3 v) {
  v = max(v, vec3(0.0));
  if (pq) {
    vec3 p = pow(v, vec3(1.0 / 78.84375));
    return 10000.0 * pow(max(p - 0.8359375, 0.0) / max(18.8515625 - 18.6875 * p, 0.000001), vec3(1.0 / 0.1593017578125));
  }
  vec3 low = v * v / 3.0;
  vec3 high = (exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12.0;
  vec3 scene = mix(low, high, step(vec3(0.5), v));
  float l = dot(scene, bt2020 ? vec3(0.2627, 0.6780, 0.0593) : vec3(0.2126, 0.7152, 0.0722));
  return 1000.0 * scene * pow(max(l, 0.000001), 0.2);
}

void main() {
  vec2 at = sourceRect.xy + uv * sourceRect.zw;
  float y = float(texture(yPlane, at).r);
  vec2 c = nv12 ? vec2(texture(uPlane, at).rg) : vec2(float(texture(uPlane, at).r), float(texture(vPlane, at).r));
  if (fullRange) {
    y /= codeMax;
    c = (c - vec2(128.0 * codeScale)) / codeMax;
  } else {
    y = (y - 16.0 * codeScale) / (219.0 * codeScale);
    c = (c - vec2(128.0 * codeScale)) / (224.0 * codeScale);
  }
  vec3 rgb = matrix2020
    ? vec3(y + 1.4746*c.y, y - 0.164553*c.x - 0.571353*c.y, y + 1.8814*c.x)
    : vec3(y + 1.5748*c.y, y - 0.187324*c.x - 0.468124*c.y, y + 1.8556*c.x);
  vec3 nits = decode(rgb);
  if (bt2020) {
    nits = mat3(1.660491, -0.124550, -0.018151, -0.587641, 1.132900, -0.100579, -0.072850, -0.008349, 1.118730) * nits;
  }
  nits = max(nits, vec3(0.0));
  float luminance = dot(nits, vec3(0.2126, 0.7152, 0.0722)) / 203.0;
  // Extended Reinhard shoulder, 203-nit reference white, 1000-nit nominal
  // peak. Luminance scaling preserves color ratios instead of per-channel curves.
  float peak = 1000.0 / 203.0;
  float mapped = luminance * (1.0 + luminance / (peak * peak)) / (1.0 + luminance);
  vec3 linear = clamp(nits / 203.0 * mapped / max(luminance, 0.000001), 0.0, 1.0);
  vec3 srgb = mix(12.92 * linear, 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linear));
  color = vec4(srgb, 1.0);
}`;

export function createHdrRenderer() {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('HDR correction requires WebGL2.');
  const shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [];
  const program = gl.createProgram();
  if (!program) throw new Error('HDR shader program allocation failed.');
  const dispose = () => {
    textures.forEach((texture) => gl.deleteTexture(texture));
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexShader],
      [gl.FRAGMENT_SHADER, fragmentShader],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('HDR shader allocation failed.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) ?? 'HDR shader compile failed.',
        );
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error('HDR shader link failed.');
    gl.useProgram(program);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < 3; i++) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('HDR texture allocation failed.');
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8UI,
        1,
        1,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        new Uint8Array([128]),
      );
      gl.uniform1i(
        gl.getUniformLocation(program, ['yPlane', 'uPlane', 'vPlane'][i]!),
        i,
      );
    }
  } catch (error) {
    dispose();
    throw error;
  }
  let buffer = new Uint8Array(0);
  return {
    dispose,
    async render(frame: VideoFrame): Promise<VideoFrame> {
      const format = hdrPlaneFormat(frame.format);
      const transfer = hdrTransfer(frame.colorSpace.transfer);
      // Older Electron DOM typings omit the HDR enum members exposed at runtime.
      const primaries: string | null = frame.colorSpace.primaries;
      const matrix: string | null = frame.colorSpace.matrix;
      if (
        !format ||
        !transfer ||
        !['bt709', 'bt2020'].includes(primaries ?? '') ||
        !['bt709', 'bt2020-ncl'].includes(matrix ?? '')
      ) {
        throw new Error('Unsupported HDR frame color space or pixel format.');
      }
      if (gl.isContextLost()) throw new Error('HDR GPU context lost.');
      const rect = {
        x: 0,
        y: 0,
        width: frame.codedWidth,
        height: frame.codedHeight,
      };
      const size = frame.allocationSize({ rect });
      if (buffer.byteLength !== size) buffer = new Uint8Array(size);
      const layout = await frame.copyTo(buffer, { rect });
      if (
        canvas.width !== frame.displayWidth ||
        canvas.height !== frame.displayHeight
      ) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      for (let i = 0; i < format.planes; i++) {
        const plane = layout[i]!;
        const width =
          i === 0 ? frame.codedWidth : Math.ceil(frame.codedWidth / format.x);
        const height =
          i === 0 ? frame.codedHeight : Math.ceil(frame.codedHeight / format.y);
        const channels = format.planes === 2 && i === 1 ? 2 : 1;
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, textures[i]!);
        gl.pixelStorei(
          gl.UNPACK_ROW_LENGTH,
          plane.stride / (channels * (format.bits === 10 ? 2 : 1)),
        );
        const pixels =
          format.bits === 10
            ? new Uint16Array(
                buffer.buffer,
                plane.offset,
                Math.floor((buffer.byteLength - plane.offset) / 2),
              )
            : buffer.subarray(plane.offset);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          channels === 2 ? gl.RG8UI : format.bits === 10 ? gl.R16UI : gl.R8UI,
          width,
          height,
          0,
          channels === 2 ? gl.RG_INTEGER : gl.RED_INTEGER,
          format.bits === 10 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE,
          pixels,
        );
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      const visible = frame.visibleRect ?? rect;
      gl.uniform4f(
        gl.getUniformLocation(program, 'sourceRect'),
        visible.x / frame.codedWidth,
        visible.y / frame.codedHeight,
        visible.width / frame.codedWidth,
        visible.height / frame.codedHeight,
      );
      gl.uniform1f(
        gl.getUniformLocation(program, 'codeMax'),
        format.bits === 10 ? 1023 : 255,
      );
      gl.uniform1f(
        gl.getUniformLocation(program, 'codeScale'),
        format.bits === 10 ? 4 : 1,
      );
      for (const [name, value] of Object.entries({
        fullRange: frame.colorSpace.fullRange,
        nv12: format.planes === 2,
        pq: transfer === 'pq',
        bt2020: primaries === 'bt2020',
        matrix2020: matrix === 'bt2020-ncl',
      })) {
        gl.uniform1i(gl.getUniformLocation(program, name), value ? 1 : 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error('HDR GPU rendering failed.');
      // Canvas-backed VideoFrames carry SDR RGB color metadata, rather than
      // retaining the source's PQ/HLG tag and causing a second correction.
      return new VideoFrame(canvas, {
        timestamp: frame.timestamp,
        ...(frame.duration === null ? {} : { duration: frame.duration }),
      });
    },
  };
}

type FrameApis = {
  MediaStreamTrackProcessor?: new (options: {
    track: MediaStreamTrack;
    maxBufferSize: number;
  }) => { readable: ReadableStream<VideoFrame> };
  MediaStreamTrackGenerator?: new (options: {
    kind: 'video';
  }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };
};

export function normalizeStreamHdr(stream: MediaStream): MediaStream {
  const source = stream.getVideoTracks()[0];
  if (!source) return stream;
  const {
    MediaStreamTrackProcessor: Processor,
    MediaStreamTrackGenerator: Generator,
  } = globalThis as typeof globalThis & FrameApis;
  if (
    !Processor ||
    !Generator ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof VideoFrame === 'undefined'
  ) {
    statuses.set(source, 'unavailable');
    return stream;
  }
  let output:
    | InstanceType<NonNullable<FrameApis['MediaStreamTrackGenerator']>>
    | undefined;
  let reader: ReadableStreamDefaultReader<VideoFrame>;
  let writer: WritableStreamDefaultWriter<VideoFrame>;
  try {
    output = new Generator({ kind: 'video' });
    reader = new Processor({
      track: source,
      maxBufferSize: 1,
    }).readable.getReader();
    writer = output.writable.getWriter();
  } catch {
    output?.stop();
    statuses.set(source, 'unavailable');
    return stream;
  }
  const track = output;
  statuses.set(track, 'checking');
  track.contentHint = source.contentHint;
  // Quality changes must reach the capture source, not just the generated sink.
  track.applyConstraints = source.applyConstraints.bind(source);
  track.getSettings = source.getSettings.bind(source);
  let renderer: ReturnType<typeof createHdrRenderer> | undefined;
  let stopped = false;
  const originalStop = track.stop.bind(track);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    source.removeEventListener('ended', sourceEnded);
    source.stop();
    originalStop();
    void reader.cancel().catch(() => undefined);
    void writer.abort().catch(() => undefined);
  };
  const sourceEnded = () => {
    stop();
    track.dispatchEvent(new Event('ended'));
  };
  track.stop = stop;
  source.addEventListener('ended', sourceEnded, { once: true });
  void (async () => {
    try {
      while (!stopped) {
        const { done, value: frame } = await reader.read();
        if (done) break;
        let corrected: VideoFrame | undefined;
        try {
          if (stopped) break;
          const transfer = hdrTransfer(frame.colorSpace.transfer);
          if (transfer) {
            try {
              renderer ??= createHdrRenderer();
              corrected = await renderer.render(frame);
              statuses.set(track, transfer);
            } catch {
              statuses.set(track, 'unsupported');
            }
          } else {
            statuses.set(track, frame.colorSpace.transfer ? 'sdr' : 'unknown');
          }
          if (!stopped) await writer.write(corrected ?? frame);
        } finally {
          corrected?.close();
          frame.close();
        }
      }
    } catch {
      // A failed processing stream must end publication rather than leave a
      // live-looking frozen track. The store already handles capture ended.
    } finally {
      renderer?.dispose();
      if (!stopped) sourceEnded();
    }
  })();
  return new MediaStream([track, ...stream.getAudioTracks()]);
}
