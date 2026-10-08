import type { TdmsNativeEvidenceVerifier } from '@server/modules/canonical-host/tdms-native-evidence-verifier.port';
import { projectTdmsProcessingCohortContext } from '@server/modules/canonical-host/tdms-approved-opinion-context';
import { canonical } from '@server/modules/tdms-source/tdms-source.validation';
import type { tdmsRuntimeFixture } from './tdms-runtime.fixture';

/** Constructed synchronous transaction authority over the OFFLINE fixture's facts.
 * It deliberately never invokes an ordinary adapter/root-pool reader. This is not
 * a production verifier, physical database isolation, or production identity proof. */
export function tdmsTransactionProofFixture(
  f: ReturnType<typeof tdmsRuntimeFixture>,
): NonNullable<TdmsNativeEvidenceVerifier['assertInTransaction']> {
  return async (input) => {
    const fail = (): never => {
      throw new Error('FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED');
    };
    const control = f.control;
    if (
      !input.database ||
      !control.authenticated ||
      !control.applicationAllowed ||
      !control.sourceAllowed ||
      !control.objectAllowed ||
      !control.documentAllowed ||
      !control.allowedDocumentIds.has(f.binding.documentVersionId) ||
      input.actor.tenantId !== f.binding.tenantId ||
      input.actor.actorUserId !== f.binding.actorUserId ||
      !f.principal.scope.automaticWorkItemLease ||
      Date.parse(f.principal.scope.automaticWorkItemLease.leaseExpiresAt) <=
        Date.now()
    )
      fail();
    if (input.runtime) {
      if (
        canonical(input.runtime.principal) !== canonical(f.principal) ||
        canonical(input.runtime.context.binding) !== canonical(f.binding)
      )
        fail();
      const projection = projectTdmsProcessingCohortContext({
        ...f.facts,
        sets: [f.set],
        selectedSetRevisionRefs: [f.head.selectedSetRevisionRef],
      });
      if (
        canonical(input.runtime.context.projection) !== canonical(projection) ||
        input.runtime.context.selections.some(
          (selection) =>
            selection.setRevisionRef !== f.head.selectedSetRevisionRef ||
            selection.generation !== f.head.generation,
        )
      )
        fail();
    }
    for (const evidence of input.evidence) {
      const proof = f.receipts.find(
        (row) =>
          row.receipt.receiptRef === evidence.nativeReadReceipt.receiptRef,
      );
      const selected = evidence.nativeScope.processingSetBinding;
      const field = /^content\.opinions\[(\d+)\]$/u.exec(
        evidence.nativeScope.fieldSelectors[0].fieldPath,
      );
      if (
        !proof ||
        proof.actorId !== input.actor.actorUserId ||
        canonical(proof.receipt) !== canonical(evidence.nativeReadReceipt) ||
        selected.setRevisionRef !== f.head.selectedSetRevisionRef ||
        selected.generation !== f.head.generation ||
        canonical(selected.scope) !== canonical(f.scope) ||
        !field ||
        canonical(
          f.bodies.get(evidence.nativeSource.sourceRevisionRef)?.opinions?.[
            Number(field[1])
          ],
        ) !== evidence.excerpt
      )
        fail();
    }
  };
}
