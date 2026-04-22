import Fastify from 'fastify';

export function buildGitHubAppServer() {
  const server = Fastify({ logger: true });

  server.get('/health', async () => ({
    service: 'github-app',
    status: 'ok',
  }));

  server.post('/webhooks/github', async () => ({
    accepted: true,
    status: 'placeholder',
  }));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildGitHubAppServer();
  const port = Number(process.env.AGENTS_COMPANY_GITHUB_APP_PORT ?? '3001');

  server.listen({ port, host: '0.0.0.0' }).catch((error) => {
    server.log.error(error);
    process.exitCode = 1;
  });
}
