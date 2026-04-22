import { access } from 'node:fs/promises';

import { chromium } from 'playwright-core';

import type { PlannedWorkItemInput } from '../packages/orchestration/src/index';
import { closePool } from '../server/control-plane/src/db/pool';
import { buildControlPlaneServer } from '../server/control-plane/src/server';
import {
  bootstrapOperatorSession,
  findAvailablePort,
  prepareSmokeRuntime,
  requestJson,
  startChildProcess,
  startFastifyServer,
} from './smoke-harness';

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((value): value is string => Boolean(value));

type CompanyRecord = {
  companyId: string;
  slug: string;
  displayName: string;
};

type ObjectiveRecord = {
  objectiveId: string;
  title: string;
};

type ObjectiveGraph = {
  workItems: Array<{
    workItemId: string;
    title: string;
  }>;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function objectiveButtonPattern(title: string) {
  return new RegExp(`^${escapeRegExp(title)}\\b`);
}

async function resolveChromeExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep searching
    }
  }

  throw new Error(
    `Unable to locate a Chrome/Chromium executable. Checked: ${CHROME_CANDIDATES.join(', ')}`,
  );
}

async function waitForText(page: import('playwright-core').Page, text: string) {
  await page.getByText(text, { exact: false }).waitFor({
    state: 'visible',
    timeout: 15_000,
  });
}

async function clickButtonByName(
  page: import('playwright-core').Page,
  name: string | RegExp,
) {
  await page.getByRole('button', { name }).click();
}

function operatorActionsCard(page: import('playwright-core').Page) {
  return page.locator('section.ui-card').filter({
    has: page.getByRole('heading', {
      name: 'Selected work item and operator actions',
    }),
  });
}

async function clickOperatorActionButton(
  page: import('playwright-core').Page,
  name: string,
) {
  await operatorActionsCard(page)
    .getByRole('button', { name, exact: true })
    .click();
}

