import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { closePool, getPool } from './pool';

export async function seed() {
  const pool = getPool();
  const companyId = `company_${randomUUID()}`;

  await pool.query(
    `
      insert into companies (company_id, slug, display_name, status)
      values ($1, $2, $3, $4)
      on conflict (slug) do nothing
    `,
    [companyId, 'escalona-labs', 'Escalona Labs', 'active'],
  );
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  seed()
    .then(() => {
      console.log('control-plane seed complete');
    })
    .finally(async () => {
      await closePool();
    });
}
