import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const apiHost = process.env.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? '3001';
const apiTarget = `http://${apiHost}:${apiPort}`;

const gatewayHost = process.env.GATEWAY_HOST ?? '127.0.0.1';
const gatewayPort = process.env.GATEWAY_PORT ?? '3002';
const gatewayTarget = `ws://${gatewayHost}:${gatewayPort}`;

function parseAllowedHosts(value: string | undefined): string[] | true | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  if (trimmed === '*' || trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'all') return true;
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Default to allowing all hosts so a self-hosted dev instance can be accessed via
// arbitrary domains without config changes. This is convenient but less secure
// (DNS rebinding). For tighter safety, set VITE_ALLOWED_HOSTS to a comma-separated
// list (or a single `.example.com` wildcard).
const allowedHosts = parseAllowedHosts(process.env.VITE_ALLOWED_HOSTS ?? process.env.ALLOWED_HOSTS) ?? true;

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      '@baker/client': fileURLToPath(new URL('../../packages/client/src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT ?? 80),
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
    proxy: {
      '/v1': {
        changeOrigin: true,
        target: apiTarget,
      },
      '/health': {
        changeOrigin: true,
        target: apiTarget,
      },
      '/ws': {
        changeOrigin: true,
        target: gatewayTarget,
        ws: true,
      },
    },
  },
});
