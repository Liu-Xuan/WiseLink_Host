import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SuiteMatterGraphView from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import type { SuiteGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import { libraryMatterFixture } from './fixtures/library-matter';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteGraphReadingState } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
const {JSDOM} = require('jsdom');
let canvasProps: SuiteGraphCanvasProps, latest: SuiteGraphReadingState;
jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
 const React = jest.requireActual<typeof import('react')>('react');
 return {__esModule:true, default:React.forwardRef((_props: SuiteGraphCanvasProps, _ref) => {canvasProps=_props; return null;})};
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
beforeEach(()=>{container=document.createElement('div');root=createRoot(container);});
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

jest.mock('../../client/src/pages/RelationGraphPage/suite-matter-graph-page.css', () => ({}));
