import fs from 'node:fs/promises';
import path from 'node:path';

import type { NativeImage } from 'electron';

const desktopPreferencesFile = 'desktop-preferences.json';

export interface DesktopPreferences {
  shareScreenAudio: boolean;
}

export interface ScreenSourceSelection {
  shareAudio: boolean;
  sourceId: string;
}

export interface SerializedScreenSource {
  appIconDataUrl: string | null;
  id: string;
  name: string;
  thumbnailDataUrl: string;
  type: 'screen' | 'window';
}

type ImageLike = Pick<NativeImage, 'isEmpty' | 'toDataURL'> | null | undefined;

export interface ScreenSourceLike {
  appIcon?: ImageLike;
  id: string;
  name: string;
  thumbnail: ImageLike;
}

export function getDesktopPreferencesPath(userDataPath: string) {
  return path.join(userDataPath, desktopPreferencesFile);
}

export function normalizeDesktopPreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== 'object') {
    return { shareScreenAudio: true };
  }

  const preferences = value as Partial<DesktopPreferences>;
  return {
    shareScreenAudio:
      typeof preferences.shareScreenAudio === 'boolean' ? preferences.shareScreenAudio : true,
  };
}

export async function readDesktopPreferences(userDataPath: string): Promise<DesktopPreferences> {
  try {
    const raw = await fs.readFile(getDesktopPreferencesPath(userDataPath), 'utf8');
    return normalizeDesktopPreferences(JSON.parse(raw));
  } catch {
    return { shareScreenAudio: true };
  }
}

export async function writeDesktopPreferences(
  userDataPath: string,
  preferences: DesktopPreferences,
): Promise<DesktopPreferences> {
  const normalized = normalizeDesktopPreferences(preferences);
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(getDesktopPreferencesPath(userDataPath), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function getScreenSourceType(sourceId: string): SerializedScreenSource['type'] {
  return sourceId.startsWith('screen:') ? 'screen' : 'window';
}

function imageToDataUrl(image: ImageLike): string | null {
  if (!image || image.isEmpty()) {
    return null;
  }

  return image.toDataURL();
}

export function serializeScreenSource(source: ScreenSourceLike): SerializedScreenSource {
  return {
    appIconDataUrl: imageToDataUrl(source.appIcon),
    id: source.id,
    name: source.name.trim() || source.id,
    thumbnailDataUrl: imageToDataUrl(source.thumbnail) ?? '',
    type: getScreenSourceType(source.id),
  };
}

export function normalizeScreenSourceSelection(
  selection: unknown,
  sourceIds: readonly string[],
  canShareAudio: boolean,
): ScreenSourceSelection | null {
  if (!selection || typeof selection !== 'object') {
    return null;
  }

  const candidate = selection as Partial<ScreenSourceSelection>;
  if (typeof candidate.sourceId !== 'string' || !sourceIds.includes(candidate.sourceId)) {
    return null;
  }

  return {
    shareAudio: canShareAudio && candidate.shareAudio === true,
    sourceId: candidate.sourceId,
  };
}
