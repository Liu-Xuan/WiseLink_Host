import type { DocumentSemanticSection } from '@shared/document-semantic-map.interface';
import {
  revisionSemanticPin,
  revisionTextPin,
} from '@client/src/features/matter/reading-return';

/** One end of a revision comparison as carried by the page query. */
export interface RevisionSideQuery {
  documentVersionId: string;
  parseRunId: string | null;
  semanticRevision: number | null;
}

export type RevisionSideParse =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; side: RevisionSideQuery };

const SIDE_LABEL: Record<'before' | 'after', string> = {
  before: '基线端',
  after: '比较目标端',
};

function pinProblem(state: 'duplicate' | 'empty' | 'invalid'): string {
  if (state === 'duplicate') return '出现重复';
  if (state === 'empty') return '为空';
  return '不合法';
}

/** Read one end's identity from the page query; distinguishes absent, illegal and usable. */
export function parseRevisionSide(
  params: URLSearchParams,
  side: 'before' | 'after',
): RevisionSideParse {
  const label = SIDE_LABEL[side];
  const dv = revisionTextPin(params, side);
  if (dv.state === 'absent') return { status: 'absent' };
  if (dv.state !== 'ok')
    return {
      status: 'invalid',
      reason: `${label}版本标识${pinProblem(dv.state)}，无法进行改版比较。`,
    };
  const run = revisionTextPin(
    params,
    side === 'before' ? 'beforeParseRun' : 'afterParseRun',
  );
  if (run.state !== 'ok' && run.state !== 'absent')
    return {
      status: 'invalid',
      reason: `${label}解析版本${pinProblem(run.state)}，无法进行改版比较。`,
    };
  const semantic = revisionSemanticPin(
    params,
    side === 'before' ? 'beforeSemanticRevision' : 'afterSemanticRevision',
  );
  if (semantic.state !== 'ok' && semantic.state !== 'absent')
    return {
      status: 'invalid',
      reason: `${label}语义改版号${pinProblem(semantic.state)}，必须是正整数，无法进行改版比较。`,
    };
  return {
    status: 'ok',
    side: {
      documentVersionId: dv.value,
      parseRunId: run.state === 'ok' ? run.value : null,
      semanticRevision: semantic.state === 'ok' ? semantic.value : null,
    },
  };
}

export type RevisionEntryValidation =
  | { ok: false; reason: string }
  | { ok: true; before: RevisionSideQuery; after: RevisionSideQuery };

/**
 * Gate every revision entry before any discovery request. Only a fully legal pair of
 * distinct ends passes; explicit empty, illegal or duplicated pins stop the read here
 * instead of being swallowed and re-pointed at the latest versions.
 */
export function validateRevisionEntry(
  params: URLSearchParams,
): RevisionEntryValidation {
  const beforeParse = parseRevisionSide(params, 'before');
  if (beforeParse.status === 'invalid')
    return { ok: false, reason: beforeParse.reason };
  const afterParse = parseRevisionSide(params, 'after');
  if (afterParse.status === 'invalid')
    return { ok: false, reason: afterParse.reason };
  if (beforeParse.status === 'absent' || afterParse.status === 'absent')
    return { ok: false, reason: '缺少要比较的两个文档版本。' };
  const before = beforeParse.side;
  const after = afterParse.side;
  if (before.documentVersionId === after.documentVersionId)
    return { ok: false, reason: '基线端与比较目标端必须是两个不同的版本。' };
  if (before.parseRunId !== null && before.parseRunId === after.parseRunId)
    return { ok: false, reason: '基线端与比较目标端不能指向同一个解析版本。' };
  if (params.getAll('roleKey').length > 1)
    return { ok: false, reason: '内容角色出现重复，无法进行改版比较。' };
  return { ok: true, before, after };
}

/** A side is pinned only when both the parse run and the semantic revision are exact. */
export function sideIdentityComplete(side: RevisionSideQuery): boolean {
  return side.parseRunId !== null && side.semanticRevision !== null;
}

/**
 * Union of non-null content roles across the supplied section lists, in first-seen
 * order. Repeated and missing roles are retained so the existing NOT_COMPARED
 * reading results surface them instead of being filtered away.
 */
export function roleUnion(
  sectionLists: DocumentSemanticSection[][],
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const sections of sectionLists) {
    for (const section of sections) {
      if (section.roleKey && !seen.has(section.roleKey)) {
        seen.add(section.roleKey);
        order.push(section.roleKey);
      }
    }
  }
  return order;
}
