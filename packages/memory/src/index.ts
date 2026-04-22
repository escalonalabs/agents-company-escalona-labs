import type { ArtifactRef } from '@escalonalabs/domain';

export interface MemoryRecord {
  memoryId: string;
  companyId: string;
  sourceArtifactId: string;
  summary: string;
  provenanceRef: string;
  invalidatedAt?: string;
}

export function createMemoryRecordFromArtifact(input: {
  artifact: ArtifactRef;
  summary: string;
}): MemoryRecord {
  return {
    memoryId: `memory:${input.artifact.artifactId}`,
    companyId: input.artifact.companyId,
    sourceArtifactId: input.artifact.artifactId,
    summary: input.summary,
    provenanceRef: input.artifact.storageRef,
  };
}
