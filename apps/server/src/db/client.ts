import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

/** A transaction handle, so services can be written once and composed into larger units. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Accepts either the pool-backed db or an open transaction. */
export type Executor = Database | Tx;

export async function closeDb(): Promise<void> {
  await pool.end();
}
