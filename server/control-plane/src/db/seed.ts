import { randomUUID } from 'node:crypto';

import { closePool, getPool } from './pool';

async function seed() {
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

seed()
  .then(() => {
    console.log('control-plane seed complete');
  })
  .finally(async () => {
    await closePool();
  });
