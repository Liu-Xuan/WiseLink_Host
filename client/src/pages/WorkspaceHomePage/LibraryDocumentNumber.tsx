import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';

/** Copy only the actual document number, without a title or internal-ID fallback. */
export function LibraryDocumentNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const number = value.trim();
  return <span className="library-document-number">
    <b>{number || '未取得'}</b>
    {number ? <Button type="button" variant="ghost" size="icon" className="library-copy-number"
      aria-label={`复制文档编号 ${number}`} title={copied ? '已复制' : '复制文档编号'}
      onClick={async event => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(number); setCopied(true); setError(''); }
        catch { setError('复制失败，可选中编号复制。'); }
      }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button> : null}
    {error ? <small role="alert">{error}</small> : null}
  </span>;
}
