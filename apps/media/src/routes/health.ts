import { HealthResponseSchema } from '@baker/protocol';
import { BAKER_VERSION } from '@baker/shared';

interface HealthRouteRegistrar {
  get(path: string, handler: () => Promise<unknown>): unknown;
}

export function registerHealthRoute(app: HealthRouteRegistrar) {
  app.get('/health', async () =>
    HealthResponseSchema.parse({
      service: 'media',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: BAKER_VERSION,
    }),
  );
}
