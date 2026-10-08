import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { CanonicalHostCommonContextService } from '../../server/modules/canonical-host/canonical-host-common-context.service';

/** Real CommonContextService -> snapshot builder -> assessment projection, with
 * deterministic authorized catalog/file dependencies. No publisher-state reader
 * exists on this path, so neither exact identity nor a catalog head proves it. */
function contextFixture() {
  const target = '777-FTD-31-21002';
  const state = { selectedVersion: 'DV-A', readable: true, advanceDuringRead: false };
  const snapshots: string[] = [];
  const primary = {
    workItemId: 'WI-PRIMARY', revision: 2,
    source: { documentVersionId: 'DV-PRIMARY' },
    package: { packageId: 'PKG-PRIMARY', title: 'Primary issue',
      documentIdentity: { documentCode: '777-SL-31-064', businessRevision: '1' },
      artifact: { ref: 'artifact://primary' } },
  } as CanonicalWorkItemProjection;
  const binding = (version: string) => ({ workItemId: `WI-${version}`,
    documentVersionId: version, requestId: `request-${version}`, tenantId: 'tenant-one',
    requestedByUserId: 'engineer-owner', revision: 1 });
  const workItems = {
    listTenantDocumentAuthorizationBindings: jest.fn(async ({ documentVersionId }: { documentVersionId: string }) =>
      [binding(documentVersionId)]),
    loadAuthorizationBinding: jest.fn(async ({ workItemId }: { workItemId: string }) =>
      state.readable ? binding(workItemId.slice(3)) : null),
    loadTenantScopedProjection: jest.fn(async (workItemId: string) => {
      const version = workItemId.slice(3);
      return { row: binding(version), projection: { ...primary, ...binding(version),
        source: { documentVersionId: version }, package: { ...primary.package,
          documentIdentity: { documentCode: target, businessRevision: version === 'DV-A' ? 'R1' : 'R2' },
          artifact: { ref: `artifact://${version}`, sha256: 'a'.repeat(64) } } } };
    }),
  };
  const artifacts = {
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => {
      snapshots.push(new TextDecoder().decode(bytes));
      return { artifact: { ref: `private://snapshot/${snapshots.length}` } };
    }),
    readActualBytes: jest.fn(async ({ ref }: { ref: string }) => {
      const version = ref.split('://')[1]!;
      if (state.advanceDuringRead) state.selectedVersion = 'DV-B';
      return new TextEncoder().encode(JSON.stringify({ sourceRefs: [{
        sourceRefId: `SRC-${version}`, quote: `Exact immutable text of ${version}`,
        pageStart: 2, pageEnd: 2,
      }] }));
    }),
  };
  const documentManagement = {
    listCurrentReferenceTargets: jest.fn(async () => [{ canonicalDocumentNumber: target,
      documentVersionId: state.selectedVersion, issuerAuthority: 'BOEING' }]),
  };
  const service = new CanonicalHostCommonContextService({
    hasActiveOfficialActorMapping: jest.fn(async () => true),
    loadCurrent: jest.fn(async () => null),
  } as never, workItems as never, artifacts as never, {
    readAllSourceUnits: jest.fn(async () => [{ unitId: 'U1', kind: 'paragraph',
      text: `For more information, refer to ${target}.`, sourceRefIds: ['SRC-PRIMARY'] }]),
  } as never, documentManagement as never);
  const build = () => service.build(primary, { tenantId: 'tenant-one', actorId: 'engineer-owner' },
    { asOf: '2026-10-07T07:00:00Z' });
  return { state, snapshots, artifacts, workItems, documentManagement, build };
}

describe('related source identity versus publisher currentness', () => {
  it('preserves authorized exact evidence without presenting catalog selection as publisher-current', async () => {
    const h = contextFixture();
    const result = await h.build();
    const persisted = JSON.parse(h.snapshots[0]!);
    for (const item of [persisted.items[0], result.related.items[0], result.common.relatedMaterials.items[0]]) {
      expect(item).toMatchObject({ currentness: 'UNKNOWN', availability: 'AVAILABLE',
        reasonCodes: expect.arrayContaining(['REFERENCE_RESOLVED_EXACT', 'PUBLISHER_CURRENTNESS_UNKNOWN']) });
    }
    expect(persisted.referenceMentions[0]).toMatchObject({ resolutionState: 'RESOLVED_EXACT',
      permissionState: 'AUTHORIZED', resolvedDocumentVersionRef: 'DV-A' });
    expect(result.readingEvidence).toEqual([expect.objectContaining({ kind: 'DOCUMENT_PASSAGE',
      workItemId: 'WI-DV-A', documentVersionId: 'DV-A', versionLabel: 'R1', sourceRefId: 'SRC-DV-A',
      excerpt: 'Exact immutable text of DV-A', locator: 'page 2-2' })]);
    expect(result.common.relatedMaterials.items[0]).toMatchObject({ documentVersionRef: 'DV-A',
      readFragments: [{ sourceRefId: 'SRC-DV-A', excerpt: 'Exact immutable text of DV-A' }] });
    expect(h.documentManagement.listCurrentReferenceTargets).toHaveBeenCalledWith(
      ['777-FTD-31-21002'], expect.objectContaining({ tenantId: 'tenant-one', actorUserId: 'engineer-owner', roles: [] }));
  });

  it('keeps the captured version exact when a new catalog head arrives during body reading', async () => {
    const h = contextFixture();
    h.state.advanceDuringRead = true;
    const first = await h.build();
    expect(h.state.selectedVersion).toBe('DV-B');
    const savedSnapshot = h.snapshots[0]!;
    expect(first.common.relatedMaterials.items[0]).toMatchObject({ documentVersionRef: 'DV-A',
      currentness: 'UNKNOWN', availableSourceRefIds: ['SRC-DV-A'] });
    expect(first.readingEvidence[0]).toMatchObject({ documentVersionId: 'DV-A', versionLabel: 'R1' });
    const next = await h.build();
    expect(next.common.relatedMaterials.items[0]).toMatchObject({ documentVersionRef: 'DV-B',
      currentness: 'UNKNOWN', availableSourceRefIds: ['SRC-DV-B'] });
    expect(next.readingEvidence[0]).toMatchObject({ documentVersionId: 'DV-B', versionLabel: 'R2' });
    expect(h.snapshots[0]).toBe(savedSnapshot);
    expect(first.readingEvidence[0]).toMatchObject({ documentVersionId: 'DV-A', versionLabel: 'R1' });
  });

  it('does not substitute an accessible old version when the selected new version is denied', async () => {
    const h = contextFixture();
    await h.build();
    const historicalSnapshot = h.snapshots[0]!;
    h.state.selectedVersion = 'DV-B';
    h.state.readable = false;
    h.artifacts.readActualBytes.mockClear();
    const denied = await h.build();
    expect(denied.common.relatedMaterials.items[0]).toMatchObject({ documentVersionRef: null,
      currentness: 'UNKNOWN', availability: 'ACCESS_DENIED', availableSourceRefIds: [], readFragments: [] });
    expect(denied.readingEvidence).toEqual([]);
    expect(denied.related.resourceRefs).toEqual([]);
    expect(h.artifacts.readActualBytes).not.toHaveBeenCalled();
    expect(h.snapshots[0]).toBe(historicalSnapshot);
    expect(JSON.stringify(denied.common)).not.toContain('DV-A');
  });
});
