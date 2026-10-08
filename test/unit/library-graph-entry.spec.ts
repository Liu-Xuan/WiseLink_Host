import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import RelationGraphPage from '@client/src/pages/RelationGraphPage/RelationGraphPage';
jest.mock('@client/src/pages/RelationGraphPage/SuiteMatterGraphPage', () => ({__esModule:true, default: () => 'matter consumer'}));
jest.mock('@client/src/pages/RelationGraphPage/SuiteDocumentGraphPage', () => ({__esModule:true, default: () => 'document consumer'}));
jest.mock('@client/src/pages/RelationGraphPage/SuiteLibraryGraphPage', () => ({__esModule:true, default: () => 'library consumer'}), {virtual:true});
jest.mock('@client/src/pages/RelationGraphPage/relation-graph.css', () => ({}));
jest.mock('@client/src/pages/RelationGraphPage/RelationGraphCanvas', () => ({__esModule:true, default: () => null}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession: () => ({sessionGeneration:1, authenticationRequired:false})}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({logger:{error:jest.fn()}}));
jest.mock('@client/src/components/ui/button', () => ({Button: () => null}));
jest.mock('@client/src/components/ui/button-group', () => ({ButtonGroup: () => null}));
jest.mock('@client/src/api/canonical-host', () => ({}));
jest.mock('@client/src/api/engineering-matter', () => ({getEngineeringMatterDirectory:jest.fn()}));
function render(search: string) { return renderToStaticMarkup(createElement(StaticRouter, {location:`/graph?${search}`}, createElement(RelationGraphPage))); }
it('dispatches the actual explicit library route to macro without default matter lookup', () => {
  expect(render('scope=library')).toBe('library consumer');
  expect(render('scope=library&level=families&groupBy=ata&clusterValue=20')).toBe('library consumer');
});
it('retains the exact selected matter and document consumers', () => {
  expect(render('matterId=matter-exact&workRef=historical')).toBe('matter consumer');
  expect(render('scope=document&documentVersionId=old-r3')).toBe('document consumer');
});
it.each(['scope=library&matterId=m','scope=library&documentVersionId=v','scope=library&workRef=old',
  'scope=library&scope=document','scope=library&level=versions&familyId=f&ata=20',
  'scope=library&level=families&groupBy=ata','scope=library&level=clusters&clusterValue=20'])('rejects conflicting macro identity before any consumer: %s', search => {
  expect(render(search)).toContain('role="alert"');
});
