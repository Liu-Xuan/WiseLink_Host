import { sameScope } from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  tdmsError,
  type TdmsCapture,
  type TdmsRecordHead,
  type TdmsRelationHead,
  type TdmsRepository,
  type TdmsStoredAssertion,
  type TdmsStoredReceipt,
  type TdmsStoredRevision,
  type TdmsTransaction,
  type TdmsSourceScope,
} from '../../../server/modules/tdms-source/tdms-source.types';
interface State {
  captures: TdmsCapture[];
  heads: TdmsRecordHead[];
  revisions: TdmsStoredRevision[];
  relationHeads: TdmsRelationHead[];
  assertions: TdmsStoredAssertion[];
  receipts: TdmsStoredReceipt[];
}
/** Transaction rollback double, explicitly NOT physical PG or RLS evidence. */
export class MemoryTdmsRepository implements TdmsRepository {
  state: State = {
    captures: [],
    heads: [],
    revisions: [],
    relationHeads: [],
    assertions: [],
    receipts: [],
  };
  beforeReceipt?: () => void;
  beforeCommit?: () => void;
  async transaction<T>(fn: (tx: TdmsTransaction) => Promise<T>): Promise<T> {
    const state = structuredClone(this.state);
    const tx: TdmsTransaction = {
      capture: async (s, id) =>
        state.captures.find(
          (x) => sameScope(x.scope, s) && x.packageId === id,
        ) ?? null,
      recordHead: async (s, kind, id) =>
        state.heads.find(
          (x) =>
            sameScope(x.scope, s) &&
            x.recordKind === kind &&
            x.sourceRecordId === id,
        ) ?? null,
      revision: async (t, ref) =>
        structuredClone(
          state.revisions.find(
            (x) => x.scope.tenantId === t && x.record.sourceRevisionRef === ref,
          ) ?? null,
        ),
      catalogue: async (s) =>
        state.heads
          .filter((h) => sameScope(h.scope, s))
          .map((h) =>
            structuredClone(
              state.revisions.find(
                (x) => x.record.sourceRevisionRef === h.sourceRevisionRef,
              )!,
            ),
          ),
      history: async (s, recordRef) =>
        structuredClone(
          state.revisions
            .filter(
              (x) => sameScope(x.scope, s) && x.record.recordRef === recordRef,
            )
            .sort((a, b) =>
              a.record.sourceRevisionRef.localeCompare(
                b.record.sourceRevisionRef,
              ),
            ),
        ),
      relationHead: async (s, id) =>
        state.relationHeads.find(
          (x) => sameScope(x.scope, s) && x.sourceRelationId === id,
        ) ?? null,
      relations: async (t, ref) =>
        structuredClone(
          state.assertions.filter(
            (x) =>
              x.scope.tenantId === t &&
              [x.assertion.from, x.assertion.to].some(
                (e) =>
                  e.kind === 'NATIVE_RECORD_REVISION' &&
                  e.sourceRevisionRef === ref,
              ),
          ),
        ),
      saveRevision: async (h, expected, r) => {
        const i = state.heads.findIndex(
          (x) =>
            sameScope(x.scope, h.scope) &&
            x.recordKind === h.recordKind &&
            x.sourceRecordId === h.sourceRecordId,
        );
        if ((i < 0 ? null : state.heads[i]!.sourceRevisionRef) !== expected)
          throw tdmsError('TDMS_RECORD_HEAD_CAS_CONFLICT', 409);
        state.revisions.push(structuredClone(r));
        if (r.record.selectedHead) {
          if (i < 0) state.heads.push(structuredClone(h));
          else state.heads[i] = structuredClone(h);
        }
      },
      saveAssertion: async (h, expected, a) => {
        const i = state.relationHeads.findIndex(
          (x) =>
            sameScope(x.scope, h.scope) &&
            x.sourceRelationId === h.sourceRelationId,
        );
        if ((i < 0 ? null : state.relationHeads[i]!.assertionRef) !== expected)
          throw tdmsError('TDMS_RELATION_HEAD_CAS_CONFLICT', 409);
        state.assertions.push(structuredClone(a));
        if (a.assertion.selectedHead) {
          if (i < 0) state.relationHeads.push(structuredClone(h));
          else state.relationHeads[i] = structuredClone(h);
        }
      },
      saveCapture: async (c) => {
        if (
          state.captures.some(
            (x) => sameScope(x.scope, c.scope) && x.packageId === c.packageId,
          )
        )
          throw tdmsError('TDMS_PACKAGE_IDEMPOTENCY_CONFLICT', 409);
        state.captures.push(structuredClone(c));
      },
      saveReceipt: async (r) => {
        this.beforeReceipt?.();
        state.receipts.push(structuredClone(r));
      },
    };
    const result = await fn(tx);
    this.beforeCommit?.();
    this.state = state;
    return result;
  }
}
export const nativeScope: TdmsSourceScope = {
  tenantId: 'tenant-a',
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'narrow',
};
