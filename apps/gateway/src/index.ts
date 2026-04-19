import { getServiceBinding, parseAppEnv } from '@baker/shared';

import { buildGatewayApp } from './app';

async function main() {
  const env = parseAppEnv();
  const app = await buildGatewayApp();
  const binding = getServiceBinding(env, 'gateway');

  await app.listen(binding);
}

void main();