async function main() {
  const uiPort = await findAvailablePort();
  const uiBaseUrl = `http://127.0.0.1:${uiPort}`;
  const runtime = await prepareSmokeRuntime({
    prefix: 'control_web',
    appUrl: uiBaseUrl,
  });
  const controlPlaneServer = buildControlPlaneServer();
  let controlPlaneLive:
    | Awaited<ReturnType<typeof startFastifyServer>>
    | undefined;
  let uiServer: Awaited<ReturnType<typeof startChildProcess>> | undefined;

  try {
    controlPlaneLive = await startFastifyServer(controlPlaneServer);
    uiServer = await startChildProcess({
      cmd: 'pnpm',
      args: [
        '--filter',
        '@escalonalabs/control-web',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(uiPort),
      ],
      cwd: process.cwd(),
      env: {
        VITE_CONTROL_PLANE_URL: controlPlaneLive.baseUrl,
      },
      readyUrl: uiBaseUrl,
    });

    const chromeExecutable = await resolveChromeExecutable();
    const browser = await chromium.launch({
      headless: true,
      executablePath: chromeExecutable,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      const credentials = {
        email: `control-web-${runtime.schemaName.slice(-8)}@escalonalabs.dev`,
        password: `SmokePass!${runtime.schemaName.slice(-8)}`,
        displayName: 'Control Web Operator',
      };
      const companySlug = `control-web-${runtime.schemaName.slice(-8)}`;
      const companyDisplayName = 'Control Web Company';
      const uiObjectiveTitle = 'Control web objective';
      const approvalObjectiveTitle = 'Control web approvals';
      const runWorkItemScope = 'scope:control-web-run';
      const grantWorkItemTitle = 'Grant candidate';
      const denyWorkItemTitle = 'Deny candidate';

      await page.goto(uiBaseUrl, { waitUntil: 'domcontentloaded' });
      await page
        .getByRole('heading', { name: 'Operator access required.' })
        .waitFor({ state: 'visible', timeout: 15_000 });

      await page.getByLabel('Operator email').fill(credentials.email);
      await page.getByLabel('Password').fill(credentials.password);
      await page.getByLabel('Display name').fill(credentials.displayName);
      await clickButtonByName(page, 'Bootstrap operator');
      await page
        .getByRole('button', { name: 'Refresh now' })
        .waitFor({ state: 'visible', timeout: 15_000 });

      await page.getByLabel('Company slug').fill(companySlug);
      await page.getByLabel('Display name').fill(companyDisplayName);
      await clickButtonByName(page, 'Create company');
      await waitForText(page, 'Company created from control web.');
      await page
        .getByRole('button', {
          name: new RegExp(escapeRegExp(companyDisplayName)),
        })
        .waitFor({ state: 'visible', timeout: 15_000 });

      await page.getByLabel('Objective title').fill(uiObjectiveTitle);
      await page
        .getByLabel('Objective summary')
        .fill('This objective is created from the browser smoke.');
      await clickButtonByName(page, 'Create objective');
      await waitForText(page, 'Objective created from control web.');
      await page
        .getByRole('button', { name: objectiveButtonPattern(uiObjectiveTitle) })
        .waitFor({ state: 'visible', timeout: 15_000 });

      const operatorSession = await bootstrapOperatorSession({
        baseUrl: controlPlaneLive.baseUrl,
        credentials,
      });
      const operatorHeaders = {
        cookie: operatorSession.cookie,
      };

      const companies = await requestJson<CompanyRecord[]>({
        baseUrl: controlPlaneLive.baseUrl,
        path: '/companies',
        headers: operatorHeaders,
      });
      const company = companies.json?.find(
        (entry) => entry.slug === companySlug,
      );
      if (!company) {
        throw new Error(
          'Control-web smoke could not resolve the created company.',
        );
      }

      const objectives = await requestJson<ObjectiveRecord[]>({
        baseUrl: controlPlaneLive.baseUrl,
        path: `/objectives?companyId=${encodeURIComponent(company.companyId)}`,
        headers: operatorHeaders,
      });
      const uiObjective = objectives.json?.find(
        (objective) => objective.title === uiObjectiveTitle,
      );
      if (!uiObjective) {
        throw new Error(
          'Control-web smoke could not resolve the UI-created objective.',
        );
      }

      const uiObjectiveGraph = await requestJson<ObjectiveGraph>({
        baseUrl: controlPlaneLive.baseUrl,
        path: `/objectives/${uiObjective.objectiveId}/graph`,
        headers: operatorHeaders,
      });
      const uiRunWorkItemId = uiObjectiveGraph.json?.workItems[0]?.workItemId;
      const uiRunWorkItemTitle = uiObjectiveGraph.json?.workItems[0]?.title;
      if (!uiRunWorkItemId || !uiRunWorkItemTitle) {
        throw new Error(
          'Control-web smoke could not resolve the UI-created work item.',
        );
      }

      const approvalObjective = await requestJson<{
        objective: { objectiveId: string };
      }>({
        baseUrl: controlPlaneLive.baseUrl,
        path: '/objectives',
        method: 'POST',
        headers: {
          ...operatorHeaders,
          'x-idempotency-key': `control-web-approval-${runtime.schemaName}`,
        },
        body: {
          companyId: company.companyId,
          title: approvalObjectiveTitle,
          requestedWorkItems: [
            {
              title: grantWorkItemTitle,
              requiresApproval: true,
              scopeRef: 'scope:control-web-grant',
            } satisfies PlannedWorkItemInput,
            {
              title: denyWorkItemTitle,
              requiresApproval: true,
              scopeRef: 'scope:control-web-deny',
            } satisfies PlannedWorkItemInput,
          ],
        },
      });
      const approvalObjectiveId = approvalObjective.json?.objective.objectiveId;
      if (!approvalObjectiveId) {
        throw new Error(
          'Control-web smoke could not create the approval objective.',
        );
      }

      const dispatchRun = await requestJson<{
        run?: {
          runId: string;
        };
      }>({
        baseUrl: controlPlaneLive.baseUrl,
        path: `/work-items/${uiRunWorkItemId}/dispatch`,
        method: 'POST',
        headers: {
          ...operatorHeaders,
          'x-idempotency-key': `control-web-run-${runtime.schemaName}`,
        },
        body: {
          assignedAgentId: 'agent.control-web.smoke',
          scopeAllowlist: [runWorkItemScope],
        },
      });
      const runId = dispatchRun.json?.run?.runId;
      if (!runId) {
        throw new Error(
          'Control-web smoke could not dispatch the run work item.',
        );
      }

      await clickButtonByName(page, 'Refresh now');

      await page
        .getByRole('heading', { name: 'Recent canonical events' })
        .waitFor({ state: 'visible', timeout: 15_000 });
      await page
        .getByRole('button', { name: objectiveButtonPattern(uiObjectiveTitle) })
        .click();
      await page
        .getByRole('button', {
          name: new RegExp(escapeRegExp(uiRunWorkItemTitle)),
        })
        .click();
      await waitForText(page, runId);

      await page
        .getByRole('button', {
          name: objectiveButtonPattern(approvalObjectiveTitle),
        })
        .click();
      await page
        .getByRole('button', {
          name: new RegExp(escapeRegExp(grantWorkItemTitle)),
        })
        .click();
      await clickOperatorActionButton(page, 'Grant');
      await waitForText(page, 'Approval grant completed.');

      await page
        .getByRole('button', {
          name: new RegExp(escapeRegExp(denyWorkItemTitle)),
        })
        .click();
      await clickOperatorActionButton(page, 'Deny');
      await waitForText(page, 'Approval deny completed.');
      await clickOperatorActionButton(page, 'Cancel');
      await waitForText(page, 'Work item cancel completed.');
      await clickOperatorActionButton(page, 'Requeue');
      await waitForText(page, 'Work item requeue completed.');

      console.log(
        JSON.stringify(
          {
            controlPlaneBaseUrl: controlPlaneLive.baseUrl,
            controlWebBaseUrl: uiBaseUrl,
            companySlug,
            companyDisplayName,
            uiObjectiveTitle,
            approvalObjectiveTitle,
            runId,
            browserExecutable: chromeExecutable,
            verifiedActions: [
              'bootstrap',
              'create-company',
              'create-objective',
              'run-detail',
              'grant-approval',
              'deny-approval',
              'cancel-work-item',
              'requeue-work-item',
              'timeline-visible',
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
    }
  } finally {
    await uiServer?.stop();
    await controlPlaneLive?.close();
    await runtime.restoreEnvironment();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
