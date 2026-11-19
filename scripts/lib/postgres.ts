import pg from 'pg';
import { z } from 'zod';
import type { Database, Queryable } from './database.js';

function adapter(client: Pick<pg.PoolClient, 'query'>): Queryable {
  return {
    async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
      const result = await client.query(sql, values);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) { await client.query(sql); },
  };
}

/** Production and CLI always use real PostgreSQL; there is no storage fallback. */
export async function connectPostgres(url = process.env.DATABASE_URL): Promise<Database & { close(): Promise<void> }> {
  const parsed = z.string().url().refine((value) => /^postgres(?:ql)?:\/\//u.test(value)).safeParse(url);
  if (!parsed.success) throw new Error('DATABASE_URL должен задавать PostgreSQL в окружении');
  const pool = new pg.Pool({ connectionString: parsed.data, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5000, application_name: 'digital-dekanat-concept' });
  try { await pool.query('SELECT 1'); } catch { await pool.end(); throw new Error('PostgreSQL недоступен'); }
  const base = adapter(pool);
  return {
    ...base,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(adapter(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
