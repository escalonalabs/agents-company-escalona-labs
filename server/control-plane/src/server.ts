import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import type { Company } from '@escalonalabs/domain';
import { createInitialState } from '@escalonalabs/kernel';

import { loadControlPlaneConfig } from './config';
import { getPool } from './db/pool';

export function buildControlPlaneServer() {
  const server = Fastify({ logger: true });
  const state = createInitialState();

  server.get('/health', async () => ({
    service: 'control-plane',
    status: 'ok',
    companiesLoaded: Object.keys(state.companies).length,
  }));

  server.get('/companies', async () => {
    const pool = getPool();
    const result = await pool.query<{
      company_id: string;
      slug: string;
      display_name: string;
      status: Company['status'];
      created_at: string;
    }>(
      'select company_id, slug, display_name, status, created_at from companies order by created_at asc',
    );

    return result.rows.map((row) => ({
      companyId: row.company_id,
      slug: row.slug,
      displayName: row.display_name,
      status: row.status,
      createdAt: row.created_at,
    }));
  });

  server.post<{ Body: { slug: string; displayName: string } }>(
    '/companies',
    async (request, reply) => {
      const pool = getPool();
      const company: Company = {
        companyId: `company_${randomUUID()}`,
        slug: request.body.slug,
        displayName: request.body.displayName,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      await pool.query(
        `
          insert into companies (company_id, slug, display_name, status, created_at)
          values ($1, $2, $3, $4, $5)
        `,
        [
          company.companyId,
          company.slug,
          company.displayName,
          company.status,
          company.createdAt,
        ],
      );

      reply.code(201);
      return company;
    },
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadControlPlaneConfig();
  const server = buildControlPlaneServer();

  server.listen({ port: config.port, host: '0.0.0.0' }).catch((error) => {
    server.log.error(error);
    process.exitCode = 1;
  });
}
