import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@baker/client/app/app.css';
import { AppRoot, createDesktopPlatformApi } from '@baker/client';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot platformApi={createDesktopPlatformApi()} />
  </StrictMode>,
);
