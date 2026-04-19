import { afterEach, describe, expect, it } from 'vitest';

import {
  closeAllStreamPopups,
  ensureStreamPopupWindow,
  getStreamPopupSnapshot,
  resetStreamPopupControllerForTests,
  setStreamPopupOpenerForTests,
} from './stream-popup-controller';

interface FakePopupHandle {
  closeListener: (() => void) | null;
  closeCalls: number;
  closed: boolean;
  container: HTMLElement;
  document: Document;
  focusCalls: number;
}

function createFakePopupHandle(): FakePopupHandle {
  return {
    closeCalls: 0,
    closeListener: null,
    closed: false,
    container: {} as HTMLElement,
    document: {} as Document,
    focusCalls: 0,
  };
}

afterEach(() => {
  resetStreamPopupControllerForTests();
});

describe('stream popup controller', () => {
  it('reuses the existing popup for the same streamId instead of opening a duplicate', () => {
    const createdHandles: FakePopupHandle[] = [];

    setStreamPopupOpenerForTests(() => {
      const handle = createFakePopupHandle();
      createdHandles.push(handle);

      return {
        close() {
          handle.closed = true;
          handle.closeCalls += 1;
          handle.closeListener?.();
        },
        container: handle.container,
        document: handle.document,
        focus() {
          handle.focusCalls += 1;
        },
        isClosed() {
          return handle.closed;
        },
        onClose(listener) {
          handle.closeListener = listener;
          return () => {
            handle.closeListener = null;
          };
        },
      };
    });

    expect(ensureStreamPopupWindow('stream-1')).toBe(true);
    expect(ensureStreamPopupWindow('stream-1')).toBe(true);

    expect(createdHandles).toHaveLength(1);
    expect(createdHandles[0]?.focusCalls).toBe(2);
    expect(getStreamPopupSnapshot()).toHaveLength(1);
  });

  it('closes all tracked popups during controller cleanup', () => {
    const createdHandles: FakePopupHandle[] = [];

    setStreamPopupOpenerForTests(() => {
      const handle = createFakePopupHandle();
      createdHandles.push(handle);

      return {
        close() {
          handle.closed = true;
          handle.closeCalls += 1;
        },
        container: handle.container,
        document: handle.document,
        focus() {
          handle.focusCalls += 1;
        },
        isClosed() {
          return handle.closed;
        },
        onClose() {
          return () => {};
        },
      };
    });

    expect(ensureStreamPopupWindow('stream-1')).toBe(true);
    expect(ensureStreamPopupWindow('stream-2')).toBe(true);

    closeAllStreamPopups();

    expect(createdHandles.map((handle) => handle.closeCalls)).toEqual([1, 1]);
    expect(getStreamPopupSnapshot()).toHaveLength(0);
  });

  it('returns a stable snapshot reference while the popup registry is unchanged', () => {
    setStreamPopupOpenerForTests(() => {
      const handle = createFakePopupHandle();

      return {
        close() {
          handle.closed = true;
        },
        container: handle.container,
        document: handle.document,
        focus() {
          handle.focusCalls += 1;
        },
        isClosed() {
          return handle.closed;
        },
        onClose() {
          return () => {};
        },
      };
    });

    expect(ensureStreamPopupWindow('stream-1')).toBe(true);

    const firstSnapshot = getStreamPopupSnapshot();
    const secondSnapshot = getStreamPopupSnapshot();

    expect(secondSnapshot).toBe(firstSnapshot);
  });
});
