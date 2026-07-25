import type { ReactNode } from 'react';

interface TooltipProps {
  children: ReactNode;
  label: string;
  placement?: 'bottom' | 'top';
}

export function Tooltip({ children, label, placement = 'top' }: TooltipProps) {
  return (
    <span className={`ui-tooltip ui-tooltip--${placement}`}>
      {children}
      <span className="ui-tooltip-content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
