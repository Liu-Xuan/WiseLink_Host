import { graphActivityV2 } from './fixtures/graph-activity-v2';
import { saveLibraryGraphReturn } from '@client/src/pages/RelationGraphPage/library-graph-return-memory';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import SuiteDocumentGraphPage from '@client/src/pages/RelationGraphPage/SuiteDocumentGraphPage';
import type { SuiteDocumentGraphViewProps } from '@client/src/pages/RelationGraphPage/SuiteDocumentGraphView';
import type { useSuiteGraphSources } from '@client/src/pages/RelationGraphPage/useSuiteGraphSources';
import { documentNeighborhoodNodeId } from '@client/src/pages/RelationGraphPage/suite-document-neighborhood';
import { documentGraphReadingParams, graphReturnTarget, withGraphReturn } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import TopBar from '@client/src/features/navigation/TopBar';
import { libraryReadingParams } from '@client/src/features/matter/reading-return';
import { documentStatus, documentQuicklook, referencePreview, familyPage, mattersPage } from './fixtures/document-neighborhood';

jest.mock('@client/src/components/ui/button', () => ({
  Button: ({variant: _variant, size: _size, ...props}: Omit<ComponentProps<'button'>, 'size'> & {variant?: string; size?: string}) =>
    createElement('button', props),
}));
const { JSDOM } = require('jsdom');
let mockSession = 1, mockDenied = false;
let mockWithTopBar = false;
let mockView: SuiteDocumentGraphViewProps;
let mockSourcesInput: Parameters<typeof useSuiteGraphSources>[0];
const mockActivities = new Map();
const mockSelectSource = jest.fn();
jest.mock('@client/src/pages/RelationGraphPage/SuiteDocumentGraphView', () => ({__esModule:true, default:(props: SuiteDocumentGraphViewProps)=>{
  mockView=props;return createElement('div',{'data-testid':'document-view'},
    props.onBack ? createElement('button', { 'data-testid': 'graph-local-return', onClick: props.onBack }, '返回') : null,
    props.detail);
}}));
jest.mock('@client/src/components/CurrentUserControl', () => ({ __esModule: true, default: 'span' }));
jest.mock('@client/src/features/atlas/AtlasLauncher', () => ({ __esModule: true, default: 'span' }));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ currentObject: null }), currentObjectKindLabel: () => '工程文档',
}));
jest.mock('@client/src/pages/RelationGraphPage/useSuiteGraphSources', () => ({useSuiteGraphSources:(input: Parameters<typeof useSuiteGraphSources>[0])=>{
  mockSourcesInput=input;return {activities:mockActivities,sources:[],loading:false,selectSource:mockSelectSource,expandSource:jest.fn()};
}}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession:()=>({sessionGeneration:mockSession,authenticationRequired:mockDenied,currentUser:{user_id:`actor-${mockSession}`}})}));
jest.mock('@client/src/api/canonical-host', () => ({readDocumentParsingStatus:jest.fn(),getCanonicalLibraryQuicklook:jest.fn(),getCanonicalLibraryTasks:jest.fn(),getRelatedContextPreview:jest.fn(),
  getCanonicalHostClientSessionGeneration:()=>mockSession,
  isCanonicalObjectNotFound:(reason:{statusCode?:number})=>reason?.statusCode===404,
  summarizeCanonicalDocumentReadFailure:(reason:{statusCode?:number})=>({statusCode:reason?.statusCode}),
}));
jest.mock('@client/src/api/engineering-matter',()=>({getEngineeringMatterDirectory:jest.fn()}));
const api=jest.requireMock('@client/src/api/canonical-host');
const matterApi=jest.requireMock('@client/src/api/engineering-matter');
let root:Root,container:HTMLDivElement,location='',locationState:unknown,navigate:ReturnType<typeof useNavigate>,dom:{window:Window & typeof globalThis};
function Entry(){const [params]=useSearchParams();navigate=useNavigate();const here=useLocation();location=`${here.pathname}${here.search}`;locationState=here.state;
  if(params.get('scope')==='library') return createElement('div',null,'macro returned');
  return here.pathname==='/graph'?createElement('div', null,
    mockWithTopBar ? createElement(TopBar, { pathname: here.pathname, search: here.search,
      mobileNavOpen: false, onToggleMobile: () => undefined }) : null,
    createElement(SuiteDocumentGraphPage,{documentVersionId:params.get('documentVersionId')!,readerWorkItemId:params.get('readerWorkItemId')??undefined})):createElement('div',null,'source page');}
