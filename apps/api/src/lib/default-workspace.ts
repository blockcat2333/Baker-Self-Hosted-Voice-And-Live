/**
 * Default shared workspace.
 *
 * Baker uses a single shared workspace (guild) that all users join on
 * registration.  The first user to register becomes the nominal owner;
 * every subsequent user is added as a member.
 *
 * The workspace is identified by its slug ('baker') so the lookup is
 * idempotent and survives server restarts.
 *
 * Concurrent first-registration race:
 *   Two simultaneous first registrations could both find no workspace and
 *   both attempt to create it.  The second INSERT fails with a slug-unique
 *   constraint violation, which rolls back that registration transaction.
 *   The client receives a 500 and can retry; the second registration then
 *   finds the now-existing workspace and succeeds.  This window is
 *   vanishingly small in practice.
 */

import { createLogger } from '@baker/shared';

import type { RepositoryContext } from '@baker/db';

const log = createLogger('api:default-workspace');

export const DEFAULT_WORKSPACE_SLUG = 'baker';
export const DEFAULT_WORKSPACE_NAME = 'Baker';
export const DEFAULT_CHANNEL_NAME = 'general';

/**
 * Must be called inside a registration transaction after the user row is
 * created.
 *
 * - Looks up the shared workspace by slug.
 * - If absent (first registration on a clean DB), creates the workspace and
 *   its default 'general' channel, using this user as the nominal owner.
 * - Adds the user as a member.
 */
export async function ensureNewUserJoinsDefaultWorkspace(
  repositories: RepositoryContext,
  userId: string,
  username: string,
  workspaceName = DEFAULT_WORKSPACE_NAME,
): Promise<void> {
  let guild = await repositories.guilds.findBySlug(DEFAULT_WORKSPACE_SLUG);

  if (!guild) {
    log.info({ userId }, 'First registration — creating shared default workspace');
    guild = await repositories.guilds.create({
      name: workspaceName,
      ownerUserId: userId,
      slug: DEFAULT_WORKSPACE_SLUG,
    });

    await repositories.channels.create({
      guildId: guild.id,
      name: DEFAULT_CHANNEL_NAME,
      position: 0,
      topic: null,
      type: 'text',
      voiceQuality: 'standard',
    });

    await repositories.channels.create({
      guildId: guild.id,
      name: 'General Voice',
      position: 1,
      topic: null,
      type: 'voice',
      voiceQuality: 'standard',
    });
  }

  await repositories.guildMembers.add({
    guildId: guild.id,
    nickname: username,
    userId,
  });
}
