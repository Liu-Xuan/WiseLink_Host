export type SuiteGraphTone = 'blue' | 'green' | 'amber' | 'rose' | 'teal' | 'purple' | 'neutral';

export type SuiteGraphIconKind =
  | 'activity'
  | 'book'
  | 'claim'
  | 'component'
  | 'configuration'
  | 'document'
  | 'input'
  | 'matter'
  | 'plane'
  | 'question'
  | 'record'
  | 'statement'
  | 'topic'
  | 'work';

export interface SuiteGraphAppearance {
  tone: SuiteGraphTone;
  color?: string;
}

const TONES = new Set<SuiteGraphTone>([
  'blue',
  'green',
  'amber',
  'rose',
  'teal',
  'purple',
  'neutral',
]);

const GROUP_TONES: Record<string, SuiteGraphTone> = {
  objects: 'blue',
  claims: 'blue',
  matters: 'blue',
  documents: 'green',
  fulfilled: 'green',
  MEMBER: 'green',
  inputs: 'green',
  domains: 'amber',
  EXPECTED: 'amber',
  statements: 'amber',
  questions: 'rose',
  systems: 'teal',
  records: 'purple',
  evidence: 'purple',
  RELATED: 'neutral',
  catalog: 'neutral',
  unclassified: 'neutral',
};

const KIND_ICONS: Record<string, SuiteGraphIconKind> = {
  document: 'document',
  'catalog-document': 'document',
  material: 'document',
  record: 'record',
  plane: 'plane',
  chapter: 'book',
  component: 'component',
  topic: 'topic',
  question: 'question',
  work: 'work',
  event: 'activity',
  discussion: 'topic',
  configuration: 'configuration',
  input: 'input',
  evidence: 'record',
  claim: 'claim',
  statement: 'statement',
  'matter-node': 'matter',
};

const GROUP_ICONS: Record<string, SuiteGraphIconKind> = {
  objects: 'plane',
  documents: 'document',
  fulfilled: 'document',
  MEMBER: 'document',
  RELATED: 'document',
  EXPECTED: 'document',
  inputs: 'input',
  questions: 'question',
  evidence: 'record',
  claims: 'claim',
  domains: 'book',
  systems: 'component',
  records: 'record',
  catalog: 'document',
  statements: 'statement',
  matters: 'matter',
};

function isTone(value: string): value is SuiteGraphTone {
  return TONES.has(value as SuiteGraphTone);
}

export function suiteGraphAppearance(groupKey: string, declaredColor?: string): SuiteGraphAppearance {
  const color = declaredColor?.trim();
  if (color && isTone(color)) return { tone: color };
  return {
    tone: GROUP_TONES[groupKey] ?? 'blue',
    ...(color ? { color } : {}),
  };
}

export function suiteGraphIconKind(itemKind: string, groupKey: string): SuiteGraphIconKind {
  return KIND_ICONS[itemKind] ?? GROUP_ICONS[groupKey] ?? 'document';
}
