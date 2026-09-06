import { Module } from '@nestjs/common';

import { MiaodaOrdinaryArtifactLocatorRegistry } from './miaoda-ordinary-artifact-locator.registry';
import { MiaodaOrdinaryArtifactStoreAdapter } from './miaoda-ordinary-artifact-store.adapter';

/** Shared DI ownership for the same storage adapter used by parsing and review. */
@Module({
  providers: [
    MiaodaOrdinaryArtifactLocatorRegistry,
    MiaodaOrdinaryArtifactStoreAdapter,
  ],
  exports: [MiaodaOrdinaryArtifactStoreAdapter],
})
export class OrdinaryArtifactStorageModule {}
