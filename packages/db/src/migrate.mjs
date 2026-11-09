import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

// Applied in a transaction per migration. Requires DATABASE_URL and installed pg dependency.
export async function applyMigrations(pool, dir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')) {
  const files = (await readdir(dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const filename of files) {
      const contents = await readFile(resolve(dir, filename), 'utf8');
      const {createHash} = await import('node:crypto');
      const checksum = createHash('sha256').update(contents).digest('hex');
      await client.query('BEGIN');
      try {
        // Advisory transaction lock serializes migration runners.
        await client.query('SELECT pg_advisory_xact_lock(40631, 2002)');
        const existing = await client.query('SELECT checksum FROM schema_migrations WHERE filename=$1', [filename]);
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== checksum) throw new Error(`Migration modified after apply: ${filename}`);
          await client.query('COMMIT');
          continue;
        }
        await client.query(contents);
        await client.query('INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)', [filename, checksum]);
        await client.query('COMMIT');
        process.stdout.write(`Applied ${filename}\n`);
      } catch (err) {await client.query('ROLLBACK'); throw err;}
    }
  } finally {client.release();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {await applyMigrations(pool);} finally {await pool.end();}
}
