import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

const LONG_PRESS_DELAY_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

interface PressState {
  startX: number;
  startY: number;
  timer: number;
}

export function useLongPressMenu<T>(onOpen: (value: T, x: number, y: number) => void) {
  const pressRef = useRef<PressState | null>(null);
  const triggeredRef = useRef(false);

  function clearPress() {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }

  useEffect(
    () => () => {
      if (pressRef.current) {
        window.clearTimeout(pressRef.current.timer);
      }
    },
    [],
  );

  function getLongPressProps(value: T) {
    return {
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!triggeredRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        triggeredRef.current = false;
      },
      onPointerCancel() {
        clearPress();
        triggeredRef.current = false;
      },
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === 'mouse') return;
        clearPress();
        const startX = event.clientX;
        const startY = event.clientY;
        const timer = window.setTimeout(() => {
          triggeredRef.current = true;
          onOpen(value, startX, startY);
          pressRef.current = null;
        }, LONG_PRESS_DELAY_MS);
        pressRef.current = { startX, startY, timer };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const press = pressRef.current;
        if (!press) return;
        if (
          Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >
          LONG_PRESS_MOVE_TOLERANCE_PX
        ) {
          clearPress();
        }
      },
      onPointerUp() {
        clearPress();
        if (triggeredRef.current) {
          window.setTimeout(() => {
            triggeredRef.current = false;
          }, 0);
        }
      },
    };
  }

  return getLongPressProps;
}
