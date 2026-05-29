import { describe, expect, it } from 'vitest';

import { parseSupervisorStatusOutput } from './runtime-health';

describe('runtime health helpers', () => {
  it('parses supervisorctl status output', () => {
    const parsed = parseSupervisorStatusOutput(
      [
        'postgres                         RUNNING   pid 14, uptime 0:01:20',
        'gateway                          FATAL     Exited too quickly (process log may have details)',
        'turn                             EXITED    May 29 01:02 PM',
      ].join('\n'),
    );

    expect(parsed.get('postgres')).toMatchObject({
      state: 'RUNNING',
    });
    expect(parsed.get('gateway')).toMatchObject({
      state: 'FATAL',
    });
    expect(parsed.get('turn')).toMatchObject({
      state: 'EXITED',
    });
  });
});
