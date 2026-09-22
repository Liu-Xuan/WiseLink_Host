import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { CanonicalMiaodaFinalUserActorContext } from '../../server/modules/work-item/canonical-object-access.port';
import {
  engineeringMatter,
  engineeringMatterMaterialLink,
  engineeringMatterRevisionWorkItem,
  engineeringMatterWorkRevision,
} from '../../server/database/schema';
import { EngineeringMatterDirectoryService } from '../../server/modules/canonical-host/engineering-matter-directory.service';

interface MatterRow {
  matterId: string;
  title: string;
  currentMatterRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LinkRow {
  matterRevisionId: string;
  workItemId: string;
  relationRole: 'PRIMARY' | 'RELATED';
  ordinal: number;
}

interface MaterialRow {
  matterRevisionId: string;
}

interface WorkingRow {
  matterId: string;
  workingRevision: number;
  basedOnMatterRevisionId: string;
  createdAt: Date;
  hasSubstantiveResult: boolean;
  resultRef: string | null;
  resultRevision: number | null;
  resultHeadline: string | null;
  resultListBrief: string | null;
  resultScopeKind: string | null;
  resultScopeMatterId: string | null;
  decisiveClaims: unknown;
  overallStatus: string | null;
}

interface DirectoryFixture {
  matters: MatterRow[];
  links: LinkRow[];
  materials: MaterialRow[];
  working: WorkingRow[];
}

class FakeDirectoryQuery<T> implements PromiseLike<T[]> {
  private table: unknown = null;
  private limitValue: number | null = null;

  constructor(private readonly database: FakeDirectoryDb) {}

  select(): this {
    return this;
  }

  selectDistinctOn(): this {
    return this;
  }

  from(table: unknown): this {
    this.table = table;
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.database.executionCount += 1;
    const rows = this.database.rowsFor(this.table) as T[];
    const limited =
      this.limitValue === null ? rows : rows.slice(0, this.limitValue);
    return Promise.resolve(limited).then(onfulfilled, onrejected);
  }
}

class FakeDirectoryDb {
  executionCount = 0;

  constructor(private readonly fixture: DirectoryFixture) {}

  select(): FakeDirectoryQuery<unknown> {
    return new FakeDirectoryQuery(this);
  }

  selectDistinctOn(): FakeDirectoryQuery<unknown> {
    return new FakeDirectoryQuery(this);
  }

  rowsFor(table: unknown): unknown[] {
    if (table === engineeringMatter) return this.fixture.matters;
    if (table === engineeringMatterRevisionWorkItem) {
      return this.fixture.links;
    }
    if (table === engineeringMatterMaterialLink) {
      return this.fixture.materials;
    }
    if (table === engineeringMatterWorkRevision) {
      return this.fixture.working;
    }
    return [];
  }
}

const actorFields: CanonicalMiaodaFinalUserActorContext = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-1' },
  subjectDecision: {
    source: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeId: 'app_17bzc551rsg',
    tenantId: 'tenant-1',
    version: 'miaoda-hosted-native-sso.v1',
    decidedAt: '2026-09-22T00:00:00.000Z',
  },
  tenantId: 'tenant-1',
  applicationScopeId: 'app_17bzc551rsg',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  env: 'preview',
  platformRoles: [],
  identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
  feishuUserId: null,
  feishuOpenId: null,
  feishuIdentityProvenance: 'UNAVAILABLE',
  sessionId: null,
  sessionRevision: null,
  sessionProvenance: 'UNAVAILABLE',
};

const actor: CanonicalHostActor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'preview',
  objectAccessActor: actorFields,
};

