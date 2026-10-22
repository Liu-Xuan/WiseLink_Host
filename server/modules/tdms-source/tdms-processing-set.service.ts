import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
  TdmsProcessingSetSaveReceipt,
} from '@shared/tdms-processing-set.interface';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import type { TdmsPublicActor, TdmsSourceScope } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { assertTdmsSourceActor, type TdmsSourceActor } from './tdms-runtime-delegation';
import { sameScope } from './tdms-source.authorization';
import { canonical, identifier, readContext } from './tdms-source.validation';
import { processingSet } from './tdms-processing-set.validation';
import { processingSetFacts } from './tdms-processing-set.references';
import type {
  TdmsProcessingSetAuthority,
  TdmsProcessingSetRepository,
} from './tdms-processing-set.types';

/** First-slice inactive Host service. No HTTP claims, collector, native READ, model
 * or source IO. An explicitly bound authority must verify current proofs/ACLs.
 * Frozen reads are ref-only and freshly authorized; they are not body receipts. */
export class TdmsProcessingSetService<Actor extends TdmsSourceActor = TdmsPublicActor> {
  constructor(
    private readonly repository: TdmsProcessingSetRepository,
    private readonly authority: TdmsProcessingSetAuthority<Actor>,
  ) {}
  async save(
    actor: Actor,
    value: unknown,
    expectedGeneration: number | null,
  ): Promise<TdmsProcessingSetSaveReceipt> {
    this.ready(actor);
    const set = processingSet(value);
    this.scope(actor, set.scope);
    await this.authority.assertScopeAccess({
      actor,
      scope: set.scope,
      action: 'RETAIN',
      context: {},
    });
    if (
      expectedGeneration !== null &&
      (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1)
    ) {
      throw tdmsError('TDMS_SET_GENERATION_INVALID');
    }
    const receipt = await this.repository.transaction(async (tx) => {
      const facts = await processingSetFacts(tx, set);
      const access = {
        actor,
        action: 'RETAIN' as const,
        context: {},
        set,
        ...facts,
      };
      await this.authority.assertAccess(access);
      const existing = await tx.processingSet(set.scope, set.setRevisionRef);
      const head = await tx.processingSetHead(
        set.scope,
        set.processingFamilyRef,
      );
      if (existing) {
        if (canonical(existing) !== canonical(set))
          throw tdmsError('TDMS_SET_REF_COLLISION', 409);
        await this.authority.assertAccess(access);
        return this.receipt(set, head, 'REPLAY');
      }
      if ((head?.generation ?? null) !== expectedGeneration)
        throw tdmsError('TDMS_PROCESSING_SET_CAS_CONFLICT', 409);
      let disposition: TdmsProcessingSetSaveReceipt['disposition'] =
        'UNRESOLVED';
      if (set.currentness === 'HISTORICAL') disposition = 'HISTORY_ONLY';
      else if (this.selectable(set)) {
        if (!head) disposition = 'SELECTED';
        else {
          const selected = await tx.processingSet(
            set.scope,
            head.selectedSetRevisionRef,
          );
          if (
            !selected ||
            selected.processingFamilyRef !== set.processingFamilyRef
          )
            throw tdmsError('TDMS_SET_HEAD_INVALID', 409);
          const order = await this.authority.compare({
            actor,
            selected,
            candidate: set,
          });
          order.evidenceRefs.forEach(identifier);
          if (order.evidenceRefs.length && order.cohort === 'PREDECESSOR')
            disposition = 'HISTORY_ONLY';
          else if (
            order.evidenceRefs.length &&
            order.cohort === 'SUCCESSOR' &&
            selected.cohortRef !== set.cohortRef &&
            set.predecessorCohortRef === selected.cohortRef &&
            set.successionEvidenceRefs.length
          )
            disposition = 'SELECTED';
          else if (
            order.evidenceRefs.length &&
            order.cohort === 'SAME' &&
            selected.cohortRef === set.cohortRef
          ) {
            disposition = this.sameCohortDisposition(
              selected,
              set,
              order.roster,
              order.memberObservationSuccessions ?? [],
              order.processingObservationSuccession,
            );
          }
        }
      }
      // Insert-only: unresolved/late facts remain inspectable history; no old set changes.
      await tx.insertProcessingSet(set);
      let newHead = head;
      if (disposition === 'SELECTED') {
        newHead = {
          scope: set.scope,
          processingFamilyRef: set.processingFamilyRef,
          selectedSetRevisionRef: set.setRevisionRef,
          generation: (head?.generation ?? 0) + 1,
        };
        await tx.selectProcessingSet(newHead, expectedGeneration);
      }
      await this.authority.assertAccess(access); // revoked admission rolls back both set/head
      return this.receipt(set, newHead, disposition);
    });
    if (receipt.selectedSetRevisionRef !== null) {
      try {
        // RETAIN admission and committed retention do not grant READ of the head.
        const selected = await this.readFrozen(
          actor,
          set.scope,
          receipt.selectedSetRevisionRef,
        );
        if (selected.processingFamilyRef !== set.processingFamilyRef)
          throw tdmsError('TDMS_SET_HEAD_INVALID', 409);
      } catch {
        // Keep the valid save/replay; expose neither hidden head fields nor denial diagnostics.
        return { ...receipt, selectedSetRevisionRef: null, generation: null };
      }
    }
    return receipt;
  }
  async readFrozen(
    actor: Actor,
    s: TdmsSourceScope,
    ref: string,
    contextValue: TdmsReadContext = {},
  ): Promise<TdmsProcessingRevisionSet> {
    this.ready(actor);
    this.scope(actor, s);
    identifier(ref);
    const context = readContext(contextValue);
    await this.authority.assertScopeAccess({
      actor,
      scope: s,
      action: 'READ',
      context,
    });
    const result = await this.repository.transaction(async (tx) => {
      const value = await tx.processingSet(s, ref);
      if (!value) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      const set = processingSet(value);
      if (!sameScope(s, set.scope) || set.setRevisionRef !== ref)
        throw tdmsError('TDMS_SET_STORED_IDENTITY_MISMATCH', 409);
      const facts = await processingSetFacts(tx, set);
      const access = { actor, action: 'READ' as const, context, set, ...facts };
      await this.authority.assertAccess(access);
      await this.authority.assertAccess(access);
      return { set, access };
    });
    await this.authority.assertAccess(result.access); // also after transaction/late response
    return result.set;
  }
  async readSelected(
    actor: Actor,
    s: TdmsSourceScope,
    family: string,
    context: TdmsReadContext = {},
  ): Promise<{
    head: TdmsProcessingSetHead;
    set: TdmsProcessingRevisionSet;
  } | null> {
    this.ready(actor);
    this.scope(actor, s);
    identifier(family);
    await this.authority.assertScopeAccess({
      actor,
      scope: s,
      action: 'READ',
      context: readContext(context),
    });
    const head = await this.repository.transaction((tx) =>
      tx.processingSetHead(s, family),
    );
    if (!head) return null;
    if (!sameScope(head.scope, s) || head.processingFamilyRef !== family)
      throw tdmsError('TDMS_SET_HEAD_INVALID', 409);
    const set = await this.readFrozen(
      actor,
      s,
      head.selectedSetRevisionRef,
      context,
    );
    if (set.processingFamilyRef !== family)
      throw tdmsError('TDMS_SET_HEAD_INVALID', 409);
    const finalHead = await this.repository.transaction((tx) =>
      tx.processingSetHead(s, family),
    );
    if (canonical(finalHead) !== canonical(head))
      throw tdmsError('TDMS_PROCESSING_SET_SELECTION_CHANGED', 409);
    try {
      // The head query may have waited for a write lock while READ was revoked.
      await this.readFrozen(actor, s, head.selectedSetRevisionRef, context);
    } catch {
      throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    }
    return { head, set };
  }
  async history(
    actor: Actor,
    s: TdmsSourceScope,
    family: string,
    context: TdmsReadContext = {},
    after: string | null = null,
  ) {
    this.ready(actor);
    this.scope(actor, s);
    identifier(family);
    await this.authority.assertScopeAccess({
      actor,
      scope: s,
      action: 'READ',
      context: readContext(context),
    });
    if (after !== null) identifier(after);
    // All-or-deny first slice. No hidden member count/ID leaks, no inherited parent ACL.
    const rows = await this.repository.transaction((tx) =>
      tx.processingSetHistory(s, family, after),
    );
    const sets: TdmsProcessingRevisionSet[] = [];
    for (const row of rows.slice(0, 50)) {
      if (!sameScope(row.scope, s) || row.processingFamilyRef !== family)
        throw tdmsError('TDMS_SET_STORED_IDENTITY_MISMATCH', 409);
      sets.push(await this.readFrozen(actor, s, row.setRevisionRef, context));
    }
    // The lookahead row is authorized too, so hasMore never reveals a hidden set.
    if (rows[50])
      await this.readFrozen(actor, s, rows[50].setRevisionRef, context);
    for (const set of sets)
      await this.readFrozen(actor, s, set.setRevisionRef, context);
    return {
      sets,
      hasMore: rows.length > 50,
      nextAfter: rows.length > 50 ? sets[49]!.setRevisionRef : null,
    };
  }
  private ready(actor: Actor): void {
    assertTdmsSourceActor(actor);
    if (!this.authority.available)
      throw tdmsError('TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED', 503);
  }
  private scope(actor: Actor, s: TdmsSourceScope): void {
    if (s.tenantId !== actor.tenantId)
      throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
  }
  private selectable(set: TdmsProcessingRevisionSet): boolean {
    return (
      set.currentness === 'CURRENT' &&
      set.cohortRef !== null &&
      set.familyIdentityEvidenceRefs.length > 0 &&
      set.cohortIdentityEvidenceRefs.length > 0
    );
  }
  private sameCohortDisposition(
    selected: TdmsProcessingRevisionSet,
    candidate: TdmsProcessingRevisionSet,
    roster: 'SAME' | 'SUCCESSOR' | 'PREDECESSOR' | 'UNKNOWN' | 'CONFLICT',
    memberSuccessions: NonNullable<
      Awaited<
        ReturnType<TdmsProcessingSetAuthority['compare']>
      >['memberObservationSuccessions']
    >,
    processingSuccession: Awaited<
      ReturnType<TdmsProcessingSetAuthority['compare']>
    >['processingObservationSuccession'],
  ): TdmsProcessingSetSaveReceipt['disposition'] {
    if (roster === 'PREDECESSOR') return 'HISTORY_ONLY';
    if (
      !['SAME', 'SUCCESSOR'].includes(roster) ||
      candidate.supersedesSetRevisionRef !== selected.setRevisionRef
    )
      return 'UNRESOLVED';
    if (
      candidate.processingObservationRef !==
        selected.processingObservationRef &&
      (!processingSuccession ||
        processingSuccession.olderObservationRef !==
          selected.processingObservationRef ||
        processingSuccession.newerObservationRef !==
          candidate.processingObservationRef ||
        !processingSuccession.evidenceRefs.some((ref) =>
          candidate.successionEvidenceRefs.includes(ref),
        ))
    ) {
      return 'UNRESOLVED';
    }
    for (const m of selected.members) {
      const n = candidate.members.find((v) => v.memberRef === m.memberRef);
      if (
        n &&
        m.assessmentObservationRef &&
        n.assessmentObservationRef !== m.assessmentObservationRef &&
        !memberSuccessions.some(
          (proof) =>
            proof.memberRef === m.memberRef &&
            proof.olderObservationRef === m.assessmentObservationRef &&
            proof.newerObservationRef === n.assessmentObservationRef &&
            proof.evidenceRefs.some((ref) =>
              n.assessmentSuccessionEvidenceRefs.includes(ref),
            ),
        )
      ) {
        return 'UNRESOLVED';
      }
    }
    if (roster === 'SAME') {
      // Observation supplementation may fill an expected slot, never silently drop or rename it.
      const old = selected.members.map((m) => m.memberRef).sort();
      const next = candidate.members.map((m) => m.memberRef).sort();
      if (
        canonical(old) !== canonical(next) ||
        candidate.sourceRosterRevision !== selected.sourceRosterRevision
      )
        return 'UNRESOLVED';
      for (const m of selected.members) {
        const n = candidate.members.find((v) => v.memberRef === m.memberRef)!;
        if (
          (m.assessmentObservationRef && !n.assessmentObservationRef) ||
          (m.assessmentFamilyRef &&
            n.assessmentFamilyRef !== m.assessmentFamilyRef) ||
          (m.assessmentBusinessRevisionKey &&
            n.assessmentBusinessRevisionKey !== m.assessmentBusinessRevisionKey)
        )
          return 'UNRESOLVED';
      }
    }
    return 'SELECTED';
  }
  private receipt(
    set: TdmsProcessingRevisionSet,
    head: TdmsProcessingSetHead | null,
    disposition: TdmsProcessingSetSaveReceipt['disposition'],
  ): TdmsProcessingSetSaveReceipt {
    return {
      setRevisionRef: set.setRevisionRef,
      selectedSetRevisionRef: head?.selectedSetRevisionRef ?? null,
      generation: head?.generation ?? null,
      disposition,
    };
  }
}
