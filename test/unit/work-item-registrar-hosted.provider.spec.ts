import type { RegistrarActivationPorts } from '../../server/modules/assessment-registrar/work-item-registrar-activation';
import {
  HOSTED_REGISTRAR_TARGET,
  loadHostedRegistrarProvider,
  prepareHostedRegistrarProvider,
} from '../../server/modules/assessment-registrar/work-item-registrar-hosted.provider';

describe('hosted WorkItem Registrar provider', () => {
  it('maps the frozen host candidate and the live 65/28/17 store exactly', () => {
    expect(HOSTED_REGISTRAR_TARGET).toEqual({
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
    });
  });

  it('reports exact missing hosted inputs without calling any runtime port', async () => {
    const ports = fakePorts();
    const result = await loadHostedRegistrarProvider({
      environment: {},
      ports,
    });

    expect(result.preparation.status).toBe('BLOCKED');
    expect(result.preparation.blockerCodes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^HOSTED_REGISTRAR_RUNTIME_BINDING_MISSING:/u),
        expect.stringMatching(
          /^HOSTED_REGISTRAR_ACTIVATION_BOOTSTRAP_MISSING:/u,
        ),
      ]),
    );
    expect(result.diagnostic).toMatchObject({
      status: 'BLOCKED',
      writeAuthorized: false,
      bindings: {
        baseToken: 'VorbbDXAkaHbLMsUTV2cBCW5nRd',
        workItemsTableId: 'tblre53IWbymz982',
        decisionsTableId: 'tbln5DlxOHYSJJ3p',
        executionLogsTableId: 'tbl8v4CB4VZUcb5e',
      },
    });
    expect(ports.artifactStore.readActualBytes).not.toHaveBeenCalled();
    expect(
      ports.soleWriterPermission.readSoleWriterPermission,
    ).not.toHaveBeenCalled();
    expect(
      ports.validationWriteAuthorization.resolveCurrentAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('keeps the exact host mapping blocked when no trusted ports are bound', async () => {
    const result = await loadHostedRegistrarProvider({
      environment: completeEnvironment(),
    });

    expect(result.preparation).toMatchObject({
      status: 'BLOCKED',
      blockerCodes: ['HOSTED_REGISTRAR_PORTS_NOT_BOUND'],
    });
    await expect(
      result.authority.assertAuthorized({} as never),
    ).rejects.toThrow('HOSTED_REGISTRAR_PORTS_NOT_BOUND');
  });

  it('constructs the exact runtime binding only when all ordinary config is present', () => {
    const ports = fakePorts();
    const result = prepareHostedRegistrarProvider({
      environment: completeEnvironment(),
      ports,
    });

    expect(result.status).toBe('CAN_BIND');
    expect(result.blockerCodes).toEqual([]);
    expect(result.runtime).toEqual({
      miaodaAppId: 'app_17bzc551rsg',
      hostedDeploymentId: 'deployment-validation-1',
      tenantId: 'tenant-1',
      environmentId: 'validation-1',
      serviceIdentity: 'CanonicalHubRegistrar',
      servicePrincipalId: 'service-principal-1',
      baseToken: 'VorbbDXAkaHbLMsUTV2cBCW5nRd',
      workItemsTableId: 'tblre53IWbymz982',
      decisionsTableId: 'tbln5DlxOHYSJJ3p',
      executionLogsTableId: 'tbl8v4CB4VZUcb5e',
      artifactStoreAdapterRevision: 'artifact-adapter-1',
      artifactStoreId: 'artifact-store-1',
      artifactStoreBucketId: 'artifact-bucket-1',
      unifiedPortRevision: 'unified-port-1',
      unifiedReaderRevision: 'unified-reader-1',
      noFallbackRegistryRevision: 'no-fallback-1',
    });
    expect(result.bootstrap).toEqual({
      manifestArtifactRef: 'artifact://master/activation.json',
      manifestArtifactSha256: 'a'.repeat(64),
      signingReceiptArtifactRef: 'artifact://master/activation-receipt.json',
      signingReceiptArtifactSha256: 'b'.repeat(64),
    });
  });

  it('rejects a different app identity before reading activation artifacts', async () => {
    const ports = fakePorts();
    const result = await loadHostedRegistrarProvider({
      environment: {
        ...completeEnvironment(),
        MIAODA_APP_ID: 'app_not_the_canonical_candidate',
      },
      ports,
    });

    expect(result.preparation).toMatchObject({
      status: 'BLOCKED',
      blockerCodes: ['HOSTED_REGISTRAR_APP_ID_MISMATCH'],
    });
    expect(ports.artifactStore.readActualBytes).not.toHaveBeenCalled();
  });
});

function completeEnvironment(): Record<string, string> {
  return {
    MIAODA_APP_ID: 'app_17bzc551rsg',
    WL_REGISTRAR_HOSTED_DEPLOYMENT_ID: 'deployment-validation-1',
    WL_REGISTRAR_TENANT_ID: 'tenant-1',
    WL_REGISTRAR_ENVIRONMENT_ID: 'validation-1',
    WL_REGISTRAR_SERVICE_PRINCIPAL_ID: 'service-principal-1',
    WL_REGISTRAR_ARTIFACT_STORE_ADAPTER_REVISION: 'artifact-adapter-1',
    WL_REGISTRAR_ARTIFACT_STORE_ID: 'artifact-store-1',
    WL_REGISTRAR_ARTIFACT_STORE_BUCKET_ID: 'artifact-bucket-1',
    WL_REGISTRAR_UNIFIED_PORT_REVISION: 'unified-port-1',
    WL_REGISTRAR_UNIFIED_READER_REVISION: 'unified-reader-1',
    WL_REGISTRAR_NO_FALLBACK_REGISTRY_REVISION: 'no-fallback-1',
    WL_REGISTRAR_ACTIVATION_MANIFEST_REF: 'artifact://master/activation.json',
    WL_REGISTRAR_ACTIVATION_MANIFEST_SHA256: 'a'.repeat(64),
    WL_REGISTRAR_ACTIVATION_SIGNING_RECEIPT_REF:
      'artifact://master/activation-receipt.json',
    WL_REGISTRAR_ACTIVATION_SIGNING_RECEIPT_SHA256: 'b'.repeat(64),
  };
}

function fakePorts(): RegistrarActivationPorts & {
  artifactStore: { readActualBytes: jest.Mock };
  soleWriterPermission: { readSoleWriterPermission: jest.Mock };
  validationWriteAuthorization: { resolveCurrentAuthorization: jest.Mock };
} {
  return {
    artifactStore: {
      readActualBytes: jest.fn(async () => {
        throw new Error('SHOULD_NOT_READ');
      }),
    },
    masterSignature: {
      verifyMasterSignature: jest.fn(async () => {
        throw new Error('SHOULD_NOT_VERIFY');
      }),
      verifyValidationWriteSignature: jest.fn(async () => {
        throw new Error('SHOULD_NOT_VERIFY');
      }),
    },
    soleWriterPermission: {
      readSoleWriterPermission: jest.fn(async () => {
        throw new Error('SHOULD_NOT_READ');
      }),
    },
    validationWriteAuthorization: {
      resolveCurrentAuthorization: jest.fn(async () => {
        throw new Error('SHOULD_NOT_READ');
      }),
    },
  };
}

