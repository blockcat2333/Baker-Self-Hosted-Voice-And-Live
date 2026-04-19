import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import './admin.css';
import { AdminApp } from './AdminApp';
import { i18n } from './i18n';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <AdminApp apiBaseUrl={import.meta.env.VITE_API_BASE_URL} />
    </I18nextProvider>
  </StrictMode>,
);
