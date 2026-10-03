import type { AtaDirectoryNode } from './library-ata-directory';

/** The directory seeds a scope and candidate version window, never selected members. */
export function libraryAtaSummaryParams(node: AtaDirectoryNode, path: string[]): URLSearchParams {
  const fleet = path.find(value => value.startsWith('fleet:'))?.slice(6) ?? '';
  const model = path.find(value => value.startsWith('model:'))?.slice(6) ?? '';
  const fleetFamilyId = fleet.startsWith('__') ? '' : fleet;
  const params = new URLSearchParams({ kind: 'ATA4', fleetFamilyId, ata2: node.key.slice(0, 2), ata4: node.key,
    title: `${fleetFamilyId || '机型待选'} / ATA ${node.key} 选定资料概述` });
  if (model && !model.startsWith('__')) params.set('fleetModelId', model);
  [...new Set(node.items.map(item => item.version.documentVersionId))].forEach(id => params.append('documentVersionId', id));
  return params;
}
