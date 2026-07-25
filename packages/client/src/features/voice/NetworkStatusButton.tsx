import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type NetworkStatusLevel = 'danger' | 'good' | 'idle' | 'warn';

export interface NetworkStatusMetric {
  label: string;
  value: string;
}

interface NetworkStatusButtonProps {
  detailsLabel: string;
  label: string;
  level: NetworkStatusLevel;
  metrics: NetworkStatusMetric[];
  summary: string;
}

const VIEWPORT_GUTTER = 10;

export function NetworkStatusButton({
  detailsLabel,
  label,
  level,
  metrics,
  summary,
}: NetworkStatusButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: VIEWPORT_GUTTER, top: VIEWPORT_GUTTER });

  useLayoutEffect(() => {
    if (!isOpen) return;

    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;

    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(buttonRect.right - panelRect.width, window.innerWidth - panelRect.width - VIEWPORT_GUTTER),
    );
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const top =
      spaceBelow >= panelRect.height + VIEWPORT_GUTTER
        ? buttonRect.bottom + 8
        : Math.max(VIEWPORT_GUTTER, buttonRect.top - panelRect.height - 8);

    setPosition({ left, top });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    function closeOnViewportChange() {
      setIsOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [isOpen]);

  return (
    <span className={`network-status-control network-status-control--${level}`}>
      <button
        ref={buttonRef}
        type="button"
        className="network-status-button"
        aria-controls={isOpen ? panelId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${summary}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg className="network-status-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="16" width="3" height="5" rx="1" />
          <rect x="8" y="12" width="3" height="9" rx="1" />
          <rect x="13" y="8" width="3" height="13" rx="1" />
          <rect x="18" y="3" width="3" height="18" rx="1" />
        </svg>
        <span className="network-status-kind">{label}</span>
      </button>
      {!isOpen ? (
        <span className="network-status-tooltip" role="tooltip">
          <strong>{label}</strong>
          <span>{summary}</span>
        </span>
      ) : null}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="network-status-sheet-scrim" aria-hidden="true" />
              <section
                ref={panelRef}
                id={panelId}
                className={`network-status-details network-status-details--${level}`}
                role="dialog"
                aria-label={detailsLabel}
                style={{ left: position.left, top: position.top }}
              >
                <header className="network-status-details-header">
                  <div>
                    <p className="network-status-details-kicker">{detailsLabel}</p>
                    <h3>{label}</h3>
                  </div>
                  <span className="network-status-details-level">{summary}</span>
                </header>
                <dl className="network-status-details-grid">
                  {metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}
