import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Children, isValidElement, createElement, type ReactElement, type ReactNode } from 'react';
import { LibraryClassificationControls } from '../../client/src/pages/WorkspaceHomePage/LibraryClassificationControls';
import { LibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/LibraryHierarchy';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1, subscribeCanonicalHostClientSession: () => () => undefined }));

interface ActionProps { children?: ReactNode; onClick?: () => void; 'aria-label'?: string }
function actions(node: ReactNode): ReactElement<ActionProps>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<ActionProps>(child)) return [];
    return [...(child.type === 'button' ? [child] : []), ...actions(child.props.children)];
  });
}

describe('joint facet controls and directory path actions', () => {
  const filters = { normalizedFamily: 'SB', ata: '34', aircraftModel: '737' };
  it('hides inactive order actions for the fixed aircraft / ATA view while preserving real filters', () => {
    const buttons = actions(LibraryClassificationControls({ grouping: 'aircraft', showGrouping: false,
      onGroupingChange: jest.fn(), filters, onFilterChange: jest.fn(), disabled: false,
      counts: { familyCounts: { SB: 1 }, ataCounts: { '34': 1 } } }));
    expect(buttons.some(button => Children.toArray(button.props.children).join('').includes('优先'))).toBe(false);
    expect(buttons.some(button => Children.toArray(button.props.children)[0] === 'SB')).toBe(true);
  });
  it('keeps ATA order fixed and edits one category without dropping the other filters', () => {
    const onGroupingChange = jest.fn();
    const onFilterChange = jest.fn();
    const buttons = actions(LibraryClassificationControls({ grouping: 'category', onGroupingChange, filters, onFilterChange, disabled: false,
      counts: { familyCounts: { SB: 3, SL: 2 }, ataCounts: { '34': 3 }, aircraftModelCounts: { '737': 3 } } }));
    const order = buttons.find((button) => Children.toArray(button.props.children).join('') === 'ATA 编号优先');
    expect(order).toBeUndefined();
    expect(onGroupingChange).not.toHaveBeenCalled();
    expect(onFilterChange).not.toHaveBeenCalled();
    const sl = buttons.find((button) => Children.toArray(button.props.children)[0] === 'SL');
    sl?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...filters, normalizedFamily: 'SL' });
    const clear = buttons.find((button) => button.props.children === '清除筛选');
    clear?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({});
  });

  it('uses ATA navigation for legacy grouping URLs without discarding historical document links', () => {
    const document = libraryFamily('one');
    document.versions[0].extractedMetadata = libraryMetadata('34', '737');
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/library?catalogView=tree&grouping=aircraft' },
      createElement(LibraryHierarchy, { documents: [document], selectedId: '', hasMore: true,
        grouping: 'aircraft', filters: {}, onSelect: jest.fn() })));
    expect(html).toContain('ATA34 导航');
    expect(html).toContain('/document-versions/DV-one-2');
    expect(html).toContain('/document-versions/DV-one-1');
    expect(html).not.toContain('父机型');
    expect(html).not.toContain('筛选路径');
  });
});
