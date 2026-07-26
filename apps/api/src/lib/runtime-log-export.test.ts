import { describe, expect, it } from 'vitest';

import {
  limitDiagnosticLogSize,
  redactDiagnosticText,
} from './runtime-log-export';

describe('runtime log export', () => {
  it('redacts structured and free-text credentials', () => {
    const source = [
      '{"service":"api","password":"plain-secret","nested":{"accessToken":"token-value"}}',
      'authorization=Bearer abc.def.ghi',
      'DATABASE_URL=postgresql://baker:database-password@postgres/baker',
      'request https://example.test/path?token=query-secret&ok=true',
    ].join('\n');

    const redacted = redactDiagnosticText(source);

    expect(redacted).toContain('"password":"[REDACTED]"');
    expect(redacted).toContain('"accessToken":"[REDACTED]"');
    expect(redacted).toContain('authorization=[REDACTED]');
    expect(redacted).toContain('postgresql://baker:[REDACTED]@postgres/baker');
    expect(redacted).toContain('token=[REDACTED]&ok=true');
    expect(redacted).not.toContain('plain-secret');
    expect(redacted).not.toContain('token-value');
    expect(redacted).not.toContain('database-password');
    expect(redacted).not.toContain('query-secret');
  });

  it('retains only the tail when the export exceeds its size limit', () => {
    const result = limitDiagnosticLogSize('first\nsecond\nthird\n', 13);

    expect(result).toContain('Earlier container logs omitted');
    expect(result).toContain('second\nthird\n');
    expect(result).not.toContain('\nfirst\n');
  });
});
