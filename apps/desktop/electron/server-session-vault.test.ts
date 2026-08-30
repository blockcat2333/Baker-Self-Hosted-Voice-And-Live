import { describe, expect, it } from 'vitest';

import {
  decryptAuthSession,
  encryptAuthSession,
  parseEncryptedSessionFile,
  type SessionCipher,
} from './server-session-vault';

const cipher: SessionCipher = {
  decryptString(value) {
    return Buffer.from(value).toString('utf8').split('').reverse().join('');
  },
  encryptString(value) {
    return Buffer.from(value.split('').reverse().join(''), 'utf8');
  },
};

describe('desktop encrypted session vault', () => {
  it('round-trips a scoped auth session through ciphertext', () => {
    const session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { email: 'user@example.com', id: 'user-id', username: 'user' },
    };
    const encrypted = encryptAuthSession(cipher, session);
    expect(encrypted).not.toContain('access');
    expect(decryptAuthSession(cipher, encrypted)).toEqual(session);
  });

  it('rejects corrupt ciphertext and invalid session files', () => {
    expect(decryptAuthSession(cipher, 'not-valid-ciphertext')).toBeNull();
    expect(parseEncryptedSessionFile({ schemaVersion: 1, sessions: { one: 42 } })).toEqual({
      schemaVersion: 1,
      sessions: {},
    });
  });
});
