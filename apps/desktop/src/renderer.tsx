import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@baker/client/app/app.css';
import { DesktopApp } from './DesktopApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
