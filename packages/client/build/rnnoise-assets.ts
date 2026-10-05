import { readFileSync } from 'node:fs';

/** Include upstream licenses in each distributable alongside the AI model. */
export function rnnoiseNoticesPlugin() {
  return {
    name: 'baker-rnnoise-notices',
    generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'third-party/rnnoise-notices.txt',
        source: readFileSync(new URL('../licenses/RNNOISE-NOTICES.txt', import.meta.url), 'utf8'),
      });
    },
  };
}
