import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { app, type WebContents } from 'electron';

export interface ExcludedSystemAudioCaptureSession {
  channelCount: number;
  sampleRate: number;
  sessionId: string;
}

export interface WindowAudioSource {
  id: string;
  processId: number;
  title: string;
}

interface RunningExcludedSystemAudioSession extends ExcludedSystemAudioCaptureSession {
  chunkEvent: string;
  endedEvent: string;
  process: ChildProcess;
  stderr: string;
  webContents: WebContents;
}

const runningSessions = new Map<string, RunningExcludedSystemAudioSession>();
const maxHeaderBytes = 4096;

function getDesktopRoot(currentDirectory: string) {
  return path.resolve(currentDirectory, '..', '..');
}

export function getExcludedSystemAudioHelperPath(currentDirectory: string) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', 'excluded-system-audio.exe');
  }

  return path.join(getDesktopRoot(currentDirectory), 'native', 'excluded-system-audio.exe');
}

export async function isExcludedSystemAudioCaptureAvailable(currentDirectory: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    await fs.access(getExcludedSystemAudioHelperPath(currentDirectory));
    return true;
  } catch {
    return false;
  }
}

function parseHeader(header: string): Omit<ExcludedSystemAudioCaptureSession, 'sessionId'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    throw new Error('Excluded system audio helper returned an invalid header.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Excluded system audio helper returned an empty header.');
  }

  const data = parsed as {
    channelCount?: unknown;
    format?: unknown;
    sampleRate?: unknown;
  };

  if (data.format !== 'f32le') {
    throw new Error('Excluded system audio helper returned an unsupported audio format.');
  }

  if (
    typeof data.sampleRate !== 'number' ||
    !Number.isFinite(data.sampleRate) ||
    data.sampleRate <= 0 ||
    typeof data.channelCount !== 'number' ||
    !Number.isInteger(data.channelCount) ||
    data.channelCount <= 0
  ) {
    throw new Error('Excluded system audio helper returned invalid audio metadata.');
  }

  return {
    channelCount: data.channelCount,
    sampleRate: data.sampleRate,
  };
}

function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill();
}

async function runHelperJson(currentDirectory: string, args: string[]): Promise<unknown> {
  if (process.platform !== 'win32') {
    throw new Error('Window audio helper is only available on Windows.');
  }

  const helperPath = getExcludedSystemAudioHelperPath(currentDirectory);
  await fs.access(helperPath);

  return await new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Window audio helper exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Window audio helper returned invalid JSON.'));
      }
    });
  });
}

export async function listWindowAudioSources(currentDirectory: string): Promise<WindowAudioSource[]> {
  const raw = await runHelperJson(currentDirectory, ['--list-windows']);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((item): WindowAudioSource[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const source = item as Partial<WindowAudioSource>;
    if (
      typeof source.id !== 'string' ||
      typeof source.title !== 'string' ||
      typeof source.processId !== 'number' ||
      !Number.isInteger(source.processId) ||
      source.processId <= 0
    ) {
      return [];
    }
    return [{ id: source.id, processId: source.processId, title: source.title }];
  });
}

export async function getWindowAudioLevels(
  currentDirectory: string,
  processIds: number[],
): Promise<Record<string, number>> {
  if (processIds.length === 0) {
    return {};
  }

  const raw = await runHelperJson(currentDirectory, ['--meter-once', ...processIds.map(String)]);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const levels: Record<string, number> = {};
  for (const [processId, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      levels[processId] = Math.max(0, Math.min(1, value));
    }
  }
  return levels;
}

