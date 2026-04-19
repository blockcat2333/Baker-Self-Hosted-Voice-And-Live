import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const apiHost = process.env.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? '3001';
const apiTarget = `http://${apiHost}:${apiPort}`;

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
  server: {
    host: '0.0.0.0',
    port: Number(process.env.ADMIN_PORT ?? 5180),
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
    },
  },
});
