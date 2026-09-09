import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { LibraryClassificationControls } from '../../client/src/pages/WorkspaceHomePage/LibraryClassificationControls';
import { LibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/LibraryHierarchy';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1 }));

interface ActionProps { children?: ReactNode; onClick?: () => void; 'aria-label'?: string }
function actions(node: ReactNode): ReactElement<ActionProps>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<ActionProps>(child)) return [];
    return [...(child.type === 'button' ? [child] : []), ...actions(child.props.children)];
  });
}

describe('joint facet controls and directory path actions', () => {
  const filters = { normalizedFamily: 'SB', ata: '34', aircraftModel: '737' };
  it('changes hierarchy independently and edits one facet without dropping the others', () => {
    const onGroupingChange = jest.fn();
    const onFilterChange = jest.fn();
    const buttons = actions(LibraryClassificationControls({ grouping: 'category', onGroupingChange, filters, onFilterChange, disabled: false,
      counts: { familyCounts: { SB: 3, SL: 2 }, ataCounts: { '34': 3 }, aircraftModelCounts: { '737': 3 } } }));
    const order = buttons.find((button) => Children.toArray(button.props.children).join('') === 'ATA 章节优先');
    expect(order).toBeDefined();
    order?.props.onClick?.();
    expect(onGroupingChange).toHaveBeenCalledWith('ata');
    expect(onFilterChange).not.toHaveBeenCalled();
    const sl = buttons.find((button) => Children.toArray(button.props.children)[0] === 'SL');
    sl?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...filters, normalizedFamily: 'SL' });
    const clear = buttons.find((button) => button.props.children === '清除三项筛选（保留搜索）');
    clear?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({});
  });

  it('applies a complete tree path as the same three server filters', () => {
    const document = libraryFamily('one');
    document.versions[0].extractedMetadata = libraryMetadata('34', '737');
    const onFilterChange = jest.fn();
    const buttons = actions(LibraryHierarchy({ documents: [document], selectedId: '', hasMore: true,
      grouping: 'aircraft', filters: {}, onSelect: jest.fn(), onFilterChange }));
    const leaf = buttons.find((button) => button.props['aria-label'] === '筛选路径 机型 737 / 类别 SB / ATA 34');
    expect(leaf).toBeDefined();
    leaf?.props.onClick?.();
    expect(onFilterChange).toHaveBeenCalledWith(filters);
  });
});
