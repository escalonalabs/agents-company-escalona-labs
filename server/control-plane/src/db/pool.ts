import { Pool } from 'pg';

import { loadControlPlaneConfig } from '../config';

let pool: Pool | undefined;
const DATABASE_READY_TIMEOUT_MS = 60_000;
const DATABASE_RETRY_INTERVAL_MS = 2_000;

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

export async function waitForDatabaseReady() {
  const config = loadControlPlaneConfig();
  const deadline = Date.now() + DATABASE_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const healthPool = new Pool({ connectionString: config.databaseUrl });

    try {
      await healthPool.query('select 1');
      return;
    } catch (error) {
      lastError = error;
    } finally {
      await healthPool.end().catch(() => undefined);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, DATABASE_RETRY_INTERVAL_MS),
    );
  }

  const suffix =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for PostgreSQL readiness.${suffix}`);
}