async function startAudioCapture(
  currentDirectory: string,
  webContents: WebContents,
  args: string[],
  events: { chunk: string; ended: string },
): Promise<ExcludedSystemAudioCaptureSession> {
  if (process.platform !== 'win32') {
    throw new Error('System audio capture is only available on Windows.');
  }

  const helperPath = getExcludedSystemAudioHelperPath(currentDirectory);
  try {
    await fs.access(helperPath);
  } catch {
    throw new Error('Excluded system audio helper is not available. Build the Windows native helper before sharing audio.');
  }

  const sessionId = randomUUID();
  const child = spawn(helperPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  let headerBuffer = Buffer.alloc(0);
  let headerResolved = false;

  const headerPromise = new Promise<Omit<ExcludedSystemAudioCaptureSession, 'sessionId'>>((resolve, reject) => {
    const rejectWithCleanup = (error: Error) => {
      stopProcess(child);
      reject(error);
    };

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8192) {
        stderr = stderr.slice(-8192);
      }
    });

    child.once('error', (error) => {
      rejectWithCleanup(new Error(`Excluded system audio helper failed to start: ${error.message}`));
    });

    child.once('exit', (code) => {
      runningSessions.delete(sessionId);
      webContents.send(events.ended, {
        code,
        sessionId,
        stderr,
      });

      if (!headerResolved) {
        reject(
          new Error(
            stderr.trim() ||
              `Excluded system audio helper exited before audio started${typeof code === 'number' ? ` (${code})` : ''}.`,
          ),
        );
      }
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (headerResolved) {
        webContents.send(events.chunk, {
          chunk: new Uint8Array(chunk),
          sessionId,
        });
        return;
      }

      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const lineEnd = headerBuffer.indexOf(0x0a);
      if (lineEnd < 0) {
        if (headerBuffer.length > maxHeaderBytes) {
          rejectWithCleanup(new Error('Excluded system audio helper header is too large.'));
        }
        return;
      }

      const header = headerBuffer.subarray(0, lineEnd).toString('utf8');
      const remainder = headerBuffer.subarray(lineEnd + 1);
      try {
        const metadata = parseHeader(header);
        headerResolved = true;
        runningSessions.set(sessionId, {
          ...metadata,
          chunkEvent: events.chunk,
          endedEvent: events.ended,
          process: child,
          sessionId,
          stderr,
          webContents,
        });
        resolve(metadata);
      } catch (error) {
        rejectWithCleanup(error instanceof Error ? error : new Error('Excluded system audio helper failed.'));
        return;
      }

      if (remainder.length > 0) {
        webContents.send(events.chunk, {
          chunk: new Uint8Array(remainder),
          sessionId,
        });
      }
    });
  });

  const metadata = await headerPromise;
  return {
    ...metadata,
    sessionId,
  };
}

export async function startExcludedSystemAudioCapture(
  currentDirectory: string,
  webContents: WebContents,
): Promise<ExcludedSystemAudioCaptureSession> {
  return startAudioCapture(
    currentDirectory,
    webContents,
    ['--capture', 'exclude', String(process.pid)],
    {
      chunk: 'desktop:excluded-audio-chunk',
      ended: 'desktop:excluded-audio-ended',
    },
  );
}

export async function startWindowAudioCapture(
  currentDirectory: string,
  webContents: WebContents,
  processId: number,
): Promise<ExcludedSystemAudioCaptureSession> {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error('Invalid window audio process id.');
  }

  return startAudioCapture(
    currentDirectory,
    webContents,
    ['--capture', 'include', String(processId)],
    {
      chunk: 'desktop:window-audio-chunk',
      ended: 'desktop:window-audio-ended',
    },
  );
}

export function stopExcludedSystemAudioCapture(sessionId: string) {
  const session = runningSessions.get(sessionId);
  if (!session) {
    return;
  }

  runningSessions.delete(sessionId);
  stopProcess(session.process);
}

export function stopWindowAudioCapture(sessionId: string) {
  stopExcludedSystemAudioCapture(sessionId);
}

export function stopAllExcludedSystemAudioCaptures() {
  for (const sessionId of [...runningSessions.keys()]) {
    stopExcludedSystemAudioCapture(sessionId);
  }
}
