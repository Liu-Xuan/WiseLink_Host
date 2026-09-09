import type {
  DocumentUploadIdentity,
  DocumentUploadResponse,
} from '@shared/api.interface';
import { DocumentOriginalPreview } from './DocumentOriginalPreview';

function UploadIdentity({
  identity,
}: {
  identity: DocumentUploadIdentity | null;
}) {
  return identity ? (
    <dl className="library-upload-identity">
      <div>
        <dt>文档</dt>
        <dd>
          {identity.documentNumber} · {identity.documentFamily}
        </dd>
      </div>
      <div>
        <dt>修订</dt>
        <dd>{identity.businessRevision || '未标注'}</dd>
      </div>
      <div>
        <dt>日期</dt>
        <dd>
          {identity.revisionDate || identity.sourceGeneratedDate || '未标注'}
        </dd>
      </div>
      {identity.issuerAuthority ? (
        <div>
          <dt>发布方</dt>
          <dd>{identity.issuerAuthority}</dd>
        </div>
      ) : null}
    </dl>
  ) : (
    <p>尚无可读文档身份回执。</p>
  );
}

export function DocumentUploadReceipt({
  receipt,
}: {
  receipt: DocumentUploadResponse;
}) {
  return (
    <section aria-label="文档登记回执" className="library-upload-receipt">
      <h4>
        {receipt.status === 'COMMITTED' ? '文档登记已确认' : '文档尚待处理'}
      </h4>
      <UploadIdentity identity={receipt.identity} />
      {receipt.status === 'COMMITTED' ? (
        <>
          <p role="status">
            {receipt.newDocumentVersionCreated
              ? '已登记新文档版本。'
              : '已复用已保存的文档版本。'}
            {receipt.currentnessChanged
              ? '当前版本已更新。'
              : '当前版本未改变。'}
            没有创建评估任务。
          </p>
          <DocumentOriginalPreview key={receipt.documentVersionId} documentVersionId={receipt.documentVersionId!}>
            打开已登记版本原件（新标签页）
          </DocumentOriginalPreview>
          <p className="library-classification-note">
            目录正在刷新；现有搜索或筛选可能隐藏此文档。
          </p>
        </>
      ) : (
        <>
          <p>{receipt.reason || '需要进一步核对，本次没有自动导入。'}</p>
          {receipt.historicalImport ? (
            <>
              <h4>当前版本</h4>
              {receipt.currentVersion?.access === 'READABLE' ? (
                <UploadIdentity identity={receipt.currentVersion.identity} />
              ) : (
                <p>当前版本详情不可见。</p>
              )}
              <p>
                待导入的是历史版本。确认后仅加入版本历史，不替换当前版本，不创建评估任务。
              </p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
