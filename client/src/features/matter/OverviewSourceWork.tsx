import { Link } from 'react-router-dom';
import type { EngineeringMatterOverviewSourceWork } from '@shared/matter-working.interface';
import { matterWorkRoute } from './matter-navigation';

/** The last explicit overview SAVE, not approval, run status, or a guessed latest work. */
export default function OverviewSourceWork({
  matterId,
  source,
  overviewStatus,
}: {
  matterId: string;
  source?: EngineeringMatterOverviewSourceWork | null;
  overviewStatus?: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
}) {
  if (overviewStatus === 'NOT_AVAILABLE') return null;
  return (
    <p className="text-sm leading-7" role="note">
      {source ? (
        <>
          当前保留综合最后明确保存于{' '}
          <Link
            className="underline"
            to={matterWorkRoute(matterId, source.workRef)}
          >
            工作修订 {source.workingRevision}
          </Link>
          。 此记录不代表批准或生成运行状态。
        </>
      ) : (
        '当前保留综合的准确保存工作尚未核实。'
      )}
    </p>
  );
}
