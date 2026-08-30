export type ServerSwitchOutcome<T> =
  | { status: 'superseded' }
  | { status: 'switched'; value: T };

/**
 * Keeps slow health checks from committing an older server after the user has
 * already selected a newer one. Validation always finishes before commit, so a
 * failed target cannot tear down the current chat or media session.
 */
export class DesktopServerSwitchCoordinator {
  private revision = 0;

  cancel() {
    this.revision += 1;
  }

  async run<T>(
    target: T,
    validate: (target: T) => Promise<T>,
    commit: (validated: T) => Promise<void>,
  ): Promise<ServerSwitchOutcome<T>> {
    const revision = ++this.revision;
    let validated: T;
    try {
      validated = await validate(target);
    } catch (error) {
      if (revision !== this.revision) return { status: 'superseded' };
      throw error;
    }

    if (revision !== this.revision) return { status: 'superseded' };
    await commit(validated);
    return { status: 'switched', value: validated };
  }
}
