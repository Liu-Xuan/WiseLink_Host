import type { CanonicalObjectAccessPort } from '../../server/modules/work-item/canonical-object-access.port';
import type { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import type { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { EngineeringMatterWorkingService } from '../../server/modules/canonical-host/engineering-matter-working.service';
import type {
  EngineeringMatterRepository,
  EngineeringMatterSnapshot,
} from '../../server/modules/canonical-host/engineering-matter.repository';

const snapshot: EngineeringMatterSnapshot = {
  matterId: 'MAT-1',
  tenantId: 'tenant-A',
  title: 'Matter',
  status: 'ACTIVE',
  currentRevisionNo: 2,
  currentMatterRevisionId: 'MREV-2',
  changeKind: 'WORK_ITEM_LINKED',
  changeSummary: 'Linked.',
  revisionCreatedAt: new Date('2026-09-08T00:00:00.000Z'),
  links: [
    {
      workItemId: 'WI-A',
      ordinal: 1,
      relationRole: 'PRIMARY',
      linkedAtWorkItemRevision: 4,
    },
    {
      workItemId: 'WI-B',
      ordinal: 2,
      relationRole: 'RELATED',
      linkedAtWorkItemRevision: 7,
    },
  ],
};

describe('EngineeringMatterWorkingService', () => {
  it('keeps an ordinary explanation read-only and reports every uncovered member', async () => {
    const matters = { loadCurrent: jest.fn().mockResolvedValue(snapshot) };
    const working = {
      loadCurrent: jest.fn().mockResolvedValue(null),
      commit: jest.fn(),
    };
    const service = serviceWith({ matters, working });

    const result = await service.applyWorkingUpdate('MAT-1', null, actor());

    expect(result).toMatchObject({
      mutated: false,
      working: {
        matterId: 'MAT-1',
        currentMatterRevisionId: 'MREV-2',
        currentWorkingRevision: 0,
        current: null,
        pendingInputs: [
          { inputId: 'WI-A', reasons: ['NOT_COVERED'] },
          { inputId: 'WI-B', reasons: ['NOT_COVERED'] },
        ],
      },
    });
    expect(working.commit).not.toHaveBeenCalled();
  });

  it('prefers a saved readingResult identity and falls back to legacy Overall identity', async () => {
    const service = serviceWith();

    const basis = await service.resolveWorkingBasis('MAT-1', actor());

    expect(basis.currentInputs).toEqual([
      expect.objectContaining({
        inputId: 'WI-A',
        resultRef: 'READING-A',
        resultRevision: 5,
      }),
      expect.objectContaining({
        inputId: 'WI-B',
        resultRef: 'OVERALL-B',
        resultRevision: 3,
      }),
    ]);
  });

  it('fails closed when any current Matter member loses fresh access', async () => {
    const objectAccess = {
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve(
          accessRoot.id === 'WI-B'
            ? {
                allowed: false,
                code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
                statusCode: 404,
              }
            : {
                allowed: true,
                workItemId: 'WI-A',
                documentVersionId: 'DV-A',
              },
        ),
      ),
    };
    const service = serviceWith({ objectAccess });

    await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });
});

function serviceWith(
  overrides: {
    matters?: Record<string, jest.Mock>;
    working?: Record<string, jest.Mock>;
    workItems?: Record<string, jest.Mock>;
    documentVersions?: Record<string, jest.Mock>;
    objectAccess?: Record<string, jest.Mock>;
  } = {},
): EngineeringMatterWorkingService {
  const matters =
    overrides.matters ??
    ({ loadCurrent: jest.fn().mockResolvedValue(snapshot) } as const);
  const working =
    overrides.working ??
    ({ loadCurrent: jest.fn().mockResolvedValue(null) } as const);
  Object.assign(working, { bindOriginalInputs: jest.fn(async (_tenant, inputs) => inputs) });
  const workItems =
    overrides.workItems ??
    ({
      loadTenantScopedProjection: jest
        .fn()
        .mockImplementation((workItemId: string) =>
          Promise.resolve(workItem(workItemId)),
        ),
    } as const);
  const documentVersions =
    overrides.documentVersions ??
    ({
      resolve: jest
        .fn()
        .mockImplementation((documentVersionId: string) =>
          Promise.resolve(documentVersion(documentVersionId)),
        ),
    } as const);
  const objectAccess =
    overrides.objectAccess ??
    ({
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve({
          allowed: true,
          workItemId: accessRoot.id,
          documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B',
        }),
      ),
    } as const);
  return new EngineeringMatterWorkingService(
    matters as unknown as EngineeringMatterRepository,
    working as unknown as EngineeringMatterWorkingRepository,
    workItems as unknown as MiaodaWorkItemRepository,
    documentVersions as unknown as MiaodaDocumentVersionSourceResolver,
    objectAccess as unknown as CanonicalObjectAccessPort,
  );
}

function workItem(workItemId: string) {
  const first = workItemId === 'WI-A';
  const documentVersionId = first ? 'DV-A' : 'DV-B';
  const overall = first
    ? {
        sourceResultId: 'LEGACY-A',
        revision: 4,
        readingResult: { resultRef: 'READING-A', resultRevision: 5 },
      }
    : { sourceResultId: 'OVERALL-B', revision: 3 };
  return {
    row: {
      workItemId,
      tenantId: 'tenant-A',
      documentId: first ? 'DOC-A' : 'DOC-B',
      documentVersionId,
      revision: first ? 4 : 7,
    },
    projection: {
      source: { documentVersionId },
      integratedAssessment: { overallSynthesis: overall },
    },
  };
}

function documentVersion(documentVersionId: string) {
  const first = documentVersionId === 'DV-A';
  return {
    version: {
      documentId: first ? 'DOC-A' : 'DOC-B',
      documentVersionId,
    },
  };
}

function actor(): CanonicalHostActor {
  return {
    userId: 'actor-A',
    tenantId: 'tenant-A',
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor: {} as NonNullable<
      CanonicalHostActor['objectAccessActor']
    >,
  };
}