function render(entry='/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3'){root.render(createElement(MemoryRouter,{initialEntries:[entry]},createElement(Entry)));}
async function settle(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
beforeAll(()=>{dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});});
afterAll(()=>dom.window.close());
beforeEach(()=>{mockSession=1;mockDenied=false;mockWithTopBar=false;mockActivities.clear();jest.clearAllMocks();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  api.readDocumentParsingStatus.mockImplementation(async(id:string)=>documentStatus(id));
  api.getCanonicalLibraryQuicklook.mockImplementation(async(wi:string)=>documentQuicklook(wi==='wi-ftd-r4'?'ftd-r4':wi.replace('wi-','dv-'),wi));
  api.getCanonicalLibraryTasks.mockResolvedValue(familyPage());
  api.getRelatedContextPreview.mockImplementation(async(wi:string)=>{const p=referencePreview();const id=wi==='wi-ftd-r4'?'ftd-r4':wi.replace('wi-','dv-');p.documentVersionId=id;p.snapshot.primaryDocumentVersionRef=id;p.snapshot.workItemRef=wi;p.mentions.forEach(m=>{m.primaryDocumentVersionRef=id;});return p;});
  matterApi.getEngineeringMatterDirectory.mockResolvedValue(mattersPage());
});
afterEach(()=>{act(()=>root.unmount());container.remove();});
it('renders actual exact read consumer with three matters, old and current family versions and separate citation receipts',async()=>{
  await act(async()=>render());await settle();
  expect(mockView.graph.rootKind).toBe('document');expect(mockView.graph.id).toBe(documentNeighborhoodNodeId('dv-r3'));
  expect(mockView.graph.groups.find(g=>g.key==='matters')?.items).toHaveLength(3);
  expect(container.textContent).toContain('库内历史版本');expect(container.textContent).toContain('dv-r3');
  expect(mockSourcesInput.catalog[0].document.documentVersionId).toBe('dv-r3');
});
it('selects a related version in place, reads its info and selects its source without silently recentering',async()=>{
  await act(async()=>render());await settle();
  await act(async()=>mockView.onSelect(documentNeighborhoodNodeId('dv-r4')));await settle();
  expect(container.textContent).toContain('Selected dv-r4');expect(mockSelectSource).toHaveBeenCalledWith('dv-r4');
  expect(new URL(location,'https://example.test').searchParams.get('documentVersionId')).toBe('dv-r3');
  expect(api.getCanonicalLibraryQuicklook).toHaveBeenCalledWith('wi-r4',expect.any(AbortSignal));
  expect(api.getRelatedContextPreview).toHaveBeenCalledTimes(1);
});
it('opens citation source on the citing WorkItem and exact DV, without a guessed parse or target-version substitution',async()=>{
  await act(async()=>render());await settle();
  const occurrence=mockView.graph.relations.find(edge=>edge.type==='REFERENCE_OCCURRENCE')!;
  await act(async()=>mockView.onSelect(occurrence.target));
  expect(container.textContent).toContain('receipt-a');
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='打开引用方原文位置')!;
  await act(async()=>button.click());
  const url=new URL(location,'https://example.test');expect(url.pathname).toBe('/work-items/wi-r3/analysis');
  expect(url.searchParams.get('documentVersionId')).toBe('dv-r3');expect(url.searchParams.get('sourceRef')).toBe('source-1');
  expect(url.searchParams.has('parseRunId')).toBe(false);expect(url.searchParams.get('readerMode')).toBe('structured');
  expect(graphReturnTarget(url.searchParams,'dv-r3')?.route).toContain('scope=document');
});
it('keeps a last camera and exact scope on original→Back and on same-identity browser query changes',async()=>{
  await act(async()=>render());await settle();
  const viewport={zoom:0.7,pan:{x:22,y:33}};
  await act(async()=>{mockView.onStateChange({selectedId:documentNeighborhoodNodeId('dv-r4'),viewport},true);mockView.onOpenSource();});
  const url=new URL(location,'https://example.test');const back=new URLSearchParams(url.searchParams.get('returnGraphQuery')!);
  expect(back.get('documentVersionId')).toBe('dv-r3');expect(JSON.parse(back.get('viewport')!)).toEqual(viewport);
  await act(async()=>navigate(-1));await settle();expect(mockView.initialState?.viewport).toEqual(viewport);
  await act(async()=>navigate('/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&selectedId=exact-unavailable&density=2'));
  expect(mockView.selectedId).toBe('exact-unavailable');expect(mockView.initialState?.density).toBe(2);
});
it('does not let slow A overwrite B after a fast recenter',async()=>{
  let resolveA!:(value:ReturnType<typeof documentStatus>)=>void;
  api.readDocumentParsingStatus.mockImplementation((id:string)=>id==='dv-r3'?new Promise(resolve=>{resolveA=resolve;}):Promise.resolve(documentStatus(id)));
  await act(async()=>render());
  await act(async()=>navigate('/graph?scope=document&documentVersionId=dv-r4&readerWorkItemId=wi-r4'));await settle();
  expect(mockView.graph.id).toBe(documentNeighborhoodNodeId('dv-r4'));
  await act(async()=>resolveA(documentStatus('dv-r3')));await settle();
  expect(mockView.graph.id).toBe(documentNeighborhoodNodeId('dv-r4'));expect(container.textContent).not.toContain('Selected dv-r3');
});
it('clears graph on source revocation and shows no stale titles while exact scope is rechecked',async()=>{
  await act(async()=>render());await settle();
  await act(async()=>mockSourcesInput.onAccessRejected?.('dv-r3'));
  expect(container.textContent).toContain('来源授权已变化');expect(container.querySelector('[data-testid=document-view]')).toBeNull();
  api.readDocumentParsingStatus.mockRejectedValue({statusCode:404});
  await act(async()=>container.querySelector('button')!.click());await settle();
  expect(container.querySelector('[data-testid=document-view]')).toBeNull();expect(container.textContent).not.toContain('Selected dv-r3');
});
it('drops late prior-session reads and never renders data after logout',async()=>{
  let resolveRead!:(value:ReturnType<typeof documentStatus>)=>void;api.readDocumentParsingStatus.mockReturnValue(new Promise(resolve=>{resolveRead=resolve;}));
  await act(async()=>render());mockSession=2;mockDenied=true;
  await act(async()=>render());await act(async()=>resolveRead(documentStatus()));await settle();
  expect(container.textContent).toContain('请先登录');expect(container.querySelector('[data-testid=document-view]')).toBeNull();
});
it('clears old data during refresh and restores the last reading state when same exact identity succeeds',async()=>{
  await act(async()=>render());await settle();const viewport={zoom:1.2,pan:{x:7,y:9}};
  await act(async()=>mockView.onStateChange({viewport,selectedId:documentNeighborhoodNodeId('dv-r4')},true));
  let resolveRead!:(value:ReturnType<typeof documentStatus>)=>void;api.readDocumentParsingStatus.mockReturnValueOnce(new Promise(resolve=>{resolveRead=resolve;}));
  await act(async()=>mockView.onRefresh());expect(container.querySelector('[data-testid=document-view]')).toBeNull();
  await act(async()=>resolveRead(documentStatus()));await settle();expect(mockView.initialState?.viewport).toEqual(viewport);
});
it('replaces a bounded family page and clears stale selection rather than accumulating all versions',async()=>{
  api.getCanonicalLibraryTasks.mockResolvedValueOnce({...familyPage(),nextCursor:'next-family'}).mockResolvedValue({...familyPage(),items:[documentQuicklook('dv-page2','wi-page2').document]});
  await act(async()=>render());await settle();
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='下一页同族登记版本')!.click());await settle();
  expect(api.getCanonicalLibraryTasks.mock.calls.at(-1)[0].cursor).toBe('next-family');
  expect(mockView.graph.groups.find(g=>g.key==='versions')?.items.some(item=>item.id===documentNeighborhoodNodeId('dv-r4'))).toBe(false);
  expect(mockView.graph.groups.find(g=>g.key==='versions')?.items.some(item=>item.id===documentNeighborhoodNodeId('dv-page2'))).toBe(true);
});
it('returns exact event pins and rejects conflicting document-scope return identity',()=>{
  const pins={documentVersionId:'dv-r3',familyId:'family-a',parseRunId:'old-parse',candidateRevision:2,runRef:'old-run',statementId:'s1',anchorId:'a1'};
  const eventId=JSON.stringify(['event','dv-r3','old-parse','2','old-run','s1']);
  const query=documentGraphReadingParams('dv-r3','wi-r3',{eventId,eventPins:pins});
  const url=new URL(withGraphReturn('/document-versions/dv-r3?parseRunId=old-parse',query),'https://example.test');
  expect(graphReturnTarget(url.searchParams,'dv-r3','old-parse')?.route).toContain('eventPins=');
  expect(graphReturnTarget(url.searchParams,'dv-r3','new-parse')).toBeNull();
  query.set('matterId','wrong');url.searchParams.set('returnGraphQuery',query.toString());
  expect(graphReturnTarget(url.searchParams,'dv-r3','old-parse')).toBeNull();
});

