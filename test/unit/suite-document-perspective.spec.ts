import { suiteDocumentPerspective } from '../../client/src/pages/RelationGraphPage/suite-document-perspective';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from './fixtures/library-matter';
it('shows only authorized document identities and original material relations without inferring document links', () => {
  const workspace = libraryMatterFixture();
  workspace.matter.materials = [{kind: 'RELATED', materialId: 'reference', familyId: 'family', documentVersionId: 'old-version', scope: '参考范围', contribution: '背景', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED'}];
  workspace.working.current!.state.substantiveResult!.evidence.push({kind: 'DOCUMENT_PASSAGE', title: '原文', versionLabel: 'R1', evidenceRef: 'excerpt', excerpt: '条件', workItemId: null, documentVersionId: 'old-version', sourceRefId: 'source', locator: 'page 1'});
  const full = buildSuiteMatterGraph(workspace);
  const documents = suiteDocumentPerspective(full);
  expect([...documents.targets.values()].map(target => target.kind)).toEqual(['material', 'evidence']);
  expect(documents.graph.relations).toHaveLength(1);
  expect(documents.graph.relations[0].type).toBe('RELATED');
  expect(documents.workRef).toBe(full.workRef);
  expect(documents.notices.join('')).toContain('不代表全库');
  expect(full.graph.groups.some(group => group.key === 'claims')).toBe(true);
});
