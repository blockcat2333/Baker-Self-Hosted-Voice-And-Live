import { HealthResponseSchema } from '@baker/protocol';

interface HealthRouteRegistrar {
  get(path: string, handler: () => Promise<unknown>): unknown;
}

export function registerHealthRoute(app: HealthRouteRegistrar) {
  app.get('/health', async () =>
    HealthResponseSchema.parse({
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    }),
  );
}
