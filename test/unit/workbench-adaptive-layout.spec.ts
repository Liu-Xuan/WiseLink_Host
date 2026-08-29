import { resolveWorkbenchAdaptiveLayout } from '../../client/src/features/workbench/workbench-layout';

const base = {
  navWidth: 304,
  evidenceWidth: 320,
  evidenceOpen: true,
  isCompact: false,
  navigatorAvailable: true,
  evidenceAvailable: true,
};

describe('workbench adaptive layout', () => {
  it('temporarily collapses the navigator when a 1440 Host shell leaves a constrained body', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1328 }),
    ).toEqual({
      autoCollapseNavigator: true,
      useEvidenceOverlay: false,
    });
  });

  it('keeps all three columns when the actual body is wide enough', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1500 }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
    });
  });

  it('uses an evidence overlay only after the center content cannot stay usable', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1100 }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: true,
    });
  });

  it('leaves compact single-panel navigation to the mobile drawer state', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({
        ...base,
        bodyWidth: 390,
        isCompact: true,
      }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
    });
  });
});
