import { useState } from 'react';
import type { CanonicalLibraryDocumentSummary, CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@client/src/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';
import { TdmsDocumentSourceReading } from '@client/src/features/tdms-source/TdmsDocumentSourceReading';
import { DocumentOriginalInlinePreview } from './DocumentOriginalPreview';
import { documentIdentityPresentation, libraryPublicationPresentation } from './library-document-presentation';

/** Browsing a source does not require a parse, an assessment or an adopted engineering decision. */
export function LibraryDocumentSourceDialog({ document, version, onSelectVersion }: {
  document: CanonicalLibraryDocumentSummary;
  version: CanonicalLibraryDocumentVersionSummary;
  onSelectVersion: (documentVersionId: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const identity = documentIdentityPresentation({ documentCode: document.documentCode,
    extractedMetadata: version.extractedMetadata });
  const publication = libraryPublicationPresentation(version);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>直接阅读 PDF 与 TDMS 来源意见</Button>
    <DialogContent className="library-document-source-dialog max-w-[96vw]">
      <DialogHeader>
        <DialogTitle>{identity.documentNumber} · 业务版次 {version.businessRevision || '未标注'}</DialogTitle>
        <DialogDescription>{identity.hasDocumentTitle ? identity.documentTitle : '文档标题待核'}
          {' · '}{version.selectedVersionIsCurrent ? '当前登记版本' : '所选历史版本'}</DialogDescription>
      </DialogHeader>
      <div className="library-source-version-picker">
        <label htmlFor="library-source-dialog-version">切换业务版次</label>
        <Select value={version.documentVersionId} onValueChange={onSelectVersion}>
          <SelectTrigger id="library-source-dialog-version"><SelectValue /></SelectTrigger>
          <SelectContent>{document.versions.map(item => <SelectItem key={item.documentVersionId} value={item.documentVersionId}>
            {item.businessRevision || '版次未标注'} · {item.selectedVersionIsCurrent ? '当前登记' : '历史'}
          </SelectItem>)}</SelectContent>
        </Select>
      </div>
      {open ? <div className="library-document-source-columns" data-document-version-id={version.documentVersionId}>
        <div className="library-document-source-pdf">
          <DocumentOriginalInlinePreview key={version.documentVersionId} documentVersionId={version.documentVersionId} autoLoad />
        </div>
        <div className="library-document-source-info">
          <dl className="suite-library-key-facts">
            <div><dt>文档类型</dt><dd>{document.normalizedFamily || '待分类'}</dd></div>
            <div><dt>ATA</dt><dd>{publication.ata}</dd></div>
            <div><dt>系统解析</dt><dd>{version.parsing?.status === 'PUBLISHED' ? '已发布解析'
              : version.parsing?.status === 'FAILED' ? '解析失败'
                : version.parsing ? '解析处理中' : '尚无解析记录'}</dd></div>
            <div><dt>系统评估</dt><dd>{version.workItemCount ? `已有 ${version.workItemCount} 个评估任务` : '尚无系统评估任务'}</dd></div>
          </dl>
          <TdmsDocumentSourceReading key={version.documentVersionId} documentVersionId={version.documentVersionId} />
        </div>
      </div> : null}
    </DialogContent>
  </Dialog>;
}
