import { describe, expect, it } from 'vitest';

import { assertSelectedProducerCodec } from './sfu-client';

describe('strict SFU video codec selection', () => {
  it('accepts the selected AV1 primary codec with RTX', () => {
    expect(() =>
      assertSelectedProducerCodec(
        [{ mimeType: 'video/AV1' }, { mimeType: 'video/rtx' }],
        'av1',
      ),
    ).not.toThrow();
  });

  it('rejects an H264 producer when AV1 was selected', () => {
    expect(() =>
      assertSelectedProducerCodec([{ mimeType: 'video/H264' }], 'av1'),
    ).toThrow(/actual: H264.*no fallback codec/i);
  });
});
