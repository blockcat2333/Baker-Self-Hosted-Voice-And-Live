import type { DatabaseAccess, RepositoryContext, ServerSettingsRecord } from '@baker/db';
import { parseAppEnv } from '@baker/shared';

import { hashPassword, verifyPassword } from './password';
import { DEFAULT_WORKSPACE_SLUG } from './default-workspace';

export const SERVER_SETTINGS_ID = 'default';
const LEGACY_DEFAULT_ADMIN_PASSWORD = 'change-me-admin-password';

export async function getOrCreateServerSettings(
  dataAccess: Pick<DatabaseAccess, 'serverSettings'>,
): Promise<ServerSettingsRecord> {
  const env = parseAppEnv();
  const existing = await dataAccess.serverSettings.findById(SERVER_SETTINGS_ID);
  if (existing) {
    const usesLegacyDefault = await verifyPassword(
      LEGACY_DEFAULT_ADMIN_PASSWORD,
      existing.adminPasswordHash,
    );

    if (usesLegacyDefault && env.ADMIN_PANEL_PASSWORD !== LEGACY_DEFAULT_ADMIN_PASSWORD) {
      const migrated = await dataAccess.serverSettings.update(existing.id, {
        adminPasswordHash: await hashPassword(env.ADMIN_PANEL_PASSWORD),
      });
      if (migrated) {
        return migrated;
      }
    }

    return existing;
  }
  return dataAccess.serverSettings.create({
    adminPasswordHash: await hashPassword(env.ADMIN_PANEL_PASSWORD),
    allowPublicRegistration: true,
    appPort: 5174,
    id: SERVER_SETTINGS_ID,
    serverName: 'Baker',
    webEnabled: true,
    webPort: env.WEB_PORT,
  });
}

export async function verifyAdminPassword(
  dataAccess: Pick<DatabaseAccess, 'serverSettings'>,
  password: string,
): Promise<boolean> {
  const settings = await getOrCreateServerSettings(dataAccess);
  return verifyPassword(password, settings.adminPasswordHash);
}

export async function syncWorkspaceServerName(
  repositories: Pick<RepositoryContext, 'guilds'>,
  serverName: string,
) {
  const guild = await repositories.guilds.findBySlug(DEFAULT_WORKSPACE_SLUG);
  if (!guild) {
    return null;
  }

  return repositories.guilds.update(guild.id, { name: serverName });
}
