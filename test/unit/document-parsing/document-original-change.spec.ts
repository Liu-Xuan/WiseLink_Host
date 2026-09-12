import { compareDocumentOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-original-change';
import { originalFixture } from './fixtures/document-original.fixture';

function pair() {
  const previous = originalFixture();
  previous.coverage.unresolvedRanges = [];
  previous.coverage.knownPageCount = 2;
  const next = structuredClone(previous); next.binding.parseRunId = 'PR-NEW'; next.binding.parseRevision++;
  next.source.units.forEach(unit => { unit.unitId = 'new-' + unit.unitId; });
  return { previous, next };
}
it('classifies pure positioning changes without requesting new content', () => {
  const { previous, next } = pair(); next.locations[0].viewportWidth = 700;
  expect(compareDocumentOriginal(previous, next).kind).toBe('LOCATOR_ONLY');
});
it('reports just an inserted unit rather than all shifted following units', () => {
  const { previous, next } = pair();
  next.source.units.unshift({ ...next.source.units[0], unitId: 'new-only', payload: { text: 'New exception.' }, sourceRefIds: ['new-ref'] });
  expect(compareDocumentOriginal(previous, next)).toMatchObject({ kind: 'SOURCE_CONTENT', changedUnitIds: ['new-only'], changedSourceRefIds: ['new-ref'] });
});
it('reports both identities when negation or object-value relationships change', () => {
  const { previous, next } = pair();
  previous.source.units[0].payload = { text: 'A: 12. B: 24.' }; next.source.units[0].payload = { text: 'A: 24. B: 12.' };
  expect(compareDocumentOriginal(previous, next).changedUnitIds).toEqual(['u1', 'new-u1']);
});
it('does not label a new unread range as a geometry-only improvement', () => {
  const { previous, next } = pair();
  next.coverage.unresolvedRanges.push({ pageIndexes: [1], unitIds: [], reason: 'UNREAD', message: 'Unread range.' });
  expect(compareDocumentOriginal(previous, next).kind).toBe('IMPACT_UNRESOLVED');
});
