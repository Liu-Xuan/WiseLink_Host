import type {
  CanonicalReaderProjection,
  CanonicalStructuredContentSourceLocator,
} from '@shared/api.interface';

export interface WorkbenchEvidenceSummary {
  unitCount: number;
  referenceCount: number;
  contentCount: number;
}

/**
 * 以证据面板实际可呈现的内容为唯一口径，避免 ReactNode 存在就被误判为
 * “有证据”。结构化浏览器单独定位到一条来源时，面板仍有一个真实条目。
 */
export function summarizeWorkbenchEvidence(
  units: CanonicalReaderProjection['units'],
  activeStructuredLocator: CanonicalStructuredContentSourceLocator | null,
): WorkbenchEvidenceSummary {
  if (units.length === 0 && activeStructuredLocator !== null) {
    return {
      unitCount: 1,
      referenceCount: 1,
      contentCount: 2,
    };
  }

  const referenceCount: number = units.reduce(
    (sum: number, unit: CanonicalReaderProjection['units'][number]) =>
      sum + unit.sourceRefIds.length,
    0,
  );

  return {
    unitCount: units.length,
    referenceCount,
    contentCount: units.length + referenceCount,
  };
}
