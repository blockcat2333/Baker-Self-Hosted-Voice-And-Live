import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  esbuildPlugins: [{
    name: 'audio-worklet-url',
    setup(builder) {
      // Vite handles this query for app builds; tsup emits an equivalent URL
      // alongside its separately bundled worklet for the shared client build.
      builder.onResolve({ filter: /rnnoise-worklet\.ts\?worker&url$/ }, (args) => ({
        path: args.path, namespace: 'audio-worklet-url',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'audio-worklet-url' }, () => ({
        contents: 'export default new URL("./rnnoise-worklet.js", import.meta.url).href;', loader: 'js',
      }));
    },
  }],
  async onSuccess() {
    await copyFile('licenses/RNNOISE-NOTICES.txt', 'dist/rnnoise-notices.txt');
    await build({
      entryPoints: ['src/features/voice/rnnoise-worklet.ts'],
      outfile: 'dist/rnnoise-worklet.js',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify: true,
    });
  },
});
