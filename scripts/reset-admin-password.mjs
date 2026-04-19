/**
 * Reset the admin panel password directly in the local DB.
 *
 * This is meant for local dev recovery when the management password is unknown.
 *
 * Usage:
 *   ADMIN_PASSWORD=admin node scripts/reset-admin-password.mjs
 *
 * Optional:
 *   DATABASE_URL=postgres://... node scripts/reset-admin-password.mjs
 *   WEB_PORT=80 node scripts/reset-admin-password.mjs
 */

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));

let Pool;
try {
  ({ Pool } = require('pg'));
} catch (err) {
  throw new Error(
    `Could not resolve 'pg'. Install dependencies (pnpm install) and try again. ` +
    `Details: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const DEFAULT_DATABASE_URL = 'postgres://baker:baker@127.0.0.1:5432/baker';
const SERVER_SETTINGS_ID = 'default';

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function run() {
  const password = process.env.ADMIN_PASSWORD ?? 'admin';
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const webPort = Number(process.env.WEB_PORT ?? '80');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const hash = await hashPassword(password);

    // Upsert the singleton settings row.
    await pool.query(
      `
      INSERT INTO server_settings (
        id,
        admin_password_hash,
        allow_public_registration,
        app_port,
        server_name,
        web_enabled,
        web_port
      )
      VALUES ($1, $2, true, 5174, 'Baker', true, $3)
      ON CONFLICT (id) DO UPDATE
        SET admin_password_hash = EXCLUDED.admin_password_hash,
            updated_at = now()
      `,
      [SERVER_SETTINGS_ID, hash, webPort],
    );

    console.log(`OK reset admin password: id=${SERVER_SETTINGS_ID}`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(`Reset admin password failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
