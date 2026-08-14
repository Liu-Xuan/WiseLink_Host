import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalEntryFacadeResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import {
  CANONICAL_HOST,
  CANONICAL_MIAODA_APP_BINDING,
} from './canonical-host.constants';
import type { CanonicalMiaodaAppBindingPort } from './canonical-host.types';

@Injectable()
export class CanonicalEntryFacadeService {
  constructor(
    @Inject(CANONICAL_MIAODA_APP_BINDING)
    private readonly appBinding: CanonicalMiaodaAppBindingPort,
  ) {}

  status(
    workItem: CanonicalWorkItemProjection,
  ): CanonicalEntryFacadeResponse {
    return {
      schemaVersion: CANONICAL_HOST.entrySchemaVersion,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      phase: workItem.phase,
      documentVersionId: workItem.source.documentVersionId,
      normalizedFamily: workItem.classification.normalizedFamily,
      packageId: workItem.package?.packageId ?? null,
      packageArtifactSha256: workItem.package?.artifact.sha256 ?? null,
      failureCode:
        workItem.failure?.failureCode ??
        workItem.recordingFailure?.failureCode ??
        null,
      deepLinkPath: requiredDeepLink(
        this.appBinding.deepLinkForWorkItem(workItem.workItemId),
        workItem.workItemId,
      ),
      capabilities: {
        status: true,
        queryParsedUnits:
          workItem.phase === 'CANDIDATE_READBACK_VERIFIED' &&
          workItem.package !== null,
        deepLink: true,
        mutatesParsingState: false,
      },
    };
  }
}

function requiredDeepLink(
  binding: ReturnType<CanonicalMiaodaAppBindingPort['deepLinkForWorkItem']>,
  workItemId: string,
): string {
  if (binding.bindingStatus !== 'VERIFIED_CANONICAL' || !binding.appId.trim()) {
    throw new Error('CANONICAL_MIAODA_APP_BINDING_NOT_VERIFIED');
  }
  let parsed: URL;
  let origin: URL;
  try {
    parsed = new URL(binding.deepLink);
    origin = new URL(binding.origin);
  } catch {
    throw new Error('CANONICAL_ENTRY_INVALID:DEEP_LINK_URL');
  }
  const basePath = origin.pathname.replace(/\/$/u, '');
  const expectedPath: string =
    `${basePath}/work-items/${encodeURIComponent(workItemId)}/documents`;
  if (
    parsed.protocol !== 'https:' ||
    origin.protocol !== 'https:' ||
    parsed.origin !== origin.origin ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== expectedPath ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new Error('CANONICAL_ENTRY_INVALID:DEEP_LINK_PATH');
  }
  return parsed.toString();
}
