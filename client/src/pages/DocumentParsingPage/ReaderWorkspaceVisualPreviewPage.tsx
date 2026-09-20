import { useState } from 'react';
import { DocumentSourceReadingWorkspace, type DocumentSourceReaderMode } from './DocumentSourceReadingWorkspace';
import { readerWorkspaceVisualFixture } from './reader-workspace-visual-fixture';
import './document-version-reading.css';

const original = readerWorkspaceVisualFixture();

export default function ReaderWorkspaceVisualPreviewPage() {
  const [mode, setMode] = useState<DocumentSourceReaderMode>('dual');
  return (
    <main className="document-version-reading" data-preview="isolated-reader-fixture">
      <DocumentSourceReadingWorkspace
        original={original}
        documentVersionId={original.binding.documentVersionId}
        mode={mode}
        onModeChange={setMode}
        returnRoute="/dev-preview/reader-workspace"
        returnLabel="返回样例"
        title="SB-A R02 · Reader 视觉样例"
        bilingualContent={<div className="reader-preview-translation"><h2>中文阅读样例</h2><p>确认安装构型后再执行程序，并保留限制条件与例外。</p><p>这是隔离样例，不代表已保存中文或工程结论。</p></div>}
        renderPdfPreview={(page) => <div className="reader-preview-pdf" aria-label={`构造原件第 ${page} 页`}><div>构造原件 · 第 {page} 页 / 4</div><div className="reader-preview-pdf-paper"><span>CONTROLLED SOURCE</span><strong>SB-A R02</strong><small>Preview page {page}</small><i /></div></div>}
      />
    </main>
  );
}