it('keeps every independent occurrence accessible from the real page’s aggregate selection and graph return',async()=>{
  await act(async()=>render());await settle();
  const ids=mockView.graph.relations.filter(edge=>edge.type==='REFERENCE_OCCURRENCE').map(edge=>edge.id);
  await act(async()=>mockView.onSelect(ids[0],ids));
  expect(container.textContent).toContain('此连接含 2 条独立记录');
  const second=[...container.querySelectorAll('button')].find(b=>b.textContent?.startsWith('2. FTD R3'))!;
  await act(async()=>second.click());expect(container.textContent).toContain('mention-ref-2');
  await act(async()=>mockView.onStateChange({selectedId:ids[1]},true));
  const stored=new URL(location,'https://example.test').searchParams;
  expect(JSON.parse(stored.get('selectedRelationIds')!)).toEqual(ids);
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='打开引用方原文位置')!.click());
  const url=new URL(location,'https://example.test');expect(url.searchParams.get('sourceRef')).toBe('source-2');
  expect(graphReturnTarget(url.searchParams,'dv-r3')?.route).toContain('selectedRelationIds=');
});

it('projects saved source time in the actual document page and opens exact historical event pins',async()=>{
  mockActivities.set('dv-r3',{familyId:'family-a',candidate:{schemaVersion:'wiselink.document.activity-candidate.v1',runRef:'old-run',candidateRevision:2,
    sourceBinding:{original:{documentVersionId:'dv-r3',parseRunId:'old-parse'}},sourceAnchors:[],
    statements:[{statementKey:'key-s1',statementId:'s1',label:'Source reported action',quotes:[{anchorId:'anchor-1',start:0,end:4,text:'source quote'}],
      time:{role:'OCCURRED',precision:'DAY',expression:'CALENDAR',raw:'2020-02-02',quoteIndex:0},statusRaw:null,limitations:['source condition']} ]}});
  await act(async()=>render());await settle();const event=mockView.timelineEvents[0];
  expect(event.nodeId).toBe(documentNeighborhoodNodeId('dv-r3'));
  await act(async()=>mockView.onSelectEvent(event));expect(container.textContent).toContain('source quote');expect(container.textContent).toContain('source condition');
  await act(async()=>{mockView.onStateChange({selectedId:event.nodeId!,eventId:event.id,eventPins:event.pins!},true);mockView.onOpenEventTimeline(event);});
  const url=new URL(location,'https://example.test');expect(url.pathname).toBe('/timeline');
  expect(url.searchParams.get('parseRunId')).toBe('old-parse');expect(url.searchParams.get('runRef')).toBe('old-run');
  expect(url.searchParams.get('candidateRevision')).toBe('2');expect(url.searchParams.get('statementId')).toBe('s1');
  const back=graphReturnTarget(url.searchParams,'dv-r3','old-parse')!;
  await act(async()=>navigate(back.route));await settle();expect(mockSourcesInput.restorePins?.parseRunId).toBe('old-parse');
});


