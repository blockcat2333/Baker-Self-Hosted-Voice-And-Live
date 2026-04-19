type FullscreenRequestResult = Promise<void> | void;

export interface PopupFullscreenDocument {
  exitFullscreen?: () => FullscreenRequestResult;
  fullscreenElement?: object | null;
}

export interface PopupFullscreenElement {
  ownerDocument?: PopupFullscreenDocument | null;
  requestFullscreen?: () => FullscreenRequestResult;
}

function getFullscreenDocument(
  target: PopupFullscreenElement | null | undefined,
  doc?: PopupFullscreenDocument | null,
) {
  return doc ?? target?.ownerDocument ?? null;
}

export function isPopupFullscreenSupported(
  target: PopupFullscreenElement | null | undefined,
  doc?: PopupFullscreenDocument | null,
) {
  const fullscreenDocument = getFullscreenDocument(target, doc);
  return Boolean(target?.requestFullscreen && fullscreenDocument?.exitFullscreen);
}

export function isPopupFullscreenActive(
  target: PopupFullscreenElement | null | undefined,
  doc?: PopupFullscreenDocument | null,
) {
  const fullscreenDocument = getFullscreenDocument(target, doc);
  return Boolean(target && fullscreenDocument?.fullscreenElement === target);
}

export async function togglePopupFullscreen(
  target: PopupFullscreenElement | null | undefined,
  doc?: PopupFullscreenDocument | null,
) {
  const fullscreenDocument = getFullscreenDocument(target, doc);
  if (!target || !isPopupFullscreenSupported(target, fullscreenDocument)) {
    return false;
  }

  if (fullscreenDocument?.fullscreenElement === target) {
    await fullscreenDocument.exitFullscreen?.();
    return false;
  }

  await target.requestFullscreen?.();
  return true;
}
