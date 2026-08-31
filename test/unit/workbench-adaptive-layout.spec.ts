import {
  resolveWorkbenchAdaptiveLayout,
  resolveWorkbenchContentLayout,
  resolveWorkbenchEvidenceVisibility,
  resolveWorkbenchMainInlineMinimum,
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
  mainInlineMinimum: resolveWorkbenchMainInlineMinimum('package'),
};

describe('workbench adaptive layout', () => {
  it.each([
    ['reader', 900, 'reader-single'],
    ['reader', 901, 'paired'],
    ['package', 940, 'package-single'],
    ['package', 941, 'paired'],
    ['assessment', 560, 'flow'],
  ])(
    'resolves %s at %dpx to %s before CSS chooses visible panes',
    (activeTab, mainInlineSize, expected) => {
      expect(resolveWorkbenchContentLayout(activeTab, mainInlineSize)).toBe(
        expected,
      );
    },
  );

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

  it('suppresses an empty rail before it can push a 1728 screenshot stage below paired width', () => {
    const layout = resolveWorkbenchAdaptiveLayout({
      ...base,
      bodyWidth: 1494,
      evidenceContentCount: 0,
    });
    const mainWidthAfterEmptyRailRelease = 1494 - base.navWidth - 6;

    expect(layout.suppressEmptyEvidence).toBe(true);
    expect(
      resolveWorkbenchContentLayout('package', mainWidthAfterEmptyRailRelease),
    ).toBe('paired');
  });

  it('keeps an active SourceRef and PDF paired by reclaiming the navigator width', () => {
    const layout = resolveWorkbenchAdaptiveLayout({
      ...base,
      bodyWidth: 1494,
      evidenceContentCount: 0,
      evidenceActive: true,
    });
    const mainWidthWithEvidence = 1494 - base.evidenceWidth - 6;

    expect(layout).toEqual({
      autoCollapseNavigator: true,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    });
    expect(
      resolveWorkbenchContentLayout('package', mainWidthWithEvidence),
    ).toBe('paired');
  });

  it('keeps all three columns when the actual body is wide enough', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1600 }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    });
  });

  it('uses the active workspace paired floor instead of the generic flow floor', () => {
    expect(resolveWorkbenchMainInlineMinimum('assessment')).toBe(820);
    expect(resolveWorkbenchMainInlineMinimum('reader')).toBe(901);
    expect(resolveWorkbenchMainInlineMinimum('package')).toBe(941);
  });

  it('uses an evidence overlay only after the center content cannot stay usable', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({ ...base, bodyWidth: 1100 }),
    ).toEqual({
      autoCollapseNavigator: true,
      useEvidenceOverlay: true,
      suppressEmptyEvidence: false,
    });
  });

  it('uses the same container policy between tablet and mobile breakpoints', () => {
    expect(
      resolveWorkbenchAdaptiveLayout({
        ...base,
        bodyWidth: 900,
        evidenceContentCount: 0,
      }),
    ).toEqual({
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: true,
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
    expect(resolveWorkbenchContentLayout('package', 390)).toBe(
      'package-single',
    );
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