it('returns exact bounded macro scope and ancestors after the real selected-document source round trip',async()=>{
  const snapshot={query:'scope=library&level=versions&familyId=family-a&cursor=macro-page&selectedId=library%3Aversion%3Adv-r3&viewport=%7B%22zoom%22%3A1.2%2C%22pan%22%3A%7B%22x%22%3A7%2C%22y%22%3A9%7D%7D&displaySession=1',
    parent:'scope=library&level=families&groupBy=ata&clusterValue=20&search=737',root:'scope=library&groupBy=ata&search=737'};
  const token=saveLibraryGraphReturn(snapshot,1)!;
  await act(async()=>render(`/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&returnLibrarySnapshot=${token}`));await settle();
  await act(async()=>mockView.onOpenSource());
  const source=new URL(location,'https://example.test');
  const returned=graphReturnTarget(source.searchParams,'dv-r3')!;
  expect(returned.route).toContain(`returnLibrarySnapshot=${token}`);
  await act(async()=>navigate(returned.route));await settle();
  await act(async()=>mockView.onBack!());
  expect(location).toBe(`/graph?${snapshot.query}`);expect(locationState).toEqual({libraryRoot:snapshot.root,libraryParent:snapshot.parent});
});
it('keeps an expired macro return visible and opens a fresh overview instead of an unrelated matter',async()=>{
  await act(async()=>render('/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&returnLibrarySnapshot=lr-00000000-0000-0000-0000-000000000000'));await settle();
  expect(mockView.notices).toContain('概览返回状态已过期；返回将重新打开全库概览。');
  await act(async()=>mockView.onBack!());expect(location).toBe('/graph?scope=library');
});
it('cannot reuse an old-account macro return while the selected document remains readable in the new session',async()=>{
  const token=saveLibraryGraphReturn({query:'scope=library&search=previous-actor'},1)!;
  const entry=`/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&returnLibrarySnapshot=${token}`;
  await act(async()=>render(entry));await settle();mockSession=2;
  await act(async()=>render(entry));await settle();
  expect(mockView.notices).toContain('概览返回状态已过期；返回将重新打开全库概览。');
  await act(async()=>mockView.onBack!());expect(location).toBe('/graph?scope=library');expect(location).not.toContain('previous-actor');
});

