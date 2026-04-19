import { describe, expect, it, vi } from 'vitest';

import {
  isPopupFullscreenActive,
  isPopupFullscreenSupported,
  togglePopupFullscreen,
  type PopupFullscreenDocument,
  type PopupFullscreenElement,
} from './stream-popup-fullscreen';

describe('stream popup fullscreen helpers', () => {
  it('toggles fullscreen on and off with the standard Fullscreen API', async () => {
    const documentState: PopupFullscreenDocument = {
      exitFullscreen: vi.fn(async () => {
        documentState.fullscreenElement = null;
      }),
      fullscreenElement: null,
    };
    const stage: PopupFullscreenElement = {
      ownerDocument: documentState,
      requestFullscreen: vi.fn(async () => {
        documentState.fullscreenElement = stage;
      }),
    };

    expect(isPopupFullscreenSupported(stage, documentState)).toBe(true);
    expect(isPopupFullscreenActive(stage, documentState)).toBe(false);

    await expect(togglePopupFullscreen(stage, documentState)).resolves.toBe(true);
    expect(stage.requestFullscreen).toHaveBeenCalledOnce();
    expect(isPopupFullscreenActive(stage, documentState)).toBe(true);

    await expect(togglePopupFullscreen(stage, documentState)).resolves.toBe(false);
    expect(documentState.exitFullscreen).toHaveBeenCalledOnce();
    expect(isPopupFullscreenActive(stage, documentState)).toBe(false);
  });

  it('gracefully skips fullscreen when the browser does not support it', async () => {
    const unsupportedDocument: PopupFullscreenDocument = {
      fullscreenElement: null,
    };
    const unsupportedStage: PopupFullscreenElement = {
      ownerDocument: unsupportedDocument,
    };

    expect(isPopupFullscreenSupported(unsupportedStage, unsupportedDocument)).toBe(false);
    expect(await togglePopupFullscreen(unsupportedStage, unsupportedDocument)).toBe(false);
    expect(isPopupFullscreenActive(unsupportedStage, unsupportedDocument)).toBe(false);
  });
});
