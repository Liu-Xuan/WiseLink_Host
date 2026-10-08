import { lazy, Suspense, type ReactNode } from 'react';
import { TDMS_SOURCE_UI_ENABLED } from '@client/src/features/tdms-source/tdms-source-enabled';
import type { SuiteMatterGraphRead } from './suite-matter-graph';

export interface SuiteTdmsSourceLayerProps {
  read: SuiteMatterGraphRead;
  matterId: string;
  workRef: string;
  session: number;
  allowCurrentSources: boolean;
  openDocument: (documentVersionId: string) => void;
  onAccessRejected: () => Promise<void>;
  children: (read: SuiteMatterGraphRead, openSource: (sourceRevisionRef: string) => void) => ReactNode;
}
const closedSource = () => undefined;
const EnabledLayer = lazy(() => import('./EnabledSuiteTdmsSourceLayer'));

/** Closed real consumers never evaluate native hook, identity, projection or reader modules. */
export default function SuiteTdmsSourceLayer(props: SuiteTdmsSourceLayerProps) {
  if (!TDMS_SOURCE_UI_ENABLED) return <>{props.children(props.read, closedSource)}</>;
  return <Suspense fallback={<>{props.children(props.read, closedSource)}</>}>
    <EnabledLayer key={JSON.stringify([props.session, props.matterId, props.workRef])} {...props} />
  </Suspense>;
}