function fixture(count = 1): DirectoryFixture {
  const matters: MatterRow[] = [];
  const links: LinkRow[] = [];
  const working: WorkingRow[] = [];
  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index);
    const matterId = `MAT-${suffix}`;
    const revisionId = `MREV-${suffix}`;
    matters.push({
      matterId,
      title: `Matter ${suffix}`,
      currentMatterRevisionId: revisionId,
      createdAt: new Date(`2026-09-2${index}T00:00:00.000Z`),
      updatedAt: new Date(`2026-09-2${index}T01:00:00.000Z`),
    });
    links.push({
      matterRevisionId: revisionId,
      workItemId: `WI-${suffix}`,
      relationRole: 'PRIMARY',
      ordinal: 1,
    });
    working.push({
      matterId,
      workingRevision: index,
      basedOnMatterRevisionId: revisionId,
      createdAt: new Date(`2026-09-2${index}T02:00:00.000Z`),
      hasSubstantiveResult: true,
      resultRef: `RESULT-${suffix}`,
      resultRevision: index,
      resultHeadline: `Headline ${suffix}`,
      resultListBrief: `Brief ${suffix}`,
      resultScopeKind: 'ENGINEERING_MATTER',
      resultScopeMatterId: matterId,
      decisiveClaims: [
        { claimId: `CLAIM-${suffix}`, text: `Decisive ${suffix}` },
      ],
      overallStatus: 'CURRENT',
    });
  }
  return { matters, links, materials: [], working };
}

function serviceFor(directoryFixture: DirectoryFixture) {
  const database = new FakeDirectoryDb(directoryFixture);
  const matters = { read: jest.fn() };
  const working = { readWorking: jest.fn() };
  const service = new EngineeringMatterDirectoryService(
    database as never,
    matters as never,
    working as never,
  );
  return { service, database, matters, working };
}

