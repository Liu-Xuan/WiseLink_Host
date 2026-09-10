import type {
  DialogueAssessmentResponse,
  RequestDialogueAssessment,
} from '@shared/dialogue.interface';
import {
  readDialogue,
  requestDialogueAssessment,
  type DialogueClientError,
} from '@client/src/api/dialogues';

/** Keep the accepted receipt across read failures: subsequent attempts only GET. */
export function dialogueAssessmentOperation(
  threadRef: string,
  input: RequestDialogueAssessment,
) {
  let receipt: DialogueAssessmentResponse | null = null;
  return {
    receipt: () => receipt,
    run: async (signal: AbortSignal) => {
      if (!receipt)
        receipt = await requestDialogueAssessment(threadRef, input, signal);
      try {
        return await readDialogue(threadRef, signal);
      } catch (reason: unknown) {
        const statusCode = (reason as DialogueClientError)?.statusCode;
        throw Object.assign(
          new Error(
            '评估请求已受理，但最新对话状态读取失败。重试仅补读状态，不会再次提交评估。',
          ),
          {
            // Auth failures must still clear private data. Other read failures retain the GET-only retry.
            statusCode: [401, 403, 404].includes(statusCode ?? 0)
              ? statusCode
              : undefined,
          },
        );
      }
    },
  };
}
