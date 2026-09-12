import { structuredTranslationItems } from '../../../server/modules/canonical-host/canonical-translation-v2-plugin.service';
it('translates full cell text across fragments, retaining all anchors and separate labels', () => {
  const cell = '/payload/rowGroups/0/rows/0/cells/0/inlineContent/';
  const groups = structuredTranslationItems({ kind: 'table' }, [
    { anchorId: 'a1', sourceUnitId: 'u1', payloadPath: '/payload/title', sourceText: 'Limits' },
    { anchorId: 'a2', sourceUnitId: 'u1', payloadPath: cell + '0/text', sourceText: 'Do not use' },
    { anchorId: 'a3', sourceUnitId: 'u1', payloadPath: cell + '1/text', sourceText: 'unless X.' },
  ]);
  expect(groups).toEqual([
    { id: 'slot-1', text: 'Limits', anchorIds: ['a1'], kind: 'label' },
    { id: 'slot-2', text: 'Do not use\nunless X.', anchorIds: ['a2', 'a3'], kind: 'table_cell' },
  ]);
});
