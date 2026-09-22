import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SuiteMatterGraphView from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import type { SuiteGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import { libraryMatterFixture } from './fixtures/library-matter';
import {
 appendSuiteGraphCatalogDocuments,
 buildSuiteMatterGraph,
} from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { SuiteGraphReadingState } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
const {JSDOM} = require('jsdom');
let canvasProps: SuiteGraphCanvasProps, latest: SuiteGraphReadingState;
let mockCurrentLayout: import('../../client/src/pages/RelationGraphPage/suite-graph-layout-memory').SuiteGraphLayoutSnapshot | null = null;
let mockCurrentViewport: SuiteGraphReadingState['viewport'] | null = null;
jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
 const React = jest.requireActual<typeof import('react')>('react');
 return {__esModule:true, default:React.forwardRef((_props: SuiteGraphCanvasProps, _ref) => {canvasProps=_props; React.useImperativeHandle(_ref, () => ({ getViewport: () => mockCurrentViewport, getLayout: () => mockCurrentLayout })); return null;})};
});
jest.mock('@client/src/components/ui/button', () => ({Button: ({children,onClick,disabled}: {children:ReactNode;onClick?:()=>void;disabled?:boolean}) => createElement('button',{onClick,disabled},children)}));
jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphKnowledgePanel', () => ({__esModule:true,default:()=>null}));
const data = libraryMatterFixture(); const read=buildSuiteMatterGraph(data);
const cameraA={zoom:1.6,pan:{x:22,y:34}},cameraB={zoom:.8,pan:{x:4,y:5}};
function Wrapper() {
 const [perspective,setPerspective]=useState<'matter'|'documents'|'domain'|'panorama'>('matter');
 return createElement(SuiteMatterGraphView,{read,revision:data.working.current,perspective,onPerspectiveChange:setPerspective,availablePerspectives:['matter','documents','domain','panorama'],initialState:{perspective:'matter',viewport:cameraA},perspectiveNotice:perspective==='domain'?'正在读取该视角的授权数据…':null,onStateChange:state=>{latest=state;}});
}
let root:Root, container:HTMLDivElement,dom:{window:Window&typeof globalThis};
beforeAll(()=>{dom=new JSDOM('<body/>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});});
afterAll(()=>dom.window.close());
beforeEach(()=>{mockCurrentViewport=null;mockCurrentLayout=null;container=document.createElement('div');root=createRoot(container);});
afterEach(()=>act(()=>root.unmount()));
async function click(text:string){const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text)!;await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));}
it('keeps the initial URL camera and restores each perspective across pending data',async()=>{
 await act(async()=>root.render(createElement(Wrapper)));
 expect(canvasProps.initialViewport).toEqual(cameraA);expect(latest.viewport).toEqual(cameraA);
 await click('领域聚焦');expect(container.textContent).toContain('正在读取');expect(canvasProps.initialViewport).toBeUndefined();
 await act(async()=>canvasProps.onViewport?.(cameraB));
 await click('事项图谱');expect(canvasProps.initialViewport).toEqual(cameraA);expect(latest.viewport).toEqual(cameraA);
 await click('领域聚焦');expect(canvasProps.initialViewport).toEqual(cameraB);
});

it('keeps the reading thread on the exact primary source path', async () => {
 const entry: EngineeringMatterCatalogEntry = {
  workItemId:'ui-test-work-item', relationRole:'PRIMARY', linkedAtWorkItemRevision:1,
  currentWorkItemRevision:1, workItemChangedSinceLink:false, workItemStatus:'ACTIVE',
  document:{documentId:'ui-test-document',documentVersionId:'ui-test-version',documentCode:'SB-001',businessRevision:'R02',normalizedFamily:'SB-001'},
  documentCurrentness:{familyId:'ui-test-family',currentDocumentVersionId:'ui-test-version',currentGeneration:1,selectedVersionIsCurrent:true},
  sourceNavigation:{status:'AVAILABLE',sourceRefCount:1,structuredContentPath:'/document-versions/ui-test-version'},
 };
 const displayRead=appendSuiteGraphCatalogDocuments(read,[entry]);
 let openedWiki=false;
 let openedTarget:string|null=null;
 await act(async()=>root.render(createElement(SuiteMatterGraphView,{
  read:displayRead,revision:data.working.current,perspective:'matter',
  availablePerspectives:['matter'],onOpenWiki:()=>{openedWiki=true;},
  onOpenTarget:(target)=>{if(target.kind==='catalog-document') openedTarget=target.entry.document.documentVersionId;},
  initialState:{perspective:'matter'},onStateChange:()=>{},
 })));
 await click('测试事项：软件标准转换与一致性核查');
 expect(openedWiki).toBe(true);
 await click('确切原文');
 expect(openedTarget).toBe('ui-test-version');
});

jest.mock('../../client/src/pages/RelationGraphPage/suite-matter-graph-page.css', () => ({}));

it('captures a pending camera before building a navigation return and before switching perspectives', async () => {
 let openedCamera: SuiteGraphReadingState['viewport'];
 await act(async () => root.render(createElement(SuiteMatterGraphView, {
  read, revision: data.working.current, availablePerspectives: ['matter', 'documents'],
  initialState: { perspective: 'matter', viewport: cameraA },
  onStateChange: state => { latest = state; },
  onOpenWiki: () => { openedCamera = latest.viewport; },
 })));
 mockCurrentViewport = cameraB; // Real core moved but onViewport/RAF has not run.
 await click('测试事项：软件标准转换与一致性核查');
 expect(openedCamera).toEqual(cameraB);
 await click('工程文档');
 mockCurrentViewport = null;
 await click('事项图谱');
 expect(canvasProps.initialViewport).toEqual(cameraB);
});

it('carries layout through navigation and remount only within the exact authorized scope', async () => {
 const saved = { nodes: [{ id: 'node-a', base: { x: 0, y: 0 }, position: { x: 60, y: 90 }, w: 100, h: 40, baseW: 100, baseH: 40 }] };
 const props = { read, revision: data.working.current, layoutScope: 'session1/matter/work1',
  availablePerspectives: ['matter' as const], onStateChange: (state: SuiteGraphReadingState) => { latest = state; }, onOpenWiki: () => {} };
 await act(async () => root.render(createElement(SuiteMatterGraphView, props)));
 mockCurrentLayout = saved;
 await click('测试事项：软件标准转换与一致性核查');
 const state = latest;
 expect(state.layoutSnapshot).toMatch(/^gl-/);
 await act(async () => root.unmount());
 await act(async () => { root=createRoot(container); root.render(createElement(SuiteMatterGraphView, { ...props, initialState: state })); });
 expect(canvasProps.initialLayout).toEqual(saved);
 await act(async () => root.unmount());
 await act(async () => { root=createRoot(container); const otherScope = { ...props, layoutScope: 'session1/matter/work2', initialState: state }; root.render(createElement(SuiteMatterGraphView, otherScope)); });
 expect(canvasProps.initialLayout).toBeUndefined();
});
