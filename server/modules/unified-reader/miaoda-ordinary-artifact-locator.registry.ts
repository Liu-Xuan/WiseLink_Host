import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { ordinaryArtifactLocator } from '../../database/schema';

/** Internal storage facts only; never part of browser/model TaskEnvelopes. */
export interface OrdinaryArtifactLocator {
  artifactRef: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  bucketId: string;
  filePath: string;
  providerObjectId: string;
}

export interface OrdinaryArtifactLocatorRegistryPort {
  find(artifactRef: string): Promise<OrdinaryArtifactLocator | null>;
  record(locator: OrdinaryArtifactLocator): Promise<void>;
}

const columns = {
  artifactRef: ordinaryArtifactLocator.artifactRef,
  sha256: ordinaryArtifactLocator.sha256,
  byteLength: ordinaryArtifactLocator.byteLength,
  mediaType: ordinaryArtifactLocator.mediaType,
  bucketId: ordinaryArtifactLocator.bucketId,
  filePath: ordinaryArtifactLocator.filePath,
  providerObjectId: ordinaryArtifactLocator.providerObjectId,
};

@Injectable()
export class MiaodaOrdinaryArtifactLocatorRegistry implements OrdinaryArtifactLocatorRegistryPort {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async find(artifactRef: string): Promise<OrdinaryArtifactLocator | null> {
    const [row] = await this.db
      .select(columns)
      .from(ordinaryArtifactLocator)
      .where(eq(ordinaryArtifactLocator.artifactRef, artifactRef))
      .limit(1);
    return row ?? null;
  }

  async record(locator: OrdinaryArtifactLocator): Promise<void> {
    await this.db
      .insert(ordinaryArtifactLocator)
      .values(locator)
      .onConflictDoNothing({ target: ordinaryArtifactLocator.artifactRef });
    const stored = await this.find(locator.artifactRef);
    if (
      !stored ||
      Object.keys(columns).some((key) => {
        const field = key as keyof OrdinaryArtifactLocator;
        return stored[field] !== locator[field];
      })
    ) {
      throw new Error('ARTIFACT_LOCATOR_REGISTRATION_CONFLICT');
    }
  }
}
