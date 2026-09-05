import { useState } from 'react';

interface ReaderRequestScope {
  workItemId: string;
  sessionGeneration: number;
  sourceRef: string;
}

/** Leaving Reader does not clear its selected source and trigger a full GET. */
export function useReaderRequestScope(
  workItemId: string,
  sessionGeneration: number,
  readerActive: boolean,
  requestedSourceRef: string,
): string {
  const [previous, setPrevious] = useState<ReaderRequestScope>({
    workItemId,
    sessionGeneration,
    sourceRef: readerActive ? requestedSourceRef : '',
  });
  const sameObject: boolean =
    previous.workItemId === workItemId &&
    previous.sessionGeneration === sessionGeneration;
  const sourceRef: string = readerActive
    ? requestedSourceRef
    : sameObject
      ? previous.sourceRef
      : '';
  if (!sameObject || sourceRef !== previous.sourceRef) {
    setPrevious({ workItemId, sessionGeneration, sourceRef });
  }
  return sourceRef;
}
