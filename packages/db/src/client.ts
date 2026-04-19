import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type DatabaseSchema = typeof schema;
export type DatabaseClient = NodePgDatabase<DatabaseSchema> & { $client: Pool };
export type DatabaseTransaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
export type DatabaseExecutor = DatabaseClient | DatabaseTransaction;

export function createDatabaseClient(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return {
    db,
    async close() {
      await pool.end();
    },
    pool,
  };
}
