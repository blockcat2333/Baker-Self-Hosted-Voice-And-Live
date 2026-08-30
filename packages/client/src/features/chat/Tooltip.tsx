import type { ReactNode } from 'react';

interface TooltipProps {
  children: ReactNode;
  label: string;
  open?: boolean;
  placement?: 'bottom' | 'right' | 'top';
}

export function Tooltip({ children, label, open = false, placement = 'top' }: TooltipProps) {
  return (
    <span className={`ui-tooltip ui-tooltip--${placement}${open ? ' ui-tooltip--open' : ''}`}>
      {children}
      <span className="ui-tooltip-content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
