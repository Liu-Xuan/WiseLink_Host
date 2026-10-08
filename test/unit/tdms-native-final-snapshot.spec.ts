import { verifyTdmsNativeEvidence, type TdmsNativeEvidenceAuthorization } from '../../server/modules/canonical-host/tdms-native-evidence-verifier.port';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

it('requires a coordinated retained-body check after the final authorization await', async () => {
  const evidence = tdmsNativeEvidenceFixture(); let retainedBody = evidence.excerpt; let authorizations = 0;
  const verifier = {
    authorize: async (items: AssessmentTdmsNativeEvidence[]): Promise<TdmsNativeEvidenceAuthorization[]> => {
      if (++authorizations === 2) retainedBody = 'substituted during final authorize';
      return items.map(item => ({evidenceRef:item.evidenceRef, sourceRevisionRef:item.nativeSource.sourceRevisionRef,
        processingSetBinding:item.nativeScope.processingSetBinding, permissionRevision:'fixture-current-permission',
        sourceAudienceAuthorized:true,selectedObjectAuthorized:true}));
    },
    readExactEvidence: async () => [structuredClone(evidence)],
    assertCurrentEvidence: async ({evidence: items}: {evidence: AssessmentTdmsNativeEvidence[]}) => {
      if (items.some(item => item.excerpt !== retainedBody)) throw new Error('FINAL_RETAINED_BODY_CHANGED');
    },
  };
  await expect(verifyTdmsNativeEvidence([evidence], {tenantId:'fixture-tenant',actorUserId:'fixture-owner'},verifier))
    .rejects.toThrow('FINAL_RETAINED_BODY_CHANGED');
});

it('rejects a provider missing the final coordinated capability before body access', async () => {
  const readExactEvidence = jest.fn();
  const verifier = {authorize:jest.fn(),readExactEvidence};
  await expect(verifyTdmsNativeEvidence([tdmsNativeEvidenceFixture()], {tenantId:'fixture-tenant',actorUserId:'fixture-owner'},verifier as never))
    .rejects.toThrow('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
  expect(readExactEvidence).not.toHaveBeenCalled();
});
