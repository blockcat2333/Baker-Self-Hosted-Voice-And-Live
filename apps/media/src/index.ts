import { getServiceBinding, parseAppEnv } from '@baker/shared';

import { buildMediaApp } from './app';

async function main() {
  const env = parseAppEnv();
  const app = buildMediaApp();
  const binding = getServiceBinding(env, 'media');

  await app.listen(binding);
}

void main();
