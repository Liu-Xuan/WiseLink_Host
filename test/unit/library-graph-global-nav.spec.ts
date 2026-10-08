import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ShellAdapter } from '@client/src/components/ShellAdapter';
let nav: (page:string) => void;
jest.mock('@client/src/components/Shell', () => ({Shell:(props:ComponentProps<typeof import('@client/src/components/Shell').Shell>) => {nav=props.onNavigate!; return props.children;}}));
const {JSDOM} = require('jsdom');
let dom:{window:Window & typeof globalThis},root:Root,container:HTMLDivElement,path:string;
function Probe() {const location = useLocation();path=location.pathname+location.search;return null;}
beforeAll(() => {dom=new JSDOM('<body/>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});});
afterAll(() => dom.window.close());
beforeEach(() => {container=document.createElement('div');root=createRoot(container);});
afterEach(() => act(() => root.unmount()));
it.each(['/library','/graph?matterId=exact&workRef=history','/graph?scope=document&documentVersionId=r3'])('global graph navigation goes to macro from %s', async initial => {
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:[initial]},createElement(ShellAdapter,null,createElement(Probe)))));
  await act(async () => nav('graph'));
  expect(path).toBe('/graph?scope=library');
});
