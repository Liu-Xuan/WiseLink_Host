import type { Provider } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import {
  U0_FULL_PACKAGE_VALIDATOR,
  UNIFIED_ARTIFACT_STORE,
} from './unified-reader.constants';
import { MiaodaFileArtifactStoreAdapter } from './miaoda-file-artifact-store.adapter';
import {
  PythonU0FullPackageValidatorAdapter,
  type PythonU0FullPackageValidatorOptions,
} from './python-u0-full-package-validator.adapter';
import type { UnifiedHostActivationExactBinding } from './unified-reader.types';

/**
 * Hosted provider boundary consumed from Unified commit
 * 2d33803602fd0c92396c381bc4793ebc29bbd7f0.  Historical HTTP mutation
 * routes and receipt-authority builders are intentionally not re-exported.
 */
export interface MiaodaFileArtifactStoreProviderOptions {
  activationBinding: UnifiedHostActivationExactBinding;
}

export function createMiaodaFileArtifactStoreProvider(
  options: MiaodaFileArtifactStoreProviderOptions,
): Provider {
  return {
    provide: UNIFIED_ARTIFACT_STORE,
    inject: [FileService],
    useFactory: (fileService: FileService): MiaodaFileArtifactStoreAdapter =>
      new MiaodaFileArtifactStoreAdapter(
        fileService,
        options.activationBinding,
      ),
  };
}

export function createPythonU0FullPackageValidatorProvider(
  options: PythonU0FullPackageValidatorOptions,
): Provider {
  return {
    provide: U0_FULL_PACKAGE_VALIDATOR,
    useFactory: (): PythonU0FullPackageValidatorAdapter =>
      new PythonU0FullPackageValidatorAdapter(options),
  };
}

export { Frozen2CandidateReaderService } from './frozen2-candidate-reader.service';
export { MiaodaFileArtifactStoreAdapter } from './miaoda-file-artifact-store.adapter';
export {
  PythonU0FullPackageValidatorAdapter,
  type PythonU0FullPackageValidatorOptions,
} from './python-u0-full-package-validator.adapter';
export { U0FullValidationService } from './u0-full-validation.service';
export { UnifiedAcceptanceFacadeService } from './unified-acceptance-facade.service';
export {
  createAeoSpecialistReaderBridgeProvider,
  UnifiedReaderModule,
  type UnifiedReaderModuleOptions,
} from './unified-reader.module';
export { UnifiedReaderService } from './unified-reader.service';
export {
  AEO_SPECIALIST_READER_PORT,
  U0_FROZEN2_FAILURE_ADAPTER_PORT,
  U0_FULL_PACKAGE_VALIDATOR,
  UNIFIED_ARTIFACT_STORE,
  UNIFIED_READER,
} from './unified-reader.constants';
export type {
  AeoSpecialistReaderPort,
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureAdapterPort,
  U0FullPackageValidatorPort,
  UnifiedArtifactStorePort,
  UnifiedHostActivationExactBinding,
} from './unified-reader.types';
export type {
  UnifiedAcceptanceCandidateReceipt,
  UnifiedAcceptanceCorrelation,
  UnifiedAcceptanceRequest,
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageReadbackRequest,
  UnifiedPackageReadbackResponse,
  UnifiedParseFailureReport,
  UnifiedReaderReadinessResponse,
} from '@shared/api.interface';
