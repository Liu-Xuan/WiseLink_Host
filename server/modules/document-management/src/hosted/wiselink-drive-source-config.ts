import type { DriveFolderScanState } from './drive-folder-scanner';

export type WiseLinkDriveSourceKind = 'TECHNICAL_LIBRARY' | 'ENGINEERING_REPORTS' | 'SAFETY_REPORTS' | 'LE_REPORTS' | 'OPERATIONS' | 'CUSTOMER_TECHNICAL_MEETINGS';

export interface WiseLinkDriveSourceDefinition {
  sourceKey: string;
  kind: WiseLinkDriveSourceKind;
  folderToken: string;
  displayName: string;
  /** Source identity is independent of a user's session; the scanner must use an application/delegated identity. */
  identityRequirement: 'APPLICATION_OR_DELEGATED_DRIVE_READ';
  enabled: boolean;
}

/**
 * Initial source registry. The registry describes roots only; it is not a source
 * record or a permission grant. SB/AD and future roots are added as entries with
 * the same shape after their owner grants the Worker identity access.
 */
export const WISELINK_DRIVE_SOURCES: readonly WiseLinkDriveSourceDefinition[] = [
  source('technical-library', 'TECHNICAL_LIBRARY', 'Q6uSfDwcDlBrUldWvZccoje8nXf', 'TFU/ISI/FTD/FTAR'),
  source('engineering-reports', 'ENGINEERING_REPORTS', 'OHmYfqccglUUgAdydi7cglEDnue', '工程分析报告'),
  source('safety-reports', 'SAFETY_REPORTS', 'EuzIfHYKplv5rIduBHpco2Gpntb', '安全生产会工程部汇报材料'),
  source('le-reports', 'LE_REPORTS', 'YzIkfNMEQlDznVdRL6Xcj1XjnCh', 'LE例行报告汇总-综合 安全 可靠性'),
  source('operations', 'OPERATIONS', 'Oy1vfy8nslGZeUdBBkoczv0Fnxh', '运行信息'),
  source('customer-technical-meetings', 'CUSTOMER_TECHNICAL_MEETINGS', 'ILSYfrRG9lqjSTdfhVGcj7E0nEe', '与空客团队月度技术例会'),
];

export function driveSourceScanRoots(
  definitions: readonly WiseLinkDriveSourceDefinition[] = WISELINK_DRIVE_SOURCES,
): DriveFolderScanState[] {
  return definitions.filter(item => item.enabled).map(item => ({
    folderToken: item.folderToken,
    path: item.displayName,
    depth: 0,
  }));
}

function source(sourceKey: string, kind: WiseLinkDriveSourceKind, folderToken: string, displayName: string): WiseLinkDriveSourceDefinition {
  return { sourceKey, kind, folderToken, displayName, identityRequirement: 'APPLICATION_OR_DELEGATED_DRIVE_READ', enabled: true };
}
