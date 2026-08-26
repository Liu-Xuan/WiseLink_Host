export const JOB_AID_EVALUATION_AVAILABILITY = Object.freeze({
  READY_TO_EXECUTE: 'READY_TO_EXECUTE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  DATA_SOURCE_NOT_CONNECTED: 'DATA_SOURCE_NOT_CONNECTED',
  METHOD_NOT_IMPLEMENTED: 'METHOD_NOT_IMPLEMENTED',
  ENGINEER_DECISION_REQUIRED: 'ENGINEER_DECISION_REQUIRED',
  LIFECYCLE_NOT_REACHED: 'LIFECYCLE_NOT_REACHED',
});

/**
 * Classify why a criterion method can or cannot run without collapsing unlike
 * product states into a generic WAITING_INPUT bucket. This is presentation
 * metadata only: it never changes the CriterionSet predicate or decision.
 */
export function classifyJobAidEvaluationAvailability({
  applicable = true,
  lifecycleReached = true,
  methodImplemented = true,
  dataSourceConnected = true,
  engineerDecisionRequired = false,
} = {}) {
  if (applicable === false) {
    return JOB_AID_EVALUATION_AVAILABILITY.NOT_APPLICABLE;
  }
  if (lifecycleReached === false) {
    return JOB_AID_EVALUATION_AVAILABILITY.LIFECYCLE_NOT_REACHED;
  }
  if (methodImplemented === false) {
    return JOB_AID_EVALUATION_AVAILABILITY.METHOD_NOT_IMPLEMENTED;
  }
  if (dataSourceConnected === false) {
    return JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED;
  }
  if (engineerDecisionRequired === true) {
    return JOB_AID_EVALUATION_AVAILABILITY.ENGINEER_DECISION_REQUIRED;
  }
  return JOB_AID_EVALUATION_AVAILABILITY.READY_TO_EXECUTE;
}
