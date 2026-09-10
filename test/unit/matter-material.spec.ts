import {
  mergeMatterMaterials,
  materialInputBindings,
  parseMatterMaterial,
} from '../../server/modules/canonical-host/matter-material';
import type { MatterMaterialLink } from '@shared/matter-material.interface';

const member: MatterMaterialLink = {
  materialId: 'main',
  kind: 'MEMBER',
  familyId: 'family-A',
  documentVersionId: 'DV-A',
  scope: '持续告警分支',
  contribution: '源文件问题范围',
  basis: [],
  origin: 'DEFAULT_INTAKE',
  disposition: 'INCLUDED',
};
const expected: Extract<MatterMaterialLink, { kind: 'EXPECTED' }> = {
  materialId: 'future',
  kind: 'EXPECTED',
  familyId: null,
  documentVersionId: null,
  scope: '持续告警分支',
  contribution: '后续厂家措施',
  basis: [{ documentVersionId: 'DV-A', sourceRefId: 'SR-P7' }],
  origin: 'DOCUMENT',
  disposition: 'INCLUDED',
  expected: {
    issuer: 'OEM',
    documentNumber: null,
    description: '后续措施文件，尚未给出文号',
    expectedContribution: '核实是否覆盖持续告警',
    expectedDate: null,
    sourceAsOf: '2026-09-11',
    publicationStatus: 'PLANNED',
    acquisitionStatus: 'NOT_ACQUIRED',
    fulfilledBy: [],
  },
};
describe('Matter material semantics', () => {
  it('exposes real direct pending inputs and excludes an unacquired expectation from coverage', () => {
    expect(materialInputBindings([expected])).toEqual([]);
    expect(materialInputBindings([member])).toEqual([{
      kind: 'DOCUMENT_VERSION', inputId: 'main', familyId: 'family-A', documentVersionId: 'DV-A',
      workItemId: null, workItemRevision: null, resultRef: null, resultRevision: null,
    }]);
  });
  it('preserves an unnamed expected document without manufacturing a version or read coverage', () => {
    expect(parseMatterMaterial(expected)).toEqual(expected);
    expect(() =>
      parseMatterMaterial({ ...expected, documentVersionId: 'fake-version' }),
    ).toThrow('MATTER_MATERIAL_INVALID');
    expect(() => parseMatterMaterial({ ...expected, basis: [] })).toThrow(
      'MATTER_MATERIAL_INVALID',
    );
  });
  it('keeps omitted relationships and permits explicit partial many-to-many fulfillment', () => {
    const fulfilled = {
      ...expected,
      expected: {
        ...expected.expected,
        acquisitionStatus: 'PARTIALLY_ACQUIRED',
        fulfilledBy: [
          {
            familyId: 'family-B',
            documentVersionId: 'DV-B',
            scope: '仅冷启动措施',
          },
        ],
      },
    } as MatterMaterialLink;
    expect(mergeMatterMaterials([member, expected], [fulfilled])).toEqual([
      member,
      fulfilled,
    ]);
    expect(() =>
      parseMatterMaterial({
        ...fulfilled,
        expected: { ...expected.expected, acquisitionStatus: 'ACQUIRED' },
      }),
    ).toThrow('MATTER_MATERIAL_INVALID');
  });
  it('does not overwrite an engineer exclusion from another discovery of the same material', () => {
    const excluded = {
      ...member,
      origin: 'ENGINEER',
      disposition: 'EXCLUDED',
    } as MatterMaterialLink;
    expect(() => mergeMatterMaterials([excluded], [member])).toThrow(
      'MATTER_MATERIAL_ENGINEER_DECISION_CONFLICT',
    );
    expect(mergeMatterMaterials([excluded], [])).toEqual([excluded]);
    expect(
      mergeMatterMaterials(
        [excluded],
        [{ ...excluded, disposition: 'INCLUDED' }],
      ),
    ).toEqual([{ ...excluded, disposition: 'INCLUDED' }]);
  });
  it('does not reinterpret an existing WorkItem PRIMARY role as a member', () => {
    expect(() => parseMatterMaterial({ ...member, kind: 'PRIMARY' })).toThrow(
      'MATTER_MATERIAL_INVALID',
    );
  });
});