describe('engineering matter directory narrow reading', () => {
  it('returns the same directory fields, result brief and exact working revision', async () => {
    const f = serviceFor(fixture());
    const response = await f.service.list({}, actor);
    expect(response).toEqual({
      items: [
        {
          matterId: 'MAT-1',
          title: 'Matter 1',
          primaryWorkItemId: 'WI-1',
          createdAt: '2026-09-21T00:00:00.000Z',
          updatedAt: '2026-09-21T02:00:00.000Z',
          currentMatterRevisionId: 'MREV-1',
          workingRevision: 1,
          result: {
            resultRef: 'RESULT-1',
            resultRevision: 1,
            headline: 'Headline 1',
            listBrief: 'Brief 1',
            decisiveClaims: [{ claimId: 'CLAIM-1', text: 'Decisive 1' }],
          },
          overallStatus: 'CURRENT',
        },
      ],
      nextCursor: null,
      fileReadPerformed: false,
    });
    expect(f.matters.read).not.toHaveBeenCalled();
    expect(f.working.readWorking).not.toHaveBeenCalled();
  });

  it.each([1, 3])(
    'uses four batch reads for limit %i and never falls back to per-row readers',
    async (limit) => {
      const f = serviceFor(fixture(3));
      const response = await f.service.list({ limit }, actor);
      expect(f.database.executionCount).toBe(4);
      expect(response.items).toHaveLength(limit);
      expect(f.matters.read).not.toHaveBeenCalled();
      expect(f.working.readWorking).not.toHaveBeenCalled();
    },
  );

  it('preserves cursor pagination across a large batch', async () => {
    const f = serviceFor(fixture(3));
    const first = await f.service.list({ limit: 1 }, actor);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const cursor = JSON.parse(
      Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(cursor).toMatchObject({
      matterId: first.items[0]?.matterId,
      search: '',
      workItemId: '',
    });
    await expect(
      f.service.list({ limit: 1, cursor: first.nextCursor! }, actor),
    ).resolves.toMatchObject({ fileReadPerformed: false });
  });

  it('keeps a material-only matter valid with no primary work item', async () => {
    const f = serviceFor({
      matters: [
        {
          matterId: 'MAT-M',
          title: 'Material matter',
          currentMatterRevisionId: 'MREV-M',
          createdAt: new Date('2026-09-21T00:00:00.000Z'),
          updatedAt: new Date('2026-09-21T00:00:00.000Z'),
        },
      ],
      links: [],
      materials: [{ matterRevisionId: 'MREV-M' }],
      working: [],
    });
    const response = await f.service.list({}, actor);
    expect(response.items[0]).toMatchObject({
      matterId: 'MAT-M',
      primaryWorkItemId: null,
      workingRevision: 0,
      result: null,
      overallStatus: null,
    });
  });

  it('keeps a working revision without a substantive result as an explicit null', async () => {
    const f = serviceFor({
      matters: fixture().matters,
      links: fixture().links,
      materials: [],
      working: [
        {
          ...fixture().working[0]!,
          hasSubstantiveResult: false,
          resultRef: null,
          resultRevision: null,
          resultHeadline: null,
          resultListBrief: null,
          resultScopeKind: null,
          resultScopeMatterId: null,
          decisiveClaims: null,
          overallStatus: 'NOT_AVAILABLE',
        },
      ],
    });
    const response = await f.service.list({}, actor);
    expect(response.items[0]).toMatchObject({
      workingRevision: 1,
      result: null,
      overallStatus: 'NOT_AVAILABLE',
    });
  });

  it('rejects an ambiguous primary composition without material scope', async () => {
    const f = serviceFor(fixture());
    f.database.rowsFor = (table: unknown) =>
      table === engineeringMatterRevisionWorkItem
        ? [
            {
              matterRevisionId: 'MREV-1',
              workItemId: 'WI-1',
              relationRole: 'PRIMARY',
              ordinal: 1,
            },
            {
              matterRevisionId: 'MREV-1',
              workItemId: 'WI-2',
              relationRole: 'PRIMARY',
              ordinal: 2,
            },
          ]
        : new FakeDirectoryDb(fixture()).rowsFor(table);
    await expect(f.service.list({}, actor)).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_DIRECTORY_CHANGED',
      statusCode: 409,
    });
  });

  it('rejects a saved result whose scope is bound to another matter', async () => {
    const f = serviceFor(fixture());
    f.database.rowsFor = (table: unknown) =>
      table === engineeringMatterWorkRevision
        ? [{ ...fixture().working[0], resultScopeMatterId: 'OTHER' }]
        : new FakeDirectoryDb(fixture()).rowsFor(table);
    await expect(f.service.list({}, actor)).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_RESULT_BINDING_INVALID',
      statusCode: 409,
    });
  });

  it('rejects a working revision based on an older matter composition', async () => {
    const f = serviceFor(fixture());
    f.database.rowsFor = (table: unknown) =>
      table === engineeringMatterWorkRevision
        ? [{ ...fixture().working[0], basedOnMatterRevisionId: 'MREV-OLD' }]
        : new FakeDirectoryDb(fixture()).rowsFor(table);
    await expect(f.service.list({}, actor)).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_DIRECTORY_CHANGED',
      statusCode: 409,
    });
  });

  it('returns an empty page without entering row readers', async () => {
    const f = serviceFor({
      matters: [],
      links: [],
      materials: [],
      working: [],
    });
    await expect(f.service.list({}, actor)).resolves.toEqual({
      items: [],
      nextCursor: null,
      fileReadPerformed: false,
    });
    expect(f.database.executionCount).toBe(1);
    expect(f.matters.read).not.toHaveBeenCalled();
    expect(f.working.readWorking).not.toHaveBeenCalled();
  });

  it('rejects a cursor bound to another search', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-09-21T00:00:00.000Z',
        matterId: 'MAT-1',
        search: 'other',
        workItemId: '',
      }),
    ).toString('base64url');
    const f = serviceFor(fixture());
    await expect(f.service.list({ cursor }, actor)).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_DIRECTORY_CURSOR_INVALID',
      statusCode: 400,
    });
  });

  it('rejects an actor whose identity does not match the canonical scope', async () => {
    const f = serviceFor(fixture());
    await expect(
      f.service.list(
        {},
        {
          ...actor,
          objectAccessActor: {
            ...actorFields,
            tenantId: 'tenant-other',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
  });
});
