import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), { virtual: true });
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1 }));
import MatterMaterials from '../../client/src/features/matter/MatterMaterials';
import type { MatterMaterialLink } from '@shared/matter-material.interface';

it('reads actual material and expectation state without creating a fake document navigation', () => {
  const materials: MatterMaterialLink[] = [{
    materialId: 'main', kind: 'RELATED', familyId: 'family-A', documentVersionId: 'DV-A',
    scope: '仅冷启动分支', contribution: '限制措施覆盖范围', origin: 'ENGINEER', disposition: 'INCLUDED', basis: [],
  }, {
    materialId: 'next', kind: 'EXPECTED', familyId: null, documentVersionId: null,
    scope: '持续告警分支', contribution: '后续解决措施', origin: 'DOCUMENT', disposition: 'INCLUDED',
    basis: [{ documentVersionId: 'DV-A', sourceRefId: 'SR-7' }],
    expected: { issuer: 'OEM', documentNumber: null, description: '后续措施文件尚无文号',
      expectedContribution: '核实持续告警覆盖', expectedDate: '2026-12', sourceAsOf: '2026-09-11',
      publicationStatus: 'PLANNED', acquisitionStatus: 'NOT_ACQUIRED', fulfilledBy: [],
    },
  }];
  const html = renderToStaticMarkup(createElement(MatterMaterials, { materials }));
  expect(html).toContain('相关参考');
  expect(html).toContain('限制措施覆盖范围');
  expect(html).toContain('计划发布');
  expect(html).toContain('尚未取得');
  expect(html).toContain('来源时点：2026-09-11');
  expect(html).toContain('data-document-version-id="DV-A"');
  expect(html).not.toContain('/work-items/');
  expect(html).not.toContain('data-document-version-id="null"');
});
