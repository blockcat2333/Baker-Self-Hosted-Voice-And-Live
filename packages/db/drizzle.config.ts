import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://baker:baker@127.0.0.1:5432/baker',
  },
  dialect: 'postgresql',
  out: './migrations',
  schema: './src/schema/*.ts',
});
