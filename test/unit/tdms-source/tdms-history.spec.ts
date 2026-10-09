import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { tdmsError } from '../../../server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor, fixture } from './tdms-fixtures';

const target = {
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'narrow',
};
function setup() {
  const db = new MemoryTdmsRepository();
  let allowed = true;
  let revision = 'member-1';
  const seen: string[] = [];
  const auth = new HostDecisionTdmsSourceAuthorization(
    async ({ actor: subject, scope, action }) => {
      seen.push(action);
      if (
        !allowed ||
        subject.tenantId !== nativeScope.tenantId ||
        (scope && JSON.stringify(scope) !== JSON.stringify(nativeScope))
      )
        return [];
      return [{ scope: nativeScope, permissionRevision: revision }];
    },
    async ({ scope, claims, grant }) => ({
      ...grant,
      scope,
      authorityRef: 'source-1',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: claims,
    }),
  );
  const documents = {
    assertRead: jest.fn(async (_actor, id: string) => {
      if (id === 'DV-hidden') throw tdmsError('DOCUMENT_NOT_FOUND', 404);
    }),
  };
  const service = new TdmsSourceService(
    db,
    auth,
    { acquire: jest.fn() },
    documents,
  );
  return {
    db,
    service,
    documents,
    seen,
    revoke: () => {
      allowed = false;
    },
    changeRevision: () => {
      revision = 'member-2';
    },
  };
}
async function save(
  s: ReturnType<typeof setup>,
  packageId: string,
  expectedHeadRevisionRef: string | null,
  time: string,
  version: string,
) {
  const p = fixture();
  p.packageId = packageId;
  p.observedAt = time;
  p.records[0]!.expectedHeadRevisionRef = expectedHeadRevisionRef;
  p.records[0]!.observedAt = time;
  p.records[0]!.sourceVersion.rawRevision = version;
  p.records[0]!.title = `version ${version}`;
  return (await s.service.importPackage(actor(), target, p))
    .recordRevisionRefs[0]!;
}

describe('exact native observation history', () => {
  it('enumerates every saved observation, including old and same-business-version observations, with current selected head separate', async () => {
    const s = setup();
    const first = await save(s, 'P-1', null, '2026-10-05T10:00:00Z', '1');
    const second = await save(s, 'P-2', first, '2026-10-05T12:00:00Z', '2');
    const late = await save(s, 'P-3', second, '2026-10-05T11:00:00Z', '2');
    const result = await s.service.history(actor(), first);
    expect(result.versions.map((v) => v.sourceRevisionRef).sort()).toEqual(
      [first, second, late].sort(),
    );
    expect(
      result.versions
        .filter((v) => v.selectedHead)
        .map((v) => v.sourceRevisionRef),
    ).toEqual([second]);
    expect(
      result.versions.filter((v) => v.sourceVersion.rawRevision === '2'),
    ).toHaveLength(2);
    expect(
      result.versions.every(
        (v) => !!v.captureRef && !('content' in v) && !('rawFields' in v),
      ),
    ).toBe(true);
    expect(result.readPerformed).toBe(false);
    expect(s.db.state.receipts).toHaveLength(0);
    expect(s.seen).toContain('READ_HISTORY');
  });
  it('checks each linked document independently, hides inaccessible versions, and rejects an inaccessible root without counts or titles', async () => {
    const s = setup();
    const first = await save(s, 'P-1', null, '2026-10-05T10:00:00Z', '1');
    const second = await save(s, 'P-2', first, '2026-10-05T12:00:00Z', '2');
    s.db.state.revisions.find(
      (r) => r.record.sourceRevisionRef === first,
    )!.record.relatedDocumentVersionIds = ['DV-hidden'];
    const result = await s.service.history(actor(), second);
    expect(result.versions.map((v) => v.sourceRevisionRef)).toEqual([second]);
    await expect(s.service.history(actor(), first)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
    });
    expect(s.documents.assertRead).toHaveBeenCalled();
  });
  it('paginates visible exact refs and fails closed on permission change or revocation after transaction', async () => {
    const s = setup();
    const first = await save(s, 'P-1', null, '2026-10-05T10:00:00Z', '1');
    const original = s.db.state.revisions[0]!;
    for (let i = 1; i <= 51; i++) {
      const clone = structuredClone(original);
      clone.record.sourceRevisionRef = `TDMS-REV-extra-${String(i).padStart(3, '0')}`;
      clone.record.captureRef = `TDMS-CAP-extra-${i}`;
      clone.record.selectedHead = false;
      s.db.state.revisions.push(clone);
    }
    const page1 = await s.service.history(actor(), first);
    expect(page1.versions).toHaveLength(50);
    expect(page1.hasMore).toBe(true);
    const page2 = await s.service.history(actor(), first, {}, page1.nextAfter!);
    expect(page2.versions).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(
      new Set(
        [...page1.versions, ...page2.versions].map((v) => v.sourceRevisionRef),
      ).size,
    ).toBe(52);
    s.db.beforeCommit = () => s.changeRevision();
    await expect(s.service.history(actor(), first)).rejects.toMatchObject({
      code: 'TDMS_SOURCE_PERMISSION_CHANGED',
    });
    s.db.beforeCommit = () => s.revoke();
    await expect(s.service.history(actor(), first)).rejects.toMatchObject({
      code: 'TDMS_SOURCE_NOT_FOUND',
    });
  });
  it('does not leak a same-recordRef observation from another scope', async () => {
    const s = setup();
    const first = await save(s, 'P-1', null, '2026-10-05T10:00:00Z', '1');
    const foreign = structuredClone(s.db.state.revisions[0]!);
    foreign.scope.scopeId = 'elsewhere';
    foreign.record.sourceRevisionRef = 'TDMS-REV-foreign';
    s.db.state.revisions.push(foreign);
    expect((await s.service.history(actor(), first)).versions).toHaveLength(1);
  });
});
