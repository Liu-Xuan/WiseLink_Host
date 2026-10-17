import type { ReactNode } from 'react';
import { LibrarySourceDirectory, type LibraryDirectoryNavigationProps } from './LibrarySourceDirectory';
import { useLibraryDirectoryReading } from './useLibraryDirectoryReading';

interface LibrarySourceDirectoryPaneProps extends LibraryDirectoryNavigationProps {
  before?: ReactNode;
  after?: ReactNode;
}

/** Shared sidebar ownership survives document/matter switches and serializes reader returns. */
export function LibrarySourceDirectoryPane({ before, after, ...props }: LibrarySourceDirectoryPaneProps) {
  const scope: string = JSON.stringify([props.search, props.filters.normalizedFamily ?? '',
    props.filters.fleetFamily ?? '', props.filters.fleetModel ?? '',
    props.filters.aircraftModel ?? '', props.filters.aircraftModels ?? '']);
  const { navigation, ...scroll } = useLibraryDirectoryReading(scope, props.sessionGeneration,
    props.refreshRevision, props.authenticationRequired);
  return <aside {...scroll} className="suite-library-folder" aria-label="资料分组">
    {before}
    <LibrarySourceDirectory {...props} navigation={navigation} />
    {after}
  </aside>;
}
