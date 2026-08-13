import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { UnconfiguredU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/unconfigured-u0-full-package-validator.adapter';

const PACKAGE_ID = 'urn:techpub:package:v1:sha256:' + '1'.repeat(64);
const ARTIFACT: UnifiedPackageArtifactDescriptor = {
  storeRole: 'UnifiedArtifactStoreCandidate',
  ref: 'artifact://UnifiedArtifactStoreCandidate/test/package.json',
  sha256: '2'.repeat(64),
  byteLength: 2,
  mediaType: 'application/json',
};
const FAILURE_ID =
  'urn:techpub:parse-failure:v1:sha256:' + '5'.repeat(64);

describe('U0FullValidationService', () => {
  it('fails closed when the host has not configured the full validator port', async () => {
    const service = new U0FullValidationService(
      new UnconfiguredU0FullPackageValidatorAdapter(),
    );

    await expect(
      service.validate({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        packageId: PACKAGE_ID,
      }),
    ).rejects.toThrow(
      'CANONICAL_ROLE_NOT_VERIFIED:U0_FULL_VALIDATOR_UNCONFIGURED',
    );
  });

  it.each([
    ['packageId', 'urn:techpub:package:v1:sha256:' + '3'.repeat(64)],
    ['artifactSha256', '4'.repeat(64)],
    ['contractRevision', 'candidate.1'],
  ] as const)(
    'rejects a full-validator proof with mismatched %s',
    async (field, value) => {
      const service = new U0FullValidationService({
        validateActualBytes: async () => ({
          status: 'FULL_STRICT_VALIDATOR_PASSED',
          validatorId: 'U0Frozen2SchemaSemanticValidator',
          validatorRevision: 'u0-fa69ada-frozen.2',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
          packageId: PACKAGE_ID,
          artifactSha256: ARTIFACT.sha256,
          [field]: value,
        }),
        validateFailureReportActualBytes: async () => {
          throw new Error('TEST_FAILURE_VALIDATOR_NOT_USED');
        },
      });

      await expect(
        service.validate({
          artifact: ARTIFACT,
          bytes: new TextEncoder().encode('{}'),
          packageId: PACKAGE_ID,
        }),
      ).rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:PROOF_BINDING_MISMATCH');
    },
  );

  it('accepts an exactly bound frozen.2 ParseFailureReport proof', async () => {
    const service = new U0FullValidationService({
      validateActualBytes: async () => {
        throw new Error('TEST_PACKAGE_VALIDATOR_NOT_USED');
      },
      validateFailureReportActualBytes: async () => ({
        status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
        validatorId: 'U0Frozen2ParseFailureReportValidator',
        validatorRevision: 'u0-fa69ada-frozen.2',
        contractId: 'techpub.parse-failure-report.v1',
        contractRevision: 'frozen.2',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        failureId: FAILURE_ID,
        artifactSha256: ARTIFACT.sha256,
      }),
    });

    await expect(
      service.validateFailureReport({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        failureId: FAILURE_ID,
      }),
    ).resolves.toMatchObject({
      status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
      failureId: FAILURE_ID,
      artifactSha256: ARTIFACT.sha256,
    });
  });

  it('rejects a ParseFailureReport proof not bound to the actual artifact', async () => {
    const service = new U0FullValidationService({
      validateActualBytes: async () => {
        throw new Error('TEST_PACKAGE_VALIDATOR_NOT_USED');
      },
      validateFailureReportActualBytes: async () => ({
        status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
        validatorId: 'U0Frozen2ParseFailureReportValidator',
        validatorRevision: 'u0-fa69ada-frozen.2',
        contractId: 'techpub.parse-failure-report.v1',
        contractRevision: 'frozen.2',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        failureId: FAILURE_ID,
        artifactSha256: '6'.repeat(64),
      }),
    });

    await expect(
      service.validateFailureReport({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        failureId: FAILURE_ID,
      }),
    ).rejects.toThrow(
      'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:PROOF_BINDING_MISMATCH',
    );
  });

  it('fails closed for FailureReport when the full U0 port is unconfigured', async () => {
    const service = new U0FullValidationService(
      new UnconfiguredU0FullPackageValidatorAdapter(),
    );

    await expect(
      service.validateFailureReport({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        failureId: FAILURE_ID,
      }),
    ).rejects.toThrow(
      'CANONICAL_ROLE_NOT_VERIFIED:U0_FAILURE_VALIDATOR_UNCONFIGURED',
    );
  });
});
