import { driveSourceScanRoots, WISELINK_DRIVE_SOURCES } from './wiselink-drive-source-config';

describe('WiseLink Drive source registry', () => {
  it('keeps the six supplied roots as independent source identities', () => {
    expect(WISELINK_DRIVE_SOURCES).toHaveLength(6);
    expect(new Set(WISELINK_DRIVE_SOURCES.map(source => source.folderToken)).size).toBe(6);
    expect(WISELINK_DRIVE_SOURCES.every(source => source.identityRequirement === 'APPLICATION_OR_DELEGATED_DRIVE_READ')).toBe(true);
  });

  it('converts enabled roots into scanner states without borrowing user sessions', () => {
    expect(driveSourceScanRoots()).toEqual(expect.arrayContaining([
      expect.objectContaining({ folderToken: 'Q6uSfDwcDlBrUldWvZccoje8nXf', depth: 0 }),
      expect.objectContaining({ folderToken: 'Oy1vfy8nslGZeUdBBkoczv0Fnxh', depth: 0 }),
    ]));
  });
});
