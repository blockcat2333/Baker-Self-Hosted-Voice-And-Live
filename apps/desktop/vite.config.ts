import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react-swc';
import { defineConfig, type PluginOption } from 'vite';
import electron from 'vite-plugin-electron/simple';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  build: {
    outDir: 'dist/renderer',
  },
  plugins: [
    react(),
    tsconfigPaths(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }) as unknown as PluginOption,
  ],
  resolve: {
    alias: {
      '@baker/client': fileURLToPath(new URL('../../packages/client/src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
});
