import type { Provider } from '@nestjs/common';

import {
  loadMasterSignedWorkItemRegistrarActivation,
  type RegistrarActivationPorts,
  UnconfiguredWorkItemRegistrarActivationAuthority,
  type WorkItemRegistrarActivationAuthority,
  type WorkItemRegistrarActivationBootstrap,
  type WorkItemRegistrarActivationReadiness,
  type WorkItemRegistrarRuntimeBinding,
  WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY,
} from './work-item-registrar-activation';

export const HOSTED_REGISTRAR_TARGET = {
  miaodaAppId: 'app_17bzc551rsg',
  baseToken: 'VorbbDXAkaHbLMsUTV2cBCW5nRd',
  tables: {
    workItems: {
      tableId: 'tblre53IWbymz982',
      capabilityId: 'wl-v31-work-items-registrar',
      fieldCount: 65,
    },
    decisions: {
      tableId: 'tbln5DlxOHYSJJ3p',
      capabilityId: 'wl-v31-decisions-registrar',
      fieldCount: 28,
    },
    executionLogs: {
      tableId: 'tbl8v4CB4VZUcb5e',
      capabilityId: 'wl-v31-execution-logs-registrar',
      fieldCount: 17,
    },
  },
} as const;

const ENV = {
  miaodaAppId: 'MIAODA_APP_ID',
  hostedDeploymentId: 'WL_REGISTRAR_HOSTED_DEPLOYMENT_ID',
  tenantId: 'WL_REGISTRAR_TENANT_ID',
  environmentId: 'WL_REGISTRAR_ENVIRONMENT_ID',
  servicePrincipalId: 'WL_REGISTRAR_SERVICE_PRINCIPAL_ID',
  artifactStoreAdapterRevision: 'WL_REGISTRAR_ARTIFACT_STORE_ADAPTER_REVISION',
  artifactStoreId: 'WL_REGISTRAR_ARTIFACT_STORE_ID',
  artifactStoreBucketId: 'WL_REGISTRAR_ARTIFACT_STORE_BUCKET_ID',
  unifiedPortRevision: 'WL_REGISTRAR_UNIFIED_PORT_REVISION',
  unifiedReaderRevision: 'WL_REGISTRAR_UNIFIED_READER_REVISION',
  noFallbackRegistryRevision: 'WL_REGISTRAR_NO_FALLBACK_REGISTRY_REVISION',
  manifestArtifactRef: 'WL_REGISTRAR_ACTIVATION_MANIFEST_REF',
  manifestArtifactSha256: 'WL_REGISTRAR_ACTIVATION_MANIFEST_SHA256',
  signingReceiptArtifactRef: 'WL_REGISTRAR_ACTIVATION_SIGNING_RECEIPT_REF',
  signingReceiptArtifactSha256:
    'WL_REGISTRAR_ACTIVATION_SIGNING_RECEIPT_SHA256',
} as const;

type HostedRegistrarEnvironment = Readonly<Record<string, string | undefined>>;

export interface HostedRegistrarProviderOptions {
  environment?: HostedRegistrarEnvironment;
  ports?: RegistrarActivationPorts;
  now?: () => number;
}

export interface HostedRegistrarProviderPreparation {
  status: 'CAN_BIND' | 'BLOCKED';
  blockerCodes: string[];
  target: typeof HOSTED_REGISTRAR_TARGET;
  bootstrap: WorkItemRegistrarActivationBootstrap | null;
  runtime: WorkItemRegistrarRuntimeBinding | null;
}

export interface HostedRegistrarProviderLoadResult {
  authority: WorkItemRegistrarActivationAuthority;
  diagnostic: WorkItemRegistrarActivationReadiness;
  preparation: HostedRegistrarProviderPreparation;
}

/**
 * Maps the canonical hosted candidate onto the existing activation loader.
 * It does not sign artifacts, grant a write authority, or load a Base capability.
 */
