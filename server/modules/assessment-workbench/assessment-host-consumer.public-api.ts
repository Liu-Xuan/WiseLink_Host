export { AssessmentHostConsumerModule } from './assessment-host-consumer.module';
export {
  DYNAMIC_RULES_EVALUATION_PURPOSE,
  DynamicRulesEvaluationProcessor,
  buildDynamicRulesEvaluationRequest,
  consumeDynamicRulesEvaluationOutput,
  type DynamicRulesEvaluationCorrelation,
  type DynamicRulesEvaluationInput,
  type DynamicRulesEvaluationPrivateEnvelope,
  type DynamicRulesEvaluationRequest,
  type DynamicRulesEvaluationResult,
} from './dynamic-rules-evaluation.processor';
export {
  AssessmentHostConsumerService,
  type AssessmentHostCandidateRequest,
  type AssessmentHostCandidateResult,
  type AssessmentHostCandidateSummary,
  type AssessmentHostStaleState,
} from './assessment-host-consumer.service';
export {
  evaluateByJobAidForAily,
  prepareOverallSynthesisForAily,
  prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily,
  type AilyJobAidEvaluationCandidate,
  type AilyOverallSynthesisCandidate,
  type EvaluateByJobAidForAilyOptions,
} from './assessment-aily-orchestration';
export {
  prepareExternalDiscoveryCandidateDraftForAily,
  type ExternalDiscoveryCandidateDraft,
  type HostedOpenClawDiscoveryResult,
} from './external-discovery-assessment';
export { normalizeHostedOpenClawDiscoveryResult } from './hosted-openclaw-discovery-normalizer';
/**
 * Historical Base AI-field compatibility exports. New hosts use the dynamic
 * rules exports above and do not need a Base record or AI field.
 */
export {
  BASE_ONE_SHOT_PURPOSE,
  BaseOneShotAssessmentProcessor,
  buildBaseOneShotAssessmentPacket,
  consumeBaseOneShotAssessmentResult,
  type BaseOneShotAssessmentPacket,
  type BaseOneShotAssessmentResult,
  type BaseOneShotCorrelation,
} from './base-one-shot-assessment.processor';
