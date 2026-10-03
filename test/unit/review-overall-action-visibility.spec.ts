import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

const page = readFileSync(resolve(__dirname,
  '../../client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'), 'utf8');

it('keeps the saved-work Overall action outside the JobAid child switch', () => {
  const ast = ts.createSourceFile('DocumentParsingPage.tsx', page,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sections: ts.JsxElement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === 'section' &&
      node.openingElement.attributes.properties.some((property) =>
        ts.isJsxAttribute(property) &&
        property.name.getText(ast) === 'aria-label' &&
        property.initializer?.getText(ast) === '"已保存评估综合"')) {
      sections.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(sections).toHaveLength(1);
  const ancestors: string[] = [];
  for (let node: ts.Node | undefined = sections[0].parent; node; node = node.parent) {
    if (ts.isJsxElement(node))
      ancestors.push(node.openingElement.tagName.getText(ast));
  }
  expect(ancestors).toContain('WorkItemAssessmentWorkspace');
  expect(ancestors).toContain('RetainedWorkbenchPanel');
  expect(ancestors).not.toContain('JobAidProblemWorkspace');
  const action = sections[0].getText(ast);
  expect(action).toContain('disabled={reviewOverallProjection.busy || loading}');
  expect(action).toContain('onClick={() => void reviewOverallProjection.run()}');
  expect(action).toContain('role="status"');
  expect(page).toContain('isJobAidProblemProjection(integratedAssessment?.baseRules) &&');
  expect(page).toContain('(reviewOverallProjection.visible || reviewOverallProjection.message)');
});
