import { DocumentActivityRuntimeService } from '../../server/modules/canonical-host/document-activity-runtime.service';
import { DocumentActivityReadingController } from '../../server/modules/canonical-host/document-activity-reading.controller';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
  documentActivityStatementTimes, documentActivityStatementStatusRaw, isDocumentActivityStatementV2,
  type DocumentActivityRevisionV2, type DocumentActivityStatement, type DocumentActivityReadingResponse,
} from '../../shared/document-activity.interface';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture(); const context = { tenantId: 't', actorUserId: 'native-reader', roles: [] as string[], documentVersionId: original.binding.documentVersionId };
  const saved: DocumentActivityRevisionV2 = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
    candidateOnly: true, runRef: 'DAR-source', candidateRevision: 4, sourceBinding: { original: original.binding, semanticRevision: 7 },
    producer: { skillVersion: 'saved-fixture', modelVersion: 'not-called' }, savedAt: '2026-10-06T00:00:00Z',
    sourceAnchors: [], readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: ['leaf'] }, deliveredRanges: [], sourceCoverage: original.coverage },
    sourceContext: { schemaVersion: 'wiselink.document.activity-source-context.v1', sourceBinding: { original: original.binding, semanticRevision: 7 },
      profile: { profileRef: 'unknown.family.sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
      sections: [{ sectionId: 'leaf', parentSectionId: null, titleRaw: '来源原章😀', roleKey: null, headingUnitId: 'u1', deliveredUnitIds: ['u1'], contextForSectionIds: [] }], organizationWarnings: [] },
    statements: [{ statementId: 'DAS-source', statementKey: 'source', label: '候选来源声明', quotes: [],
      subject: null, action: null, modality: { raw: 'shall not', quoteIndex: 0, meaning: 'REQUIRED', negationQuoteIndexes: [0] },
      status: { raw: 'source reports completion', quoteIndex: 0, meaning: 'SOURCE_REPORTED_COMPLETED' },
      times: [{ raw: ' Q4 2026\r\n', quoteIndex: 0, role: 'TARGET', precision: 'QUARTER', expression: 'CALENDAR' },
        { raw: 'TBD', quoteIndex: 0, role: 'UNKNOWN', precision: 'UNKNOWN', expression: 'TBD' },
        { raw: 'after approval', quoteIndex: 0, role: 'CONDITION', precision: 'UNKNOWN', expression: 'RELATIVE' }],
      technicalIds: [{ raw: 'LN 2024-2026', quoteIndex: 0, kind: 'AIRCRAFT_LINE_NUMBER' }],
      scope: { sectionIds: ['leaf'], conditions: [{ raw: 'only after CIDB', quoteIndex: 0, kind: 'PREREQUISITE', appliesTo: 'SECTION', sectionIds: ['leaf'] }], completeness: 'PARTIAL' }, limitations: ['No verified execution claim.'] }] };
  const events: string[] = [];
  const parsing = { inspectPublishedIdentity: jest.fn(async () => { events.push('source-identity'); return { familyId: 'family', binding: original.binding }; }),
    status: jest.fn(async () => { events.push('fresh-ACL'); return {}; }) };
  const semantics = { readReady: jest.fn(async () => { events.push('exact-semantic'); return { semanticRevision: 7 }; }), read: jest.fn(), ensure: jest.fn() };
  const runs = { readSaved: jest.fn(async () => { events.push('exact-saved-query'); return saved; }), begin: jest.fn(), save: jest.fn() };
  const actors = { withActorScope: jest.fn() }; const reader = { readDocumentOriginal: jest.fn() }; const authorization = { authorizeDocumentWork: jest.fn() };
  const service = new DocumentActivityRuntimeService(authorization as never, actors as never, reader as never, semantics as never, parsing as never, runs as never, { captureForNewTask: jest.fn() } as never);
  const request = { documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId, candidateRevision: 4 };
  return { original, context, saved, parsing, semantics, runs, actors, reader, authorization, service, request, events };
}

