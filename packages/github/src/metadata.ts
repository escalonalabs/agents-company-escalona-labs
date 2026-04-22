import type { GitHubProjectionMetadata } from './types';

const METADATA_OPEN = '<!-- escalonalabs:projection-metadata';
const METADATA_CLOSE = '-->';

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );

    return `{${entries
      .map(
        ([key, innerValue]) =>
          `${JSON.stringify(key)}:${stableSerialize(innerValue)}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function createMetadataBlock(
  metadata: GitHubProjectionMetadata,
): string {
  return `${METADATA_OPEN}\n${stableSerialize(metadata)}\n${METADATA_CLOSE}`;
}

export function parseMetadataBlock(
  value: string | null | undefined,
): GitHubProjectionMetadata | null {
  if (!value) {
    return null;
  }

  const start = value.indexOf(METADATA_OPEN);
  if (start === -1) {
    return null;
  }

  const end = value.indexOf(METADATA_CLOSE, start);
  if (end === -1) {
    return null;
  }

  const rawPayload = value.slice(start + METADATA_OPEN.length, end).trim();

  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as GitHubProjectionMetadata;
    if (
      !parsed.companyId ||
      !parsed.aggregateType ||
      !parsed.aggregateId ||
      !parsed.sourceEventId ||
      !parsed.projectionDeliveryId ||
      !parsed.projectionVersion
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
