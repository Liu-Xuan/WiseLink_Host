import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import RelationGraphPage from '@client/src/pages/RelationGraphPage/RelationGraphPage';

jest.mock('@client/src/pages/RelationGraphPage/SuiteMatterGraphPage', () => ({ __esModule: true, default: () => 'matter consumer' }));
jest.mock('@client/src/pages/RelationGraphPage/SuiteDocumentGraphPage', () => ({ __esModule: true, default: (props: {documentVersionId: string; readerWorkItemId?: string}) => `document consumer:${props.documentVersionId}:${props.readerWorkItemId ?? ''}` }));
jest.mock('@client/src/pages/RelationGraphPage/relation-graph.css', () => ({}));
jest.mock('@client/src/pages/RelationGraphPage/RelationGraphCanvas', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession: () => ({sessionGeneration: 1, authenticationRequired: false})}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({logger: {error: jest.fn()}}));
jest.mock('@client/src/components/ui/button-group', () => ({ButtonGroup: () => null}));
jest.mock('@client/src/components/ui/button', () => ({Button: () => null}));
jest.mock('@client/src/pages/RelationGraphPage/SuiteLibraryGraphPage', () => ({__esModule: true, default: () => 'library consumer'}));
jest.mock('@client/src/api/canonical-host', () => ({}));
jest.mock('@client/src/api/engineering-matter', () => ({getEngineeringMatterDirectory: jest.fn()}));
function render(search: string) { return renderToStaticMarkup(createElement(StaticRouter, {location: `/graph?${search}`}, createElement(RelationGraphPage))); }

it('dispatches explicit selected document to its independent consumer without defaulting a matter or legacy activity', () => {
  expect(render('scope=document&documentVersionId=old-r3&readerWorkItemId=wi-r3')).toBe('document consumer:old-r3:wi-r3');
  expect(render('scope=document&documentVersionId=native-dv')).toBe('document consumer:native-dv:');
});
it.each([
  'scope=document', 'scope=document&scope=document&documentVersionId=dv',
  'scope=document&documentVersionId=dv&matterId=m', 'scope=document&documentVersionId=dv&workItemId=w',
  'scope=document&documentVersionId=dv&readerWorkItemId=', 'scope=document&documentVersionId=dv&workRef=historical',
  'scope=document&documentVersionId=dv&parseRunId=p&candidateRevision=1',
  'readerWorkItemId=w', 'scope=unknown&documentVersionId=dv',
])('rejects ambiguous scope before any read: %s', search => { expect(render(search)).toContain('role="alert"'); });
