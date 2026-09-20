import {
  suiteGraphAppearance,
  suiteGraphIconKind,
} from '../../client/src/pages/RelationGraphPage/suite-graph-appearance';

describe('suite graph appearance', () => {
  it('honors named and literal declared colors before group fallbacks', () => {
    expect(suiteGraphAppearance('objects')).toEqual({ tone: 'blue' });
    expect(suiteGraphAppearance('records')).toEqual({ tone: 'purple' });
    expect(suiteGraphAppearance('custom', 'teal')).toEqual({ tone: 'teal' });
    expect(suiteGraphAppearance('custom', '  teal  ')).toEqual({ tone: 'teal' });
    expect(suiteGraphAppearance('custom', '#123456')).toEqual({
      tone: 'blue',
      color: '#123456',
    });
  });

  it('chooses icons by object kind before using the display group fallback', () => {
    expect(suiteGraphIconKind('record', 'documents')).toBe('record');
    expect(suiteGraphIconKind('component', 'documents')).toBe('component');
    expect(suiteGraphIconKind('catalog-document', 'records')).toBe('document');
    expect(suiteGraphIconKind('', 'questions')).toBe('question');
    expect(suiteGraphIconKind('', 'unknown')).toBe('document');
  });
});
