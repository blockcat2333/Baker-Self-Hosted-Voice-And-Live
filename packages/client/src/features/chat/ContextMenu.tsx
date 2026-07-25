import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuEntry =
  | { id: string; type: 'separator' }
  | {
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      id: string;
      label: string;
      onSelect?: () => void;
      subItems?: ContextMenuEntry[];
      type?: 'item';
    };

interface ContextMenuProps {
  ariaLabel: string;
  items: ContextMenuEntry[];
  onClose: () => void;
  x: number;
  y: number;
}

interface SubmenuState {
  items: ContextMenuEntry[];
  left: number;
  parentId: string;
  top: number;
}

const MENU_WIDTH = 228;
const VIEWPORT_GUTTER = 8;

function estimateMenuHeight(items: ContextMenuEntry[]) {
  return (
    12 +
    items.reduce((height, item) => height + (item.type === 'separator' ? 9 : 34), 0)
  );
}

function getEnabledItems(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLButtonElement>(':scope > .context-menu-item:not(:disabled)'),
  );
}

export function ContextMenu({ ariaLabel, items, onClose, x, y }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null);

  useLayoutEffect(() => {
    const menu = rootRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(
        VIEWPORT_GUTTER,
        Math.min(x, window.innerWidth - rect.width - VIEWPORT_GUTTER),
      ),
      top: Math.max(
        VIEWPORT_GUTTER,
        Math.min(y, window.innerHeight - rect.height - VIEWPORT_GUTTER),
      ),
    });

    menu.focus();
  }, [x, y]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      onClose();
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    function handleViewportChange() {
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('blur', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleWindowKeyDown);
      window.removeEventListener('blur', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [onClose]);

  function openSubmenu(item: Extract<ContextMenuEntry, { label: string }>, target: HTMLElement) {
    if (!item.subItems?.length) {
      setSubmenu(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const height = estimateMenuHeight(item.subItems);
    const openToRight = rect.right + 4 + MENU_WIDTH <= window.innerWidth - VIEWPORT_GUTTER;

    setSubmenu({
      items: item.subItems,
      left: openToRight ? rect.right + 4 : rect.left - MENU_WIDTH - 4,
      parentId: item.id,
      top: Math.max(
        VIEWPORT_GUTTER,
        Math.min(rect.top - 6, window.innerHeight - height - VIEWPORT_GUTTER),
      ),
    });
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, isSubmenu = false) {
    const menu = event.currentTarget;
    const enabledItems = getEnabledItems(menu);
    const focusedIndex = enabledItems.findIndex((item) => item === document.activeElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        focusedIndex < 0
          ? 0
          : (focusedIndex + direction + enabledItems.length) % enabledItems.length;
      enabledItems[nextIndex]?.focus();
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      enabledItems[event.key === 'Home' ? 0 : enabledItems.length - 1]?.focus();
      return;
    }

    if (event.key === 'ArrowLeft' && isSubmenu) {
      event.preventDefault();
      const parentId = submenu?.parentId;
      setSubmenu(null);
      if (parentId) {
        rootRef.current
          ?.querySelector<HTMLButtonElement>(`[data-menu-item-id="${parentId}"]`)
          ?.focus();
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      const target = document.activeElement;
      if (!(target instanceof HTMLButtonElement)) return;
      const item = items.find(
        (candidate) => candidate.type !== 'separator' && candidate.id === target.dataset.menuItemId,
      );
      if (item?.type !== 'separator' && item?.subItems?.length) {
        event.preventDefault();
        openSubmenu(item, target);
        window.requestAnimationFrame(() => {
          if (submenuRef.current) getEnabledItems(submenuRef.current)[0]?.focus();
        });
      }
    }
  }

  function renderItems(entries: ContextMenuEntry[], isNested = false) {
    return entries.map((item) => {
      if (item.type === 'separator') {
        return <div key={item.id} className="context-menu-separator" role="separator" />;
      }

      const role = item.checked === undefined ? 'menuitem' : 'menuitemradio';

      return (
        <button
          key={item.id}
          type="button"
          className={[
            'context-menu-item',
            item.danger ? 'context-menu-item--danger' : '',
            submenu?.parentId === item.id ? 'context-menu-item--expanded' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-menu-item-id={item.id}
          disabled={item.disabled}
          role={role}
          aria-checked={item.checked}
          aria-haspopup={item.subItems?.length ? 'menu' : undefined}
          aria-expanded={item.subItems?.length ? submenu?.parentId === item.id : undefined}
          onClick={(event) => {
            if (item.subItems?.length) {
              openSubmenu(item, event.currentTarget);
              return;
            }
            item.onSelect?.();
            onClose();
          }}
          onMouseEnter={
            isNested
              ? undefined
              : (event: MouseEvent<HTMLButtonElement>) => {
                  openSubmenu(item, event.currentTarget);
                }
          }
        >
          <span className="context-menu-item-label">{item.label}</span>
          {item.hint ? <span className="context-menu-item-hint">{item.hint}</span> : null}
          {item.subItems?.length ? (
            <span className="context-menu-chevron" aria-hidden="true">
              ›
            </span>
          ) : null}
          {item.checked ? (
            <span className="context-menu-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </button>
      );
    });
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        ref={rootRef}
        className="context-menu"
        role="menu"
        tabIndex={-1}
        aria-label={ariaLabel}
        style={{ left: position.left, top: position.top }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => handleMenuKeyDown(event)}
      >
        {renderItems(items)}
      </div>
      {submenu ? (
        <div
          ref={submenuRef}
          className="context-menu context-submenu"
          role="menu"
          aria-label={ariaLabel}
          style={{ left: submenu.left, top: submenu.top }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => handleMenuKeyDown(event, true)}
        >
          {renderItems(submenu.items, true)}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
