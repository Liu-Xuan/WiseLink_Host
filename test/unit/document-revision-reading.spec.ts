import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { BOEING_FTD_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { buildDocumentRevisionReading } from '../../server/modules/canonical-host/document-revision-reading';
import { DocumentRevisionReadingService } from '../../server/modules/canonical-host/document-revision-reading.service';

function document(id: string, body: string) {
  const original = originalFixture();
  Object.assign(original.binding, { documentVersionId: id, parseRunId: `parse-${id}` });
  original.coverage = { knownPageCount: 2, readPageIndexes: [0, 1], unresolvedRanges: [] };
  original.source.units = [['Revision Description', 2], [`Publisher notice for ${id}`, 0], ['Status', 2], [body, 0],
    ['References', 2], ['Other reading', 0]].map(([text, level], order) => ({ ...original.source.units[0],
      unitId: `${id}-u${order}`, order, kind: level ? 'heading' as const : 'paragraph' as const,
      payload: level ? { text: String(text), level: Number(level) } : { text: String(text) } }));
  const map = () => buildDocumentSemanticMap({ original, semanticRevision: 1, profile: BOEING_FTD_SEMANTIC_PROFILE });
  return { original, map };
}
function compare(before: ReturnType<typeof document>, after: ReturnType<typeof document>) {
  return buildDocumentRevisionReading('family', before.original, before.map(), after.original, after.map(), 'ftd.status');
}

describe('exact revision pair reading (isolated fixtures)', () => {
  it('separates each publisher notice and normalizes whitespace without substituting new references', () => {
    const before = document('old', 'Pending review.');
    const after = document('new', 'Pending  review.');
    const result = compare(before, after);
    expect(result.systemComparison.status).toBe('TEXT_EQUAL');
    expect(result.before.publisherRevisionDescriptions[0].units[1].payload.text).toBe('Publisher notice for old');
    expect(result.after.publisherRevisionDescriptions[0].units[1].payload.text).toBe('Publisher notice for new');
    expect(result.before.selectedSections[0].selection.binding.documentVersionId).toBe('old');
    expect(result.before.unselectedUnitIds).toContain('old-u5');
    expect(result.assessmentCoverage).toBe('NOT_RECORDED_BY_THIS_READ');
    expect(result.publicationRelationship).toBe('NOT_VERIFIED');
  });
  it('detects actual changed text and refuses ambiguous repeated sections', () => {
    const before = document('old', 'Pending review.');
    const after = document('new', 'Approved.');
    expect(compare(before, after).systemComparison.status).toBe('TEXT_DIFFERENT');
    after.original.source.units[4].payload.text = 'Status';
    expect(compare(before, after).systemComparison).toMatchObject({ status: 'NOT_COMPARED', reasons: ['ROLE_MISSING_OR_REPEATED'] });
  });
  it('does not turn reading limitations or empty content into unchanged results', () => {
    const before = document('old', 'Pending review.');
    const after = document('new', 'Pending review.');
    after.original.coverage.unresolvedRanges = [{ reason: 'UNREAD', pageIndexes: [0], unitIds: [], message: 'Unread' }];
    expect(compare(before, after).systemComparison.status).toBe('NOT_COMPARED');
    after.original.coverage.unresolvedRanges = [];
    after.original.source.units.splice(3, 1);
    expect(compare(before, after).systemComparison.status).toBe('NOT_COMPARED');
  });
  it('keeps uninterpreted figures visible while comparing only the selected plain text', () => {
    const before = document('old', 'Same text');
    const after = document('new', 'Same text');
    after.original.coverage.unresolvedRanges = [{ reason: 'FIGURE_UNINTERPRETED', pageIndexes: [0], unitIds: [], message: 'Figure not interpreted' }];
    const result = compare(before, after);
    expect(result.systemComparison.status).toBe('TEXT_EQUAL');
    expect(result.after.coverage.unresolvedRanges[0].reason).toBe('FIGURE_UNINTERPRETED');
  });
  it('requires distinct document versions, not two parser runs of the same version', () => {
    const before = document('same', 'One');
    const after = document('same', 'Two');
    after.original.binding.parseRunId = 'another-parser';
    expect(() => compare(before, after)).toThrow('DISTINCT_VERSIONS_REQUIRED');
  });
  it.each(['read', 'readForBrowser'] as const)('%s authorizes both originals and rejects revoked access or different families', async (method) => {
    const before = document('old', 'One'), after = document('new', 'Two');
    const reader = { readDocumentOriginal: jest.fn(async (id: string) => ({
      original: id === 'old' ? before.original : after.original, run: { sourceBinding: { familyId: 'family' } } })) };
    const semantics = { read: jest.fn(async (scope: { documentVersionId: string }) => scope.documentVersionId === 'old' ? before.map() : after.map()) };
    const actors = { withActorScope: jest.fn(async (_actor, fn) => fn()) };
    if (method === 'readForBrowser') actors.withActorScope.mockRejectedValue(new Error('HOSTED_SCOPE_UNAVAILABLE'));
    const parsing = { status: jest.fn().mockResolvedValue({}) };
    const service = new DocumentRevisionReadingService(reader as never, semantics as never, actors as never, parsing as never);
    const input = { before: { documentVersionId: 'old', parseRunId: 'parse-old', semanticRevision: 1 },
      after: { documentVersionId: 'new', parseRunId: 'parse-new', semanticRevision: 1 }, roleKey: 'ftd.status' };
    const context = { tenantId: 'tenant', actorUserId: 'actor', roles: [], appId: 'app', env: 'development' };
    await expect(service[method](input, context)).resolves.toHaveProperty('familyId', 'family');
    expect(actors.withActorScope).toHaveBeenCalledTimes(method === 'read' ? 1 : 0);
    expect(reader.readDocumentOriginal.mock.calls.map(call => call[0])).toEqual(['old', 'new']);
    expect(semantics.read).toHaveBeenNthCalledWith(2, expect.objectContaining({ documentVersionId: 'new' }), expect.anything(), 1);
    parsing.status.mockImplementation(async (id: string) => { if (id === 'old') throw new Error('SOURCE_DENIED'); return {}; });
    await expect(service[method](input, context)).rejects.toThrow('SOURCE_DENIED');
    parsing.status.mockResolvedValue({});
    reader.readDocumentOriginal.mockImplementation(async id => ({ original: id === 'old' ? before.original : after.original,
      run: { sourceBinding: { familyId: id === 'old' ? 'family' : 'different' } } }));
    await expect(service[method](input, context)).rejects.toThrow('SAME_FAMILY_REQUIRED');
  });
});
