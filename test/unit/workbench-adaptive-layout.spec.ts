import {
  resolveWorkbenchAdaptiveLayout,
  resolveWorkbenchEvidenceVisibility,
} from '../../client/src/features/workbench/workbench-layout';

const base = {
  navWidth: 304,
  evidenceWidth: 320,
  evidenceOpen: true,
  isCompact: false,
  navigatorAvailable: true,
  evidenceAvailable: true,
  evidenceContentCount: 2,
  evidenceActive: false,
  evidenceRequested: false,
};

describe('workbench adaptive layout', () => {
  it('temporarily collapses the navigator when a 1440 Host shell leaves a constrained body', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1328 }),
    ).toEqual({
      autoCollapseNavigator: true,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    });
  });

  it('keeps the navigator and suppresses an unrequested 0/0 evidence panel at a 1440 Host body width', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({
        ...base,
        bodyWidth: 1328,
        evidenceContentCount: 0,
      }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: true,
    });
  });

  it.each([
    ['a non-empty panel', { evidenceContentCount: 2 }],
    ['an active SourceRef', { evidenceContentCount: 0, evidenceActive: true }],
    [
      'an explicit user request',
      { evidenceContentCount: 0, evidenceRequested: true },
    ],
  ])(
    'keeps %s in the existing constrained desktop layout',
    (_label, evidenceState) => {
      expect(
        resolveWorkbenchAdaptiveLayout({
          ...base,
          ...evidenceState,
          bodyWidth: 1328,
        }),
      ).toEqual({
        autoCollapseNavigator: true,
        useEvidenceOverlay: false,
        suppressEmptyEvidence: false,
      });
    },
  );

  it('does not suppress an empty panel when the desktop can fit all three columns', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({
        ...base,
        bodyWidth: 1500,
        evidenceContentCount: 0,
      }).suppressEmptyEvidence,
    ).toBe(false);
  });

  it('keeps all three columns when the actual body is wide enough', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1500 }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    });
  });

  it('uses an evidence overlay only after the center content cannot stay usable', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1100 }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: true,
      suppressEmptyEvidence: false,
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
      suppressEmptyEvidence: false,
    });
  });

  it('keeps the 390 drawer controlled only by the mobile open state', () => {
    expect(
      resolveWorkbenchEvidenceVisibility({
        evidenceAvailable: true,
        isCompact: true,
        desktopOpen: true,
        mobileOpen: false,
        suppressEmptyEvidence: true,
      }),
    ).toBe(false);
    expect(
      resolveWorkbenchEvidenceVisibility({
        evidenceAvailable: true,
        isCompact: true,
        desktopOpen: false,
        mobileOpen: true,
        suppressEmptyEvidence: true,
      }),
    ).toBe(true);
  });
});
