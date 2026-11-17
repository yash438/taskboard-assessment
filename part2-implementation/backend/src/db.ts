import pg from 'pg';

// The root .env is for local development; elsewhere DATABASE_URL is set directly.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // Missing .env is reported by the check below.
  }
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repository root.');
}

// Keep DATE as 'YYYY-MM-DD'; a JS Date at local midnight can shift the day when serialised.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
