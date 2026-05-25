import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AdminUpdateJobStatus } from '@baker/protocol';

import { clearDeploymentPendingMarker, getUpdateStatusPath } from './runtime-config';

export function idleUpdateStatus(): AdminUpdateJobStatus {
  return {
    completedAt: null,
    error: null,
    jobId: null,
    message: 'No update job has run yet.',
    phase: 'idle',
    startedAt: null,
    status: 'idle',
    targetImage: null,
    targetTag: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function readUpdateStatus(path = getUpdateStatusPath()): Promise<AdminUpdateJobStatus> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as AdminUpdateJobStatus;
    return {
      ...idleUpdateStatus(),
      ...parsed,
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return idleUpdateStatus();
    }
    throw err;
  }
}

export async function writeUpdateStatus(status: AdminUpdateJobStatus, path = getUpdateStatusPath()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(status, null, 2), { mode: 0o600 });
  if (status.status === 'succeeded') {
    await clearDeploymentPendingMarker().catch(() => undefined);
  }
}

export async function writeStartingUpdateStatus(input: {
  jobId: string;
  targetImage: string;
  targetTag: string;
}) {
  const now = new Date().toISOString();
  const status: AdminUpdateJobStatus = {
    completedAt: null,
    error: null,
    jobId: input.jobId,
    message: 'Starting update helper.',
    phase: 'starting',
    startedAt: now,
    status: 'running',
    targetImage: input.targetImage,
    targetTag: input.targetTag,
    updatedAt: now,
  };
  await writeUpdateStatus(status);
  return status;
}

export async function writeFailedUpdateStatus(input: {
  error: string;
  jobId?: string | null;
  targetImage?: string | null;
  targetTag?: string | null;
}) {
  const now = new Date().toISOString();
  const status: AdminUpdateJobStatus = {
    completedAt: now,
    error: input.error,
    jobId: input.jobId ?? null,
    message: 'Update failed before the helper started.',
    phase: 'failed',
    startedAt: now,
    status: 'failed',
    targetImage: input.targetImage ?? null,
    targetTag: input.targetTag ?? null,
    updatedAt: now,
  };
  await writeUpdateStatus(status);
  return status;
}
