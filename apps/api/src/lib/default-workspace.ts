/**
 * Default shared workspace.
 *
 * Baker uses a single shared workspace (guild) that all users join on
 * registration. The first user to register becomes the nominal owner;
 * every subsequent user is added as a member.
 *
 * The workspace is identified by its slug ('baker') so the lookup is
 * idempotent and survives server restarts.
 *
 * Concurrent first registrations are safe: the workspace insert uses the
 * slug unique constraint as an atomic winner election. Only the transaction
 * that creates the workspace creates its default channels.
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
 * - If absent (first registration on a clean DB), atomically creates the
 *   workspace and its default channels, using this user as nominal owner.
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
    const createdGuild = await repositories.guilds.createIfAbsent({
      name: workspaceName,
      ownerUserId: userId,
      slug: DEFAULT_WORKSPACE_SLUG,
    });

    if (createdGuild) {
      guild = createdGuild;
      log.info(
        { userId },
        'First registration - creating shared default workspace',
      );

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
    } else {
      guild = await repositories.guilds.findBySlug(DEFAULT_WORKSPACE_SLUG);
      if (!guild) {
        throw new Error(
          'Default workspace was created concurrently but could not be loaded.',
        );
      }
    }
  }

  await repositories.guildMembers.add({
    guildId: guild.id,
    nickname: username,
    userId,
  });
}