it('mounts v2 document details for the shared opt-in source contract and returns the selected time row with exact pins', async () => {
  const saved = graphActivityV2('dv-r3', 'old-parse', 'family-a', 'old-run');
  mockActivities.set('dv-r3', { familyId: saved.familyId, candidate: saved.candidate });
  await act(async () => render()); await settle();
  expect(mockView.timelineEvents).toHaveLength(3);
  const event = mockView.timelineEvents[2];
  await act(async () => mockView.onSelectEvent(event));
  expect(container.querySelector('[data-testid="activity-statement-semantics"]')?.textContent).toContain('only after CIDB');
  expect(container.textContent).toContain('来源声明：已完成');
  await act(async () => { mockView.onStateChange({ selectedId: event.nodeId!, eventId: event.id, eventPins: event.pins! }, true); mockView.onOpenEventTimeline(event); });
  const target = new URL(location, 'https://example.test');
  expect(target.searchParams.get('anchor')).toBe('anchor-1');
  expect(target.searchParams.get('statementId')).toBe('st-1');
  expect(target.searchParams.get('runRef')).toBe('old-run');
  const returned = graphReturnTarget(target.searchParams, 'dv-r3', 'old-parse')!;
  await act(async () => navigate(returned.route)); await settle();
  expect(mockSourcesInput.restorePins).toEqual(event.pins);
  expect(mockView.timelineEvents.find(item => item.id === event.id)?.date).toBe('after approval');
  expect(container.querySelector('[data-testid="activity-statement-semantics"]')).not.toBeNull();
});

it.each(['local', 'global'] as const)('uses the %s return control for the same exact directory after graph state and source round trips', async control => {
  mockWithTopBar = true;
  const directory = libraryReadingParams(new URLSearchParams({ mode: 'document', familyId: 'family-a',
    selectedDocumentVersionId: 'dv-r3', search: '737-SL', normalizedFamily: 'SL', ata2: '34', ata4: '3462',
    aircraftModels: JSON.stringify(['737-700', '737-800']), expandedFamilyIds: 'family-a,family-b', listY: '735', quicklookY: '81' }));
  const graph = documentGraphReadingParams('dv-r3', 'wi-r3', {},
    new URLSearchParams({ returnDocumentVersionId: 'dv-r3', returnLibraryQuery: directory.toString() }));
  await act(async () => render(`/graph?${graph}`)); await settle();
  await act(async () => mockView.onStateChange({ density: 3, viewport: { zoom: .8, pan: { x: 22, y: 33 } } }, true));
  await act(async () => mockView.onOpenSource());
  const source = new URL(location, 'https://example.test');
  const returned = graphReturnTarget(source.searchParams, 'dv-r3')!;
  await act(async () => navigate(returned.route)); await settle();
  const button = control === 'local'
    ? container.querySelector<HTMLButtonElement>('[data-testid="graph-local-return"]')!
    : container.querySelector<HTMLButtonElement>('button[aria-label="返回原文档目录"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(location).toBe(`/library?${directory}`);
});

it.each(['wrong-version', 'duplicate', 'conflicting', 'empty'] as const)(
  'rejects %s explicit library return in both controls before and after state replacement', async kind => {
    mockWithTopBar = true;
    const origin = new URLSearchParams({ returnDocumentVersionId: 'dv-r3',
      returnLibraryQuery: 'mode=document&familyId=family-a&selectedDocumentVersionId=dv-r3' });
    if (kind === 'wrong-version') origin.set('returnDocumentVersionId', 'different-version');
    if (kind === 'duplicate') origin.append('returnLibraryQuery', origin.get('returnLibraryQuery')!);
    if (kind === 'conflicting') origin.set('returnWorkItemId', 'different-work');
    if (kind === 'empty') origin.set('returnLibraryQuery', '');
    await act(async () => render(`/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&${origin}`)); await settle();
    for (const persist of [false, true]) {
      if (persist) await act(async () => mockView.onStateChange({ density: 4 }, true));
      expect(mockView.onBack).toBeUndefined();
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="返回目标与当前版本不匹配"]')!;
      expect(button.disabled).toBe(true);
      const before = location;
      await act(async () => button.click());
      expect(location).toBe(before);
    }
  },
);

