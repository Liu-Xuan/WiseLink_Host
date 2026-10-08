import { TDMS_SOURCE_UI_ENABLED } from './tdms-source-enabled';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import type { TdmsGraphSourceReadingProps } from './TdmsGraphSourceReading';

const TdmsGraphSourceReading = lazy(() => import('./TdmsGraphSourceReading'));

/** Opening this layer is explicit; it never performs a background source or body scan. */
function EnabledTdmsGraphSourceEntry(
  props: TdmsGraphSourceReadingProps,
) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const scope = JSON.stringify([
    sessionGeneration,
    props.matterId,
    props.documentVersionId,
    props.savedWork,
  ]);
  const [openedScope, setOpenedScope] = useState<string | null>(null);
  const opened = openedScope === scope && !authenticationRequired;
  useEffect(() => {
    props.onLayerChange?.(opened);
  }, [opened, props.onLayerChange]);
  return (
    <section className="rg-panel" aria-label="TDMS 原生来源图谱入口">
      <h2 className="rg-panel-title">TDMS 文件、评估与工程文件关系</h2>
      <p>按需读取已获准的准确来源关系；概览不复制正文，阅读不调用模型。</p>
      <button
        type="button"
        disabled={authenticationRequired}
        onClick={() => setOpenedScope(opened ? null : scope)}
        aria-expanded={opened}
      >
        {opened ? '返回原图谱' : '读取 TDMS 来源关系'}
      </button>
      {opened ? (
        <Suspense fallback={<p role="status">正在打开来源读取区…</p>}>
          <TdmsGraphSourceReading {...props} enabled={true} key={scope} />
        </Suspense>
      ) : null}
    </section>
  );
}

/** No runtime activation: disabled entry does not mount hooks, controls or lazy readers. */
export default function TdmsGraphSourceEntry(props: TdmsGraphSourceReadingProps) {
  if (!TDMS_SOURCE_UI_ENABLED) return null;
  return <EnabledTdmsGraphSourceEntry {...props} />;
}
