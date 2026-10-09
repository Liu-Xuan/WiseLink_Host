import {
  DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
  locateExactQuoteText,
  resolveSourceQuoteSelection,
  type QuoteSelectionHostContext,
} from '../../shared/document-activity-quote-selection';
import { materializeDocumentActivityQuoteSelection } from '../../server/modules/canonical-host/document-activity-candidate';

function binding() {
  return {
    original: {
      documentVersionId: 'DV-synthetic',
      parseRunId: 'PR-synthetic',
      parseRevision: 3,
      sourceArtifactId: 'ART-synthetic',
      sourceSha256: 'a'.repeat(64),
      sourceByteLength: 987,
    },
    semanticRevision: 7,
  };
}

function hostContext(): QuoteSelectionHostContext {
  return {
    sourceBinding: binding(),
    expectedSourceBinding: binding(),
    anchors: [
      { anchorId: 'ANCH-synthetic-a', sourceText: '🛠️\r\nCafe\u0301 must remain exact; Café is a distinct spelling.' },
      { anchorId: 'ANCH-synthetic-b', sourceText: 'same phrase in another delivered source' },
    ],
    allowedAnchorIds: ['ANCH-synthetic-a'],
  };
}

function selectorCandidate() {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
    statements: [{ statementKey: 'synthetic-1', label: 'Synthetic source statement',
      quotes: [{ anchorId: 'ANCH-synthetic-a', text: 'Cafe\u0301' }],
      time: null, statusRaw: null, limitations: ['Synthetic fixture only.'] }],
  };
}

