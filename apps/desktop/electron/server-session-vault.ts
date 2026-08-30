import type { AuthSessionSnapshot } from '@baker/client';

export interface SessionCipher {
  decryptString(value: Uint8Array): string;
  encryptString(value: string): Uint8Array;
}

export interface EncryptedSessionFile {
  schemaVersion: 1;
  sessions: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createEmptyEncryptedSessionFile(): EncryptedSessionFile {
  return { schemaVersion: 1, sessions: {} };
}

export function parseEncryptedSessionFile(value: unknown): EncryptedSessionFile {
  if (!isRecord(value) || value['schemaVersion'] !== 1 || !isRecord(value['sessions'])) {
    return createEmptyEncryptedSessionFile();
  }
  const sessions = Object.fromEntries(
    Object.entries(value['sessions']).filter(
      (entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string',
    ),
  );
  return { schemaVersion: 1, sessions };
}

export function isAuthSessionSnapshot(value: unknown): value is AuthSessionSnapshot {
  if (!isRecord(value)) return false;
  if (typeof value['accessToken'] !== 'string' || typeof value['refreshToken'] !== 'string') return false;
  const user = value['user'];
  if (user === null) return true;
  return (
    isRecord(user) &&
    typeof user['email'] === 'string' &&
    typeof user['id'] === 'string' &&
    typeof user['username'] === 'string'
  );
}

export function encryptAuthSession(cipher: SessionCipher, session: AuthSessionSnapshot) {
  return Buffer.from(cipher.encryptString(JSON.stringify(session))).toString('base64');
}

export function decryptAuthSession(cipher: SessionCipher, encrypted: string): AuthSessionSnapshot | null {
  try {
    const raw = cipher.decryptString(Buffer.from(encrypted, 'base64'));
    const parsed = JSON.parse(raw) as unknown;
    return isAuthSessionSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
