import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../src/db';

const migrationsDir = new URL('../migrations/', import.meta.url);
// Concurrent runners queue on this lock instead of racing.
const MIGRATION_LOCK_ID = 727_001;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));

    // Zero-padded prefixes: lexical order is apply order.
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
    const pending = files.filter((file) => !applied.has(file));

    for (const file of pending) {
      const sql = await readFile(new URL(file, migrationsDir), 'utf8');
      // One transaction per file, so a failure leaves no partial schema.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
    }
    console.log(pending.length ? `${pending.length} migration(s) applied` : 'Schema is up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