it('retains the original directory selection when the user centers another exact registered version', async () => {
  mockWithTopBar = true;
  const directory = libraryReadingParams(new URLSearchParams({ mode: 'document', familyId: 'family-a',
    selectedDocumentVersionId: 'dv-r3', listY: '735', expandedFamilyIds: 'family-a' }));
  const graph = documentGraphReadingParams('dv-r3', 'wi-r3', {},
    new URLSearchParams({ returnDocumentVersionId: 'dv-r3', returnLibraryQuery: directory.toString() }));
  await act(async () => render(`/graph?${graph}`)); await settle();
  await act(async () => mockView.onSelect(documentNeighborhoodNodeId('dv-r4'))); await settle();
  const center = [...container.querySelectorAll('button')].find(button => button.textContent === '以此版本为中心')!;
  await act(async () => center.click()); await settle();
  const params = new URL(location, 'https://example.test').searchParams;
  expect(params.get('documentVersionId')).toBe('dv-r4');
  expect(params.get('readerWorkItemId')).toBe('wi-r4');
  expect(params.get('returnDocumentVersionId')).toBe('dv-r4');
  expect(params.get('returnLibraryQuery')).toBe(directory.toString());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="返回原文档目录"]')!.click());
  expect(location).toBe(`/library?${directory}`);
});

it('retains history-based local return for legacy document graph entries without return pins', async () => {
  const prior = '/library?mode=document&familyId=family-a&listY=735';
  await act(async () => render(prior));
  await act(async () => navigate('/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3')); await settle();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="graph-local-return"]')!.click());
  expect(location).toBe(prior);
});

it.each([
  ['absolute URL', 'https://example.invalid/library?selectedDocumentVersionId=dv-r3'],
  ['duplicate selection', 'mode=document&familyId=family-a&selectedDocumentVersionId=dv-r3&selectedDocumentVersionId=dv-r4'],
])('rejects %s nested directory intent in both controls across graph/source replacements',
  async (_kind: string, raw: string) => {
    mockWithTopBar = true;
    const origin: URLSearchParams = new URLSearchParams({ returnDocumentVersionId: 'dv-r3',
      returnLibraryQuery: raw });
    await act(async () => render(`/graph?scope=document&documentVersionId=dv-r3&readerWorkItemId=wi-r3&${origin}`));
    await settle();
    for (const stage of ['entry', 'view', 'source'] as const) {
      if (stage === 'view') await act(async () => mockView.onStateChange({ density: 4 }, true));
      if (stage === 'source') {
        await act(async () => mockView.onOpenSource());
        const source: URL = new URL(location, 'https://example.test');
        const returned: { route: string; label: string } = graphReturnTarget(source.searchParams, 'dv-r3')!;
        await act(async () => navigate(returned.route)); await settle();
      }
      expect(new URL(location, 'https://example.test').searchParams.has('returnLibraryQuery')).toBe(true);
      expect(mockView.onBack).toBeUndefined();
      const button: HTMLButtonElement = container.querySelector<HTMLButtonElement>(
        'button[aria-label="返回目标与当前版本不匹配"]')!;
      expect(button.disabled).toBe(true);
      const before: string = location;
      await act(async () => button.click());
      expect(location).toBe(before);
    }
  },
);