export function prepareHostedRegistrarProvider(input: {
  environment: HostedRegistrarEnvironment;
  ports?: RegistrarActivationPorts;
}): HostedRegistrarProviderPreparation {
  const blockerCodes: string[] = [];
  const configuredAppId = value(input.environment, ENV.miaodaAppId);
  const appId = configuredAppId ?? HOSTED_REGISTRAR_TARGET.miaodaAppId;
  if (
    configuredAppId &&
    configuredAppId !== HOSTED_REGISTRAR_TARGET.miaodaAppId
  ) {
    blockerCodes.push('HOSTED_REGISTRAR_APP_ID_MISMATCH');
  }

  const runtimeValues = {
    hostedDeploymentId: value(input.environment, ENV.hostedDeploymentId),
    tenantId: value(input.environment, ENV.tenantId),
    environmentId: value(input.environment, ENV.environmentId),
    servicePrincipalId: value(input.environment, ENV.servicePrincipalId),
    artifactStoreAdapterRevision: value(
      input.environment,
      ENV.artifactStoreAdapterRevision,
    ),
    artifactStoreId: value(input.environment, ENV.artifactStoreId),
    artifactStoreBucketId: value(input.environment, ENV.artifactStoreBucketId),
    unifiedPortRevision: value(input.environment, ENV.unifiedPortRevision),
    unifiedReaderRevision: value(input.environment, ENV.unifiedReaderRevision),
    noFallbackRegistryRevision: value(
      input.environment,
      ENV.noFallbackRegistryRevision,
    ),
  };
  const missingRuntimeFields = Object.entries(runtimeValues)
    .filter(([, fieldValue]) => !fieldValue)
    .map(([field]) => field);
  if (missingRuntimeFields.length > 0) {
    blockerCodes.push(
      `HOSTED_REGISTRAR_RUNTIME_BINDING_MISSING:${missingRuntimeFields.join(',')}`,
    );
  }

  const bootstrapValues = {
    manifestArtifactRef: value(input.environment, ENV.manifestArtifactRef),
    manifestArtifactSha256: value(
      input.environment,
      ENV.manifestArtifactSha256,
    ),
    signingReceiptArtifactRef: value(
      input.environment,
      ENV.signingReceiptArtifactRef,
    ),
    signingReceiptArtifactSha256: value(
      input.environment,
      ENV.signingReceiptArtifactSha256,
    ),
  };
  const missingBootstrapFields = Object.entries(bootstrapValues)
    .filter(([, fieldValue]) => !fieldValue)
    .map(([field]) => field);
  if (missingBootstrapFields.length > 0) {
    blockerCodes.push(
      `HOSTED_REGISTRAR_ACTIVATION_BOOTSTRAP_MISSING:${missingBootstrapFields.join(',')}`,
    );
  }
  if (!input.ports) blockerCodes.push('HOSTED_REGISTRAR_PORTS_NOT_BOUND');

  const runtime =
    missingRuntimeFields.length === 0
      ? ({
          miaodaAppId: appId,
          hostedDeploymentId: runtimeValues.hostedDeploymentId!,
          tenantId: runtimeValues.tenantId!,
          environmentId: runtimeValues.environmentId!,
          serviceIdentity: 'CanonicalHubRegistrar',
          servicePrincipalId: runtimeValues.servicePrincipalId!,
          baseToken: HOSTED_REGISTRAR_TARGET.baseToken,
          workItemsTableId: HOSTED_REGISTRAR_TARGET.tables.workItems.tableId,
          decisionsTableId: HOSTED_REGISTRAR_TARGET.tables.decisions.tableId,
          executionLogsTableId:
            HOSTED_REGISTRAR_TARGET.tables.executionLogs.tableId,
          artifactStoreAdapterRevision:
            runtimeValues.artifactStoreAdapterRevision!,
          artifactStoreId: runtimeValues.artifactStoreId!,
          artifactStoreBucketId: runtimeValues.artifactStoreBucketId!,
          unifiedPortRevision: runtimeValues.unifiedPortRevision!,
          unifiedReaderRevision: runtimeValues.unifiedReaderRevision!,
          noFallbackRegistryRevision: runtimeValues.noFallbackRegistryRevision!,
        } satisfies WorkItemRegistrarRuntimeBinding)
      : null;
  const bootstrap =
    missingBootstrapFields.length === 0
      ? ({
          manifestArtifactRef: bootstrapValues.manifestArtifactRef!,
          manifestArtifactSha256: bootstrapValues.manifestArtifactSha256!,
          signingReceiptArtifactRef: bootstrapValues.signingReceiptArtifactRef!,
          signingReceiptArtifactSha256:
            bootstrapValues.signingReceiptArtifactSha256!,
        } satisfies WorkItemRegistrarActivationBootstrap)
      : null;

  return {
    status: blockerCodes.length === 0 ? 'CAN_BIND' : 'BLOCKED',
    blockerCodes,
    target: HOSTED_REGISTRAR_TARGET,
    bootstrap,
    runtime,
  };
}

export async function loadHostedRegistrarProvider(
  options: HostedRegistrarProviderOptions = {},
): Promise<HostedRegistrarProviderLoadResult> {
  const preparation = prepareHostedRegistrarProvider({
    environment: options.environment ?? process.env,
    ports: options.ports,
  });
  if (
    preparation.status !== 'CAN_BIND' ||
    !preparation.bootstrap ||
    !preparation.runtime ||
    !options.ports
  ) {
    const authority = new UnconfiguredWorkItemRegistrarActivationAuthority(
      preparation.blockerCodes,
    );
    return {
      authority,
      diagnostic: authority.readiness(),
      preparation,
    };
  }

  const loaded = await loadMasterSignedWorkItemRegistrarActivation({
    bootstrap: preparation.bootstrap,
    runtime: preparation.runtime,
    ports: options.ports,
    now: options.now,
  });
  return { ...loaded, preparation };
}

export function hostedRegistrarActivationProvider(
  options: HostedRegistrarProviderOptions = {},
): Provider {
  return {
    provide: WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY,
    useFactory: async () =>
      (await loadHostedRegistrarProvider(options)).authority,
  };
}

function value(
  environment: HostedRegistrarEnvironment,
  field: string,
): string | null {
  const raw = environment[field]?.trim();
  return raw ? raw : null;
}

