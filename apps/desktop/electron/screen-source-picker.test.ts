import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getScreenSourceType,
  normalizeDesktopPreferences,
  normalizeScreenSourceSelection,
  readDesktopPreferences,
  serializeScreenSource,
  writeDesktopPreferences,
} from './screen-source-picker';

const temporaryDirectories: string[] = [];

function image(dataUrl: string, empty = false) {
  return {
    isEmpty: () => empty,
    toDataURL: () => dataUrl,
  };
}

describe('screen source picker helpers', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it('classifies desktop capturer source ids', () => {
    expect(getScreenSourceType('screen:1:0')).toBe('screen');
    expect(getScreenSourceType('window:10:0')).toBe('window');
  });

  it('serializes window and screen source previews', () => {
    expect(
      serializeScreenSource({
        appIcon: image('data:image/png;base64,icon'),
        id: 'window:10:0',
        name: '  Notes  ',
        thumbnail: image('data:image/png;base64,thumb'),
      }),
    ).toEqual({
      appIconDataUrl: 'data:image/png;base64,icon',
      id: 'window:10:0',
      name: 'Notes',
      thumbnailDataUrl: 'data:image/png;base64,thumb',
      type: 'window',
    });

    expect(
      serializeScreenSource({
        appIcon: null,
        id: 'screen:1:0',
        name: '',
        thumbnail: image('', true),
      }),
    ).toMatchObject({
      appIconDataUrl: null,
      name: 'screen:1:0',
      thumbnailDataUrl: '',
      type: 'screen',
    });
  });

  it('normalizes and persists the screen audio preference', async () => {
    expect(normalizeDesktopPreferences({})).toEqual({ shareScreenAudio: true });
    expect(normalizeDesktopPreferences({ shareScreenAudio: false })).toEqual({
      shareScreenAudio: false,
    });

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baker-desktop-prefs-'));
    temporaryDirectories.push(directory);

    expect(await readDesktopPreferences(directory)).toEqual({ shareScreenAudio: true });
    await writeDesktopPreferences(directory, { shareScreenAudio: false });
    expect(await readDesktopPreferences(directory)).toEqual({ shareScreenAudio: false });
  });

  it('rejects unknown source selections and disables audio when unavailable', () => {
    expect(
      normalizeScreenSourceSelection(
        { shareAudio: true, sourceId: 'window:1:0' },
        ['window:1:0'],
        true,
      ),
    ).toEqual({ shareAudio: true, sourceId: 'window:1:0' });
    expect(
      normalizeScreenSourceSelection(
        { shareAudio: true, sourceId: 'window:1:0' },
        ['window:1:0'],
        false,
      ),
    ).toEqual({ shareAudio: false, sourceId: 'window:1:0' });
    expect(normalizeScreenSourceSelection({ sourceId: 'missing' }, ['window:1:0'], true)).toBeNull();
    expect(normalizeScreenSourceSelection(null, ['window:1:0'], true)).toBeNull();
  });
});
