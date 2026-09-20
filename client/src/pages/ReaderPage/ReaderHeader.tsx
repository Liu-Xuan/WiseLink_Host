import { FileText, Clock, ExternalLink } from 'lucide-react';
import type { ReaderDocument } from './index';

interface ReaderHeaderProps {
  document: ReaderDocument;
  onBack: () => void;
  onOpenRevision: () => void;
}

export default function ReaderHeader({
  document,
  onBack,
  onOpenRevision,
}: ReaderHeaderProps) {
  return (
    <div className="reader-header">
      <div className="reader-header-content">
        <div className="reader-title-section">
          <h1>{document.title}</h1>
          <div className="reader-meta">
            <span className="badge">{document.version}</span>
            <span className="badge">
              {document.current ? '当前库内版本' : '历史版本'}
            </span>
            <span className="meta-text">
              {document.type} · 原文修订 {document.binding.parseRevision}
            </span>
            {document.chinesePartial && (
              <span className="badge badge-amber">中文部分可读</span>
            )}
          </div>
        </div>

        <div className="reader-actions">
          <button
            className="btn btn-secondary"
            onClick={onBack}
            aria-label="返回"
          >
            返回
          </button>

          <button
            className="btn btn-secondary"
            onClick={onOpenRevision}
            title="版本比较"
          >
            <Clock size={16} />
            版本比较
          </button>

          {document.pdf && (
            <a
              className="btn btn-secondary"
              href={document.pdf.file}
              download={`${document.familyId}-${document.version}.pdf`}
              title="下载 PDF 文件"
            >
              <ExternalLink size={16} />
              下载 PDF
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
