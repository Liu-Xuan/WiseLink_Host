import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { REVIEWED_SB_HISTORY_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-history-purpose';
import { REVIEWED_SB_NOTEBOOK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import {
  sbProof,
  sealSb,
  withSbStructureEvidence,
} from './tdms-reviewed-sb-0-2-73.fixture';

// Reuses the existing synthetic PARTIAL DTO, never a real or complete capture.
// These two pathname literals are the complete @9 reviewed route set.
export const SB_TIMELINE_PATHS = [
  '/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp',
  '/Windchill/netmarkets/jsp/history/timelineHistory-iframe.jsp',
] as const;
export const SB_TIMELINE_TAB_IDS = [
  REVIEWED_SB_HISTORY_MODEL.panels[0].tabId,
  REVIEWED_SB_NOTEBOOK_MODEL.panels[0].tabId,
] as const;
export type SbTimelineEnvelope = ReturnType<typeof withSbStructureEvidence>;
export type SbTimelineRead = ReturnType<typeof sbProof>['reads'][number];
export interface SbTimelineEmbedded {
  id: string;
  rawSrc: string;
  readyState: string;
  bodyState: string;
}
export interface SbTimelineFrame {
  embeddedReferences: SbTimelineEmbedded[];
}
export interface SbTimelineTab {
  tabId: string;
  purposeEvidence: {
    ownerSourceRecordId: string;
    sourceVersion: { rawRevision: string; rawIteration: string };
    sourceModifiedRaw: string;
    ownStateRaw: string;
    sourceContext: { principalDisplayName: string };
    bodyState: string;
    settledReads: number;
    before: SbTimelineFrame;
    after: SbTimelineFrame;
  };
}

export function timelineTab(
  read: SbTimelineRead,
  tabId: string,
): SbTimelineTab {
  const tab: SbTimelineTab | undefined = read.tabs.find(
    (entry: SbTimelineTab) => entry.tabId === tabId,
  );
  if (!tab) throw new Error('SYNTHETIC_TIMELINE_TAB_MISSING');
  return tab;
}

export function setTimelinePath(
  env: SbTimelineEnvelope,
  pathname: string,
  readIndex?: number,
  tabId?: string,
): void {
  const reads: SbTimelineRead[] = sbProof(env).reads;
  for (const [index, read] of reads.entries()) {
    if (readIndex !== undefined && readIndex !== index) continue;
    for (const id of tabId ? [tabId] : SB_TIMELINE_TAB_IDS) {
      const tab = timelineTab(read, id);
      for (const frame of [
        tab.purposeEvidence.before,
        tab.purposeEvidence.after,
      ]) {
        const embedded = frame.embeddedReferences[0]!;
        embedded.rawSrc =
          'http://tdms.airchina.com' +
          pathname +
          '?oid=' +
          read.owner.sourceRecordId;
      }
    }
  }
}

export function syntheticTimelineCapture(pathname: string): SbTimelineEnvelope {
  const env = withSbStructureEvidence();
  setTimelinePath(env, pathname);
  return sealSb(env);
}

/** Preserve the deliberately invalid raw proof; only reconcile its raw digest. */
export function sealTimelineRawDigest(
  env: SbTimelineEnvelope,
): SbTimelineEnvelope {
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
