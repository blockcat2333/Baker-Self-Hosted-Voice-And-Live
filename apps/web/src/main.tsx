import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@baker/client/app/app.css';
import { AppRoot, createBrowserPlatformApi } from '@baker/client';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot
      apiBaseUrl={import.meta.env.VITE_API_BASE_URL}
      gatewayUrl={import.meta.env.VITE_GATEWAY_URL}
      mediaBaseUrl={import.meta.env.VITE_MEDIA_BASE_URL}
      platformApi={createBrowserPlatformApi()}
    />
  </StrictMode>,
);