describe('explicit browser v2 source-read acceptance (saved fixtures, no browser/provider/storage run)', () => {
  it('keeps default and explicit false on the exact old v1 response contract', async () => {
    const f = fixture(); await expect(f.service.readForBrowser(f.request,f.context)).rejects.toThrow('BROWSER_SCHEMA_UNSUPPORTED');
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:false },f.context)).rejects.toThrow('BROWSER_SCHEMA_UNSUPPORTED');
    const legacy = { ...f.saved,schemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,statements:[] }; delete (legacy as Record<string,unknown>).sourceContext;
    f.runs.readSaved.mockResolvedValue(legacy as never);
    const result: DocumentActivityReadingResponse = await f.service.readForBrowser(f.request,f.context);
    expect(Object.keys(result).sort()).toEqual(['binding','candidate','familyId']); expect(result.candidate).toBe(legacy);
  });
  it('explicit true returns the saved DTO without discarding times, cues, negation, conditions, technical IDs or sourceContext', async () => {
    const f = fixture(); const result = await f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context);
    expect(result.sourceSchemaVersion).toBe(DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2); expect(result.candidate).toBe(f.saved);
    expect(result.candidate).toEqual(f.saved); expect(result.candidate!.sourceBinding.semanticRevision).toBe(7);
    expect(f.events).toEqual(['source-identity','exact-saved-query','exact-semantic','fresh-ACL']);
    expect(f.runs.readSaved).toHaveBeenCalledWith(f.context,f.request.parseRunId,4);
    expect(f.semantics.readReady).toHaveBeenCalledWith(f.context,f.request.parseRunId,7);
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled(); expect(f.semantics.read).not.toHaveBeenCalled();
    expect(f.runs.begin).not.toHaveBeenCalled(); expect(f.runs.save).not.toHaveBeenCalled(); expect(f.actors.withActorScope).not.toHaveBeenCalled();
  });
  it('true accepts saved v1 with its actual v1 tag and records no saved result as null', async () => {
    const f = fixture(); f.runs.readSaved.mockResolvedValue({ ...f.saved,schemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,statements:[] } as never);
    expect((await f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).sourceSchemaVersion).toBe(DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA);
    f.runs.readSaved.mockResolvedValue(null);
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).resolves.toEqual({familyId:'family',binding:f.original.binding,sourceSchemaVersion:null,candidate:null});
  });
  it.each(['documentVersionId','parseRunId','parseRevision','sourceArtifactId','sourceSha256','sourceByteLength'] as const)('rejects drift in exact original %s', async field => {
    const f = fixture(); const changed = { ...f.saved,sourceBinding: { ...f.saved.sourceBinding,original: { ...f.original.binding } } };
    (changed.sourceBinding.original as unknown as Record<string,unknown>)[field] = typeof f.original.binding[field]==='number' ? Number(f.original.binding[field])+1 : `other-${f.original.binding[field]}`;
    f.runs.readSaved.mockResolvedValue(changed);
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).rejects.toThrow('RESULT_BINDING_MISMATCH');
  });
  it('never falls back to latest on a missing or mismatched exact candidate/semantic version and rechecks source access', async () => {
    const f = fixture(); f.runs.readSaved.mockResolvedValue({ ...f.saved,candidateRevision:5 });
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).rejects.toThrow('RESULT_BINDING_MISMATCH');
    expect(f.runs.readSaved).toHaveBeenCalledTimes(1); f.runs.readSaved.mockResolvedValue(f.saved); f.semantics.readReady.mockResolvedValueOnce(null);
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).rejects.toThrow('SEMANTIC_REVISION_NOT_FOUND');
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_REVOKED'));
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).rejects.toThrow('SOURCE_REVOKED');
  });
  it('still rejects unknown schema and non-boolean opt-in', async () => {
    const f = fixture(); f.runs.readSaved.mockResolvedValue({ ...f.saved,schemaVersion:'unknown' } as never);
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:true },f.context)).rejects.toThrow('BROWSER_SCHEMA_UNSUPPORTED');
    await expect(f.service.readForBrowser({ ...f.request,acceptCandidateSchemaV2:'true' } as never,f.context)).rejects.toThrow();
  });
  it('pure compatibility helpers preserve all ordered raw time roles and source status with no mutation', () => {
    const f = fixture(),statement=f.saved.statements[0]; expect(isDocumentActivityStatementV2(statement)).toBe(true);
    const times=documentActivityStatementTimes(statement);expect(times).toEqual(statement.times);expect(times).not.toBe(statement.times);expect(times[0]).not.toBe(statement.times[0]);
    times[0].raw='mutated view';expect(statement.times[0].raw).toBe(' Q4 2026\r\n');expect(documentActivityStatementStatusRaw(statement)).toBe('source reports completion');
    const legacy:DocumentActivityStatement={statementId:'legacy',statementKey:'legacy',label:'Legacy source',quotes:[],time:statement.times[1],statusRaw:'planned',limitations:[]};
    expect(isDocumentActivityStatementV2(legacy)).toBe(false);expect(documentActivityStatementTimes(legacy)).toEqual([legacy.time]);expect(documentActivityStatementStatusRaw(legacy)).toBe('planned');
    expect(documentActivityStatementTimes({...legacy,time:null})).toEqual([]);expect(documentActivityStatementStatusRaw({...statement,status:null})).toBeNull();
  });
});

describe('existing activity-reading HTTP query contract', () => {
  it('forwards explicit query booleans and preserves old absent-query request shape', async () => {
    const readForBrowser=jest.fn().mockResolvedValue({});const controller=new DocumentActivityReadingController({readForBrowser} as never);
    const request={ userContext:{ userId:'reader',tenantId:'tenant',roles:[] } } as never;
    await controller.read('DV','PR','3',request);
    expect(readForBrowser.mock.calls[0][0]).toEqual({documentVersionId:'DV',parseRunId:'PR',candidateRevision:3});
    await controller.read('DV','PR','3',request,'true'); expect(readForBrowser.mock.calls[1][0]).toEqual({documentVersionId:'DV',parseRunId:'PR',candidateRevision:3,acceptCandidateSchemaV2:true});
    await controller.read('DV','PR',undefined,request,'false');expect(readForBrowser.mock.calls[2][0]).toEqual({documentVersionId:'DV',parseRunId:'PR',acceptCandidateSchemaV2:false});
  });
  it.each(['TRUE','1','','yes', ['true','false']] as const)('rejects invalid opt-in query %s before calling the reader', async value => {
    const readForBrowser=jest.fn();const controller=new DocumentActivityReadingController({readForBrowser} as never);
    await expect(controller.read('DV','PR',undefined,{} as never,value as string)).rejects.toThrow('DOCUMENT_ACTIVITY_SCHEMA_OPT_IN_INVALID');expect(readForBrowser).not.toHaveBeenCalled();
  });
});
