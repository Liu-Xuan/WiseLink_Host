import type { ImmutableAcceptanceReceiptOwnerPort } from './unified-reader.types';

const UNCONFIGURED_BINDING = {
  canonicalMiaodaHostId: 'UNCONFIGURED',
  tenantId: 'UNCONFIGURED',
  environment: 'UNCONFIGURED',
  roleResolutionRevision: 'UNCONFIGURED',
  roleResolutionFingerprint: 'sha256:' + '0'.repeat(64),
  canonicalArtifactStoreId: 'UNCONFIGURED',
  soleRegistrarServicePrincipal: 'UNCONFIGURED',
  immutableReceiptOwnerId: 'UNCONFIGURED',
  immutableReceiptOwnerAdapterRevision: 'UNCONFIGURED',
  immutableReceiptStoreId: 'UNCONFIGURED',
} as const;

export class UnconfiguredImmutableAcceptanceReceiptOwnerAdapter
  implements ImmutableAcceptanceReceiptOwnerPort
{
  readonly activationBinding = UNCONFIGURED_BINDING;

  async persistAndReadback(
    _input: Parameters<
      ImmutableAcceptanceReceiptOwnerPort['persistAndReadback']
    >[0],
  ): ReturnType<ImmutableAcceptanceReceiptOwnerPort['persistAndReadback']> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_UNCONFIGURED',
    );
  }
}
