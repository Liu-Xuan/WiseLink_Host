import { Languages } from 'lucide-react';
import type { CanonicalReaderTranslationProjection } from '@shared/api.interface';
import type { SemanticReadingMode } from './semantic-reading';

export function LegacyBilingualReader({
  translation,
  mode = 'bilingual',
  onSourceRefSelect,
}: {
  translation: CanonicalReaderTranslationProjection;
  mode?: SemanticReadingMode;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
}) {
  if (
    translation.status !== 'BILINGUAL_READING_AID_AVAILABLE' ||
    !translation.units?.length
  ) {
    return (
      <div className="parse-reader-missing-state">
        <Languages aria-hidden="true" />
        <div>
          <strong>译文暂不可用</strong>
          <p>原文仍可阅读；生成并完成检查后，译文将在这里显示。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="wl-bilingual-reader">
      <p className="wl-bilingual-scope">历史译文候选 · 按原有版本读取</p>
      <div className="wl-semantic-document">
        {translation.units.map((unit) => (
          <article className="wl-bilingual-block" key={unit.unitId}>
            <div
              className={
                mode === 'bilingual'
                  ? 'wl-bilingual-columns'
                  : 'wl-semantic-single'
              }
            >
              {mode !== 'translation' ? (
                <div lang="en">{unit.sourceText}</div>
              ) : null}
              {mode !== 'original' ? (
                <div lang="zh-CN">{unit.translatedText}</div>
              ) : null}
            </div>
            <footer>
              {unit.sourceRefIds.map((ref, index) => (
                <button
                  type="button"
                  key={ref}
                  onClick={() => onSourceRefSelect(unit.unitId, ref)}
                >
                  来源 {index + 1}
                </button>
              ))}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
