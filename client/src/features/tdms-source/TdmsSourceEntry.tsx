import { lazy, Suspense, type ComponentProps } from 'react';
import type TdmsSourceReading from './TdmsSourceReading';
import { TDMS_SOURCE_UI_ENABLED } from './tdms-source-enabled';

const Reader = lazy(() => import('./TdmsSourceReading'));

/** Immutable off switch also prevents importing reader code/styles at real consumers. */
export default function TdmsSourceEntry(props: ComponentProps<typeof TdmsSourceReading>) {
  if (!TDMS_SOURCE_UI_ENABLED) return null;
  return <Suspense fallback={<p role="status">正在打开准确来源读取区…</p>}>
    <Reader {...props} enabled={TDMS_SOURCE_UI_ENABLED && props.enabled !== false} />
  </Suspense>;
}
