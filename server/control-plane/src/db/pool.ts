import { Pool } from 'pg';

import { loadControlPlaneConfig } from '../config';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const config = loadControlPlaneConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }

  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
