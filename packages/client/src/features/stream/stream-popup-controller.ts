import { sendCommandAwaitAck } from '../gateway/gateway-store';
import { useStreamStore } from './stream-store';

const STREAM_POPUP_ROOT_ID = 'baker-stream-popup-root';
const STREAM_POPUP_GRACE_MS = 250;

export interface StreamPopupSnapshotEntry {
  container: HTMLElement;
  document: Document;
  openedAt: number;
  streamId: string;
}

interface StreamPopupHandle {
  close(): void;
  container: HTMLElement;
  document: Document;
  focus(): void;
  isClosed(): boolean;
  onClose(listener: () => void): () => void;
}

interface StreamPopupRegistryEntry {
  handle: StreamPopupHandle;
  openedAt: number;
  streamId: string;
  suppressNextCloseUnwatch: boolean;
  unsubscribeClose: () => void;
}

type StreamPopupOpener = (streamId: string) => StreamPopupHandle | null;

const popupEntries = new Map<string, StreamPopupRegistryEntry>();
const popupListeners = new Set<() => void>();
let cachedPopupSnapshot: StreamPopupSnapshotEntry[] = [];

let popupOpener: StreamPopupOpener = openBrowserStreamPopup;

function rebuildPopupSnapshot() {
  cachedPopupSnapshot = [...popupEntries.values()].map((entry) => ({
    container: entry.handle.container,
    document: entry.handle.document,
    openedAt: entry.openedAt,
    streamId: entry.streamId,
  }));
}

function emitPopupRegistryChanged() {
  rebuildPopupSnapshot();
  for (const listener of popupListeners) {
    listener();
  }
}

function buildStreamPopupTitle(streamId: string) {
  return `Baker Stream ${streamId.slice(0, 8)}`;
}

function configurePopupDocument(popupDocument: Document, streamId: string) {
  popupDocument.open();
  popupDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${buildStreamPopupTitle(streamId)}</title></head><body><div id="${STREAM_POPUP_ROOT_ID}"></div></body></html>`);
  popupDocument.close();

  const headNodes = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'));
  for (const node of headNodes) {
    popupDocument.head.appendChild(node.cloneNode(true));
  }
}

function openBrowserStreamPopup(streamId: string): StreamPopupHandle | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const popupWindow = window.open(
    '',
    `baker-stream-${streamId}`,
    'popup=yes,width=1180,height=760,left=120,top=80,resizable=yes,scrollbars=yes',
  );

  if (!popupWindow) {
    return null;
  }

  configurePopupDocument(popupWindow.document, streamId);

  const container = popupWindow.document.getElementById(STREAM_POPUP_ROOT_ID);
  if (!container) {
    popupWindow.close();
    return null;
  }

  return {
    close() {
      popupWindow.close();
    },
    container,
    document: popupWindow.document,
    focus() {
      popupWindow.focus();
    },
    isClosed() {
      return popupWindow.closed;
    },
    onClose(listener) {
      const handler = () => listener();
      popupWindow.addEventListener('beforeunload', handler);
      return () => popupWindow.removeEventListener('beforeunload', handler);
    },
  };
}

function removePopupEntry(streamId: string): StreamPopupRegistryEntry | null {
  const entry = popupEntries.get(streamId);
  if (!entry) {
    return null;
  }

  entry.unsubscribeClose();
  popupEntries.delete(streamId);
  emitPopupRegistryChanged();
  return entry;
}

function handlePopupClosed(streamId: string) {
  const entry = removePopupEntry(streamId);
  if (!entry || entry.suppressNextCloseUnwatch) {
    return;
  }

  void useStreamStore.getState().unwatchStream(streamId, sendCommandAwaitAck);
}

function pruneClosedPopups() {
  for (const [streamId, entry] of popupEntries) {
    if (!entry.handle.isClosed()) {
      continue;
    }

    handlePopupClosed(streamId);
  }
}

export function subscribeToStreamPopupRegistry(listener: () => void) {
  popupListeners.add(listener);
  return () => {
    popupListeners.delete(listener);
  };
}

export function getStreamPopupSnapshot(): StreamPopupSnapshotEntry[] {
  return cachedPopupSnapshot;
}

export function ensureStreamPopupWindow(streamId: string) {
  pruneClosedPopups();

  const existing = popupEntries.get(streamId);
  if (existing) {
    existing.handle.focus();
    return true;
  }

  const handle = popupOpener(streamId);
  if (!handle) {
    return false;
  }

  const entry: StreamPopupRegistryEntry = {
    handle,
    openedAt: Date.now(),
    streamId,
    suppressNextCloseUnwatch: false,
    unsubscribeClose: () => {},
  };

  entry.unsubscribeClose = handle.onClose(() => {
    handlePopupClosed(entry.streamId);
  });

  popupEntries.set(streamId, entry);
  emitPopupRegistryChanged();
  handle.focus();
  return true;
}

export function focusStreamPopupWindow(streamId: string) {
  pruneClosedPopups();
  popupEntries.get(streamId)?.handle.focus();
}

export function closeStreamPopup(streamId: string) {
  const entry = removePopupEntry(streamId);
  if (!entry) {
    return;
  }

  entry.suppressNextCloseUnwatch = true;
  entry.handle.close();
}

export function closeAllStreamPopups() {
  for (const streamId of [...popupEntries.keys()]) {
    closeStreamPopup(streamId);
  }
}

export function shouldAutoCloseStreamPopup(entry: StreamPopupSnapshotEntry) {
  return Date.now() - entry.openedAt >= STREAM_POPUP_GRACE_MS;
}

export function setStreamPopupOpenerForTests(opener: StreamPopupOpener | null) {
  popupOpener = opener ?? openBrowserStreamPopup;
}

export function resetStreamPopupControllerForTests() {
  closeAllStreamPopups();
  cachedPopupSnapshot = [];
  popupOpener = openBrowserStreamPopup;
}
