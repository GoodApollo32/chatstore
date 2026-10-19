import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

// Same relative location from src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');

/** Applies any migration files not yet applied, in filename order. Safe to run on every start. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Database update ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}
