import type { FC } from 'react';

import type { ReviewMatterWorkingUpdateReceipt } from '@shared/api.interface';

interface MatterWorkingReceiptProps {
  receipt: ReviewMatterWorkingUpdateReceipt;
}

const MatterWorkingReceipt: FC<MatterWorkingReceiptProps> = ({ receipt }) => (
  <div
    className="continuous-review-receipt"
    role="status"
    data-working-revision={receipt.workingRevision}
    data-result-ref={receipt.resultRef ?? undefined}
    data-result-revision={receipt.resultRevision ?? undefined}
  >
    <div>
      <strong>
        {receipt.status === 'BASIS_CHANGED'
          ? '本轮依据已变化，候选未替换当前认识'
          : receipt.resultChanged
            ? '本轮事项认识已更新'
            : receipt.coverageChanged
              ? '核查范围已更新，认识保持不变'
              : receipt.status === 'APPLIED'
                ? '工作记录已保存，综合判断保持不变'
                : '本轮回复已保存，事项认识保持不变'}
      </strong>
      <span>
        Host 工作修订 {receipt.workingRevision}
        ；正式采用与成员文档评估状态不因此推进。
      </span>
      {receipt.reasonCode ? (
        <details>
          <summary>查看保存回执说明</summary>
          <p>{receipt.reasonCode}</p>
        </details>
      ) : null}
    </div>
  </div>
);

export default MatterWorkingReceipt;
