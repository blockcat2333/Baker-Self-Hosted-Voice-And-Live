import { eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { users } from '../schema/users';
import type { CreateUserInput, UsersRepository } from './types';

export function createUsersRepository(executor: DatabaseExecutor): UsersRepository {
  return {
    async create(input: CreateUserInput) {
      const [user] = await executor.insert(users).values(input).returning();
      if (!user) {
        throw new Error('Expected user insert to return a row.');
      }

      return user;
    },
    async findByEmail(email: string) {
      const [user] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    },
    async findById(id: string) {
      const [user] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
      return user ?? null;
    },
    async update(id, input) {
      const [user] = await executor
        .update(users)
        .set(input)
        .where(eq(users.id, id))
        .returning();
      return user ?? null;
    },
  };
}
