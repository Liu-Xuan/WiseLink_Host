import type { WlCardTemplate, WlCardTemplateId } from '../types';

import { wlCard01CurrentFocus } from './WL-CARD-01-current-focus';
import { wlCard02OverallAssessment } from './WL-CARD-02-overall-assessment';
import { wlCard03TaskRunning } from './WL-CARD-03-task-running';
import { wlCard04WaitingInput } from './WL-CARD-04-waiting-input';
import { wlCard05ReviewSuggestion } from './WL-CARD-05-review-suggestion';
import { wlCard06StaleConflict } from './WL-CARD-06-stale-conflict';
import { wlCard07FailurePermission } from './WL-CARD-07-failure-permission';

export const wlCardTemplates: readonly WlCardTemplate[] = [
  wlCard01CurrentFocus,
  wlCard02OverallAssessment,
  wlCard03TaskRunning,
  wlCard04WaitingInput,
  wlCard05ReviewSuggestion,
  wlCard06StaleConflict,
  wlCard07FailurePermission,
];

export const wlCardTemplateById: ReadonlyMap<WlCardTemplateId, WlCardTemplate> =
  new Map(wlCardTemplates.map((template) => [template.id, template]));

export {
  wlCard01CurrentFocus,
  wlCard02OverallAssessment,
  wlCard03TaskRunning,
  wlCard04WaitingInput,
  wlCard05ReviewSuggestion,
  wlCard06StaleConflict,
  wlCard07FailurePermission,
};
