import { useMemo } from 'react';
import AssessmentReadingBrief from '@client/src/features/matter/AssessmentReadingBrief';
import { exampleReading } from './example-assessment';
export default function AtlasExampleAssessment({
  revised,
  selected,
  onSelect,
  depth = 'full',
}: {
  revised: boolean;
  selected: string;
  onSelect: (claim: string) => void;
  depth?: 'list' | 'full';
}) {
  const result = useMemo(() => exampleReading(revised), [revised]);
  const claim = result.content.claims.find((c) => c.claimId === selected);
  return (
    <>
      <AssessmentReadingBrief
        result={result}
        depth={depth}
        onOpenClaim={(selection) => onSelect(selection.claimId)}
      />
      {claim ? (
        <article className="atlas-evidence-reading">
          <span className="atlas-eyebrow">
            预置示例依据 · {result.resultRef} / {result.resultRevision}
          </span>
          <h3>{claim.text}</h3>
          {claim.premises.length ? (
            claim.premises.map((p) => {
              const evidence = result.evidence.find(
                (e) => e.evidenceRef === p.evidenceRef,
              );
              return (
                <section key={p.evidenceRef}>
                  <strong>{evidence?.title}</strong>
                  <p>{evidence?.excerpt}</p>
                  <p>
                    {p.explanation} {p.limitation}
                  </p>
                  <small>
                    {evidence?.versionLabel} ·{' '}
                    {evidence?.kind === 'DOCUMENT_PASSAGE'
                      ? evidence.locator
                      : '工程师提供的示例记录'}
                  </small>
                </section>
              );
            })
          ) : (
            <p>当前没有取得支持此状态判断的证据，保留未知。</p>
          )}
          <button onClick={() => onSelect('')}>收起依据</button>
        </article>
      ) : null}
    </>
  );
}