describe('source-bound quote-selection reconstruction v1', () => {
  it('pins the transport marker and returns exact UTF-16 end-exclusive offsets without normalization', () => {
    expect(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA).toBe('wiselink.document.activity-quote-selection.v1');
    const sourceText = hostContext().anchors[0].sourceText;
    const quoteText = 'Cafe\u0301';
    const located = locateExactQuoteText(sourceText, quoteText);
    expect(located).toEqual({ status: 'UNIQUE', start: 5, end: 10 });
    if (located.status !== 'UNIQUE') throw new Error('expected one exact match');
    expect(sourceText.slice(located.start, located.end)).toBe(quoteText);
    expect(locateExactQuoteText('Cafe\u0301', 'Café')).toEqual({ status: 'NOT_FOUND' });
    expect(locateExactQuoteText(sourceText, '\r\nCafe\u0301')).toEqual({ status: 'UNIQUE', start: 3, end: 10 });
  });

  it('treats overlapping or repeated exact text as ambiguous instead of selecting a convenient occurrence', () => {
    expect(locateExactQuoteText('aaaa', 'aa')).toEqual({ status: 'AMBIGUOUS' });
    expect(locateExactQuoteText('once / once', 'once')).toEqual({ status: 'AMBIGUOUS' });
    expect(locateExactQuoteText('single occurrence', 'single')).toEqual({ status: 'UNIQUE', start: 0, end: 6 });
    expect(locateExactQuoteText('single occurrence', 'missing')).toEqual({ status: 'NOT_FOUND' });
  });

  it('reconstructs only a uniquely matching quote on an authorized delivered anchor', () => {
    const host = hostContext();
    const result = resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' }, host);
    expect(result).toEqual({ status: 'RESOLVED', quote: {
      anchorId: 'ANCH-synthetic-a', start: 11, end: 28, text: 'must remain exact',
    } });
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-b', text: 'same phrase' }, host))
      .toEqual({ status: 'UNRESOLVED', reason: 'ANCHOR_NOT_ALLOWED' });
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-unknown', text: 'same phrase' }, host))
      .toEqual({ status: 'UNRESOLVED', reason: 'UNKNOWN_ANCHOR' });
    const repeated = hostContext();
    repeated.anchors = [{ anchorId: 'ANCH-repeat', sourceText: 'repeat / repeat' }];
    repeated.allowedAnchorIds = ['ANCH-repeat'];
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-repeat', text: 'repeat' }, repeated))
      .toEqual({ status: 'UNRESOLVED', reason: 'TEXT_AMBIGUOUS' });
  });

  it('requires an exact own-property selector shape and exposes only bounded reason codes', () => {
    const inherited = Object.create({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' });
    for (const selection of [
      inherited,
      { anchorId: 'ANCH-synthetic-a', text: 'must remain exact', start: 11 },
      { anchorId: 'ANCH-synthetic-a', text: '' },
      { anchorId: 'ANCH-synthetic-a', text: 'absent' },
    ]) {
      const result = resolveSourceQuoteSelection(selection, hostContext());
      expect(result.status).toBe('UNRESOLVED');
      if (result.status === 'UNRESOLVED') expect(result.reason).toMatch(/^[A-Z_]+$/u);
    }
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: '' }, hostContext()))
      .toEqual({ status: 'UNRESOLVED', reason: 'EMPTY_TEXT' });
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'absent' }, hostContext()))
      .toEqual({ status: 'UNRESOLVED', reason: 'TEXT_NOT_FOUND' });
  });

  it('checks every original source-binding field and the semantic revision before selecting offsets', () => {
    const base = hostContext();
    const bindingFields = ['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'] as const;
    for (const field of bindingFields) {
      const changed = hostContext();
      changed.sourceBinding = structuredClone(base.sourceBinding);
      const oldValue = changed.sourceBinding.original[field];
      Object.assign(changed.sourceBinding.original, { [field]: field === 'sourceSha256'
        ? 'b'.repeat(64)
        : typeof oldValue === 'number'
          ? oldValue + 1
          : `${oldValue}-changed` });
      expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' }, changed))
        .toEqual({ status: 'UNRESOLVED', reason: 'SOURCE_BINDING_MISMATCH' });
    }
    const changedSemantic = hostContext();
    changedSemantic.sourceBinding.semanticRevision += 1;
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' }, changedSemantic))
      .toEqual({ status: 'UNRESOLVED', reason: 'SOURCE_BINDING_MISMATCH' });
  });

  it('rejects malformed Host context rather than attempting to infer authorization', () => {
    const context = hostContext();
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' }, {
      ...context, allowedAnchorIds: ['ANCH-not-present'],
    })).toEqual({ status: 'UNRESOLVED', reason: 'HOST_CONTEXT_INVALID' });
    expect(resolveSourceQuoteSelection({ anchorId: 'ANCH-synthetic-a', text: 'must remain exact' }, {
      ...context, anchors: [...context.anchors, context.anchors[0]],
    })).toEqual({ status: 'UNRESOLVED', reason: 'HOST_CONTEXT_INVALID' });
  });

  it('materializes the opt-in transport marker into the unchanged v1 numeric quote contract', () => {
    const materialized = materializeDocumentActivityQuoteSelection(selectorCandidate(), hostContext());
    expect(materialized).toEqual({
      schemaVersion: 'wiselink.document.activity-candidate.v1',
      statements: [{ statementKey: 'synthetic-1', label: 'Synthetic source statement',
        quotes: [{ anchorId: 'ANCH-synthetic-a', start: 5, end: 10, text: 'Cafe\u0301' }],
        time: null, statusRaw: null, limitations: ['Synthetic fixture only.'] }],
    });
  });

  it('rejects a mixed marker/quote shape and reports only the bounded statement/quote index', () => {
    const mixed = selectorCandidate();
    Object.assign(mixed.statements[0].quotes[0], { start: 5, end: 10 });
    expect(() => materializeDocumentActivityQuoteSelection(mixed, hostContext())).toThrow();

    const many = selectorCandidate();
    many.statements = Array.from({ length: 14 }, (_, index) => ({
      ...selectorCandidate().statements[0],
      statementKey: `synthetic-${index}`,
      quotes: [{ anchorId: 'ANCH-synthetic-a', text: index === 13 ? 'must' : 'Cafe\u0301' }],
    }));
    many.statements[13].quotes[0].text = 'repeat';
    const context = hostContext();
    context.anchors = [{ anchorId: 'ANCH-synthetic-a', sourceText: 'Cafe\u0301 / repeat and repeat' }];
    context.allowedAnchorIds = ['ANCH-synthetic-a'];
    let message = '';
    try { materializeDocumentActivityQuoteSelection(many, context); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toMatch(/:STATEMENT_13:QUOTE_0$/u);
    expect(message).not.toContain('repeat');
  });

  it('refuses quote-selection reconstruction when any source-binding field or revision has changed', () => {
    const base = hostContext();
    const bindingFields = ['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'] as const;
    for (const field of bindingFields) {
      const changed = hostContext();
      const oldValue = changed.sourceBinding.original[field];
      Object.assign(changed.sourceBinding.original, { [field]: field === 'sourceSha256'
        ? 'c'.repeat(64)
        : typeof oldValue === 'number' ? oldValue + 1 : `${oldValue}-new` });
      expect(() => materializeDocumentActivityQuoteSelection(selectorCandidate(), changed)).toThrow(/SOURCE_BINDING_MISMATCH/u);
    }
    const changedSemantic = hostContext();
    changedSemantic.expectedSourceBinding.semanticRevision += 1;
    expect(() => materializeDocumentActivityQuoteSelection(selectorCandidate(), changedSemantic)).toThrow(/SOURCE_BINDING_MISMATCH/u);
    expect(base.sourceBinding).toEqual(base.expectedSourceBinding);
  });

  it('fails closed for unknown and undelivered anchor IDs even when their text is identical', () => {
    const unknown = selectorCandidate();
    unknown.statements[0].quotes[0].anchorId = 'ANCH-missing';
    expect(() => materializeDocumentActivityQuoteSelection(unknown, hostContext())).toThrow(/UNKNOWN_ANCHOR/u);
    const unauthorized = selectorCandidate();
    unauthorized.statements[0].quotes[0].anchorId = 'ANCH-synthetic-b';
    expect(() => materializeDocumentActivityQuoteSelection(unauthorized, hostContext())).toThrow(/ANCHOR_NOT_ALLOWED/u);
  });
});
