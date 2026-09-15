import { Link } from 'react-router-dom';
import type { EngineeringMatterReferenceWorkNotice } from '@shared/matter-working.interface';
import { matterReferencedWorkRoute } from './matter-navigation';
import OverviewCorrectionNotices from './OverviewCorrectionNotices';

export default function ReferenceWorkNotices({ notices }: { notices?: EngineeringMatterReferenceWorkNotice[] }) {
  return <>{notices?.filter(item => item.overviewStatus !== 'CURRENT' || item.correctionNotices.length || item.overviewCorrectionNotices?.length).map(item => (
    <div key={`${item.evidenceRef}:${item.sourceWork.workRef}`} role="note" className="my-3 space-y-2 text-sm leading-7">
      {item.overviewStatus !== 'CURRENT' ? <p>{item.overviewStatus === 'STALE'
        ? '所引工作的问题正文可读；其综合尚未覆盖当时的问题更新。'
        : '所引工作的问题正文可读；该版本尚未形成综合。'}</p> : null}
      {item.correctionNotices.map(notice => <p key={notice.attemptRef}>
        {notice.unchanged ? '所引工作已完成比较并保留原认识：' : notice.correctedWorkRef
          ? '所引旧工作已有后继更正，当前引用仍保留原版本：'
          : '所引工作已登记更正，尚未取得更正后的保存结果：'}{notice.reason}
        {notice.correctedWorkRef ? <Link className="ml-2 underline" to={matterReferencedWorkRoute({ ...item.sourceWork, workRef: notice.correctedWorkRef })}>核对后继更正</Link> : null}
      </p>)}
      <OverviewCorrectionNotices
        matterId={item.sourceWork.subjectId}
        notices={item.overviewCorrectionNotices}
      />
      <Link className="underline" to={matterReferencedWorkRoute(item.sourceWork)}>阅读所引版本及其条件</Link>
    </div>
  ))}</>;
}
