import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const fromRoot = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@escalonalabs/domain': fromRoot('./packages/domain/src/index.ts'),
      '@escalonalabs/kernel': fromRoot('./packages/kernel/src/index.ts'),
      '@escalonalabs/orchestration': fromRoot(
        './packages/orchestration/src/index.ts',
      ),
      '@escalonalabs/execution': fromRoot('./packages/execution/src/index.ts'),
      '@escalonalabs/memory': fromRoot('./packages/memory/src/index.ts'),
      '@escalonalabs/github': fromRoot('./packages/github/src/index.ts'),
      '@escalonalabs/sdk': fromRoot('./packages/sdk/src/index.ts'),
      '@escalonalabs/ui': fromRoot('./packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'server/control-plane/**/*.test.ts'],
    environment: 'node',
  },
});
