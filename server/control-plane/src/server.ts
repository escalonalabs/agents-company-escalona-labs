import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import type { Company } from '@escalonalabs/domain';
import {
  createCompanyCreatedEvent,
  createInitialState,
  nextStreamSequence,
  replayAggregate,
} from '@escalonalabs/kernel';

import { loadControlPlaneConfig } from './config';
import {
  appendDomainEvent,
  getCommandLogEntry,
  listDomainEvents,
  recordCommandLogEntry,
} from './db/events';
import { getPool } from './db/pool';

interface CompanyRow {
  company_id: string;
  slug: string;
  display_name: string;
  status: Company['status'];
  created_at: string;
}

function mapCompanyRow(row: CompanyRow): Company {
  return {
    companyId: row.company_id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

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
    const result = await pool.query<CompanyRow>(
      'select company_id, slug, display_name, status, created_at from companies order by created_at asc',
    );

    return result.rows.map(mapCompanyRow);
  });

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId',
    async (request, reply) => {
      const pool = getPool();
      const result = await pool.query<CompanyRow>(
        `
          select company_id, slug, display_name, status, created_at
          from companies
          where company_id = $1
          limit 1
        `,
        [request.params.companyId],
      );

      const row = result.rows[0];
      if (!row) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      return mapCompanyRow(row);
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/replay',
    async (request, reply) => {
      const pool = getPool();
      const events = await listDomainEvents(pool, {
        companyId: request.params.companyId,
        aggregateType: 'company',
        aggregateId: request.params.companyId,
      });

      if (events.length === 0) {
        reply.code(404);
        return { message: 'No ledger events found for company.' };
      }

      const replayedState = replayAggregate(events);

      return {
        companyId: request.params.companyId,
        eventCount: events.length,
        lastEventId: replayedState.lastEventId ?? null,
        company: replayedState.companies[request.params.companyId] ?? null,
      };
    },
  );

  server.get('/events', async () => {
    const pool = getPool();
    return listDomainEvents(pool, { limit: 100 });
  });

  server.post<{ Body: { slug: string; displayName: string } }>(
    '/companies',
    async (request, reply) => {
      const pool = getPool();
      const idempotencyKeyHeader = request.headers['x-idempotency-key'];
      const idempotencyKey =
        typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.trim()
          ? idempotencyKeyHeader
          : `company:create:${request.body.slug}`;

      const existingCompanyResult = await pool.query<CompanyRow>(
        `
          select company_id, slug, display_name, status, created_at
          from companies
          where slug = $1
          limit 1
        `,
        [request.body.slug],
      );
      const existingCompany = existingCompanyResult.rows[0];

      if (existingCompany) {
        const duplicateLog = await getCommandLogEntry(
          pool,
          existingCompany.company_id,
          idempotencyKey,
        );

        if (!duplicateLog) {
          await recordCommandLogEntry(pool, {
            commandId: `cmd_duplicate_${randomUUID()}`,
            companyId: existingCompany.company_id,
            aggregateId: existingCompany.company_id,
            commandType: 'company.create',
            idempotencyKey,
            receivedAt: new Date().toISOString(),
            resolutionStatus: 'duplicate',
            resultEventIds: [],
          });
        }

        reply.code(200);
        return {
          company: mapCompanyRow(existingCompany),
          duplicate: true,
        };
      }

      const company: Company = {
        companyId: `company_${randomUUID()}`,
        slug: request.body.slug,
        displayName: request.body.displayName,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      const commandId = `cmd_${randomUUID()}`;
      const client = await pool.connect();

      try {
        await client.query('begin');

        const existingEvents = await listDomainEvents(client, {
          companyId: company.companyId,
          aggregateType: 'company',
          aggregateId: company.companyId,
          limit: 1000,
        });
        const companyCreatedEvent = createCompanyCreatedEvent({
          company,
          eventId: `evt_${randomUUID()}`,
          streamSequence: nextStreamSequence(
            existingEvents,
            'company',
            company.companyId,
          ),
          commandId,
          idempotencyKey,
          actorRef: 'control-plane',
        });

        await appendDomainEvent(client, companyCreatedEvent);
        await client.query(
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
        await recordCommandLogEntry(client, {
          commandId,
          companyId: company.companyId,
          aggregateId: company.companyId,
          commandType: 'company.create',
          idempotencyKey,
          receivedAt: company.createdAt,
          resolutionStatus: 'accepted',
          resultEventIds: [companyCreatedEvent.eventId],
        });

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      reply.code(201);
      return {
        company,
        duplicate: false,
      };
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
