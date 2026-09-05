#!/usr/bin/env node

import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  assertHostedModelGatewayReady,
  createHostMcpConnection,
  invokeHostedReviewModel,
  resolveRuntimeConfig,
  runHostedReviewTurn,
} from './run-hosted-review-turn.mjs';

/** One native OpenClaw command-cron tick; an idle tick never invokes a model. */
export async function consumePendingReviewTurn(options, dependencies) {
  const pending = await dependencies.callTool('get_pending_review_turn', {
    workItemId: options.workItemId,
  });
  if (pending.busy) return { status: 'BUSY' };
  if (!pending.next) return { status: 'IDLE' };
  const next = pending.next;
  let startedAttempt = null;
  let commitStarted = false;
  try {
    const result = await (dependencies.runTurn ?? runHostedReviewTurn)(
      {
        reviewConversationRef: next.reviewConversationRef,
        requestId: next.requestId,
        checkpointDir: join(
          options.checkpointRoot,
          encodeURIComponent(next.reviewTurnRef),
        ),
      },
      {
        callTool: async (name, args) => {
          if (name === 'commit_review_turn_candidate') commitStarted = true;
          const value = await dependencies.callTool(name, args);
          if (name === 'begin_review_turn' && value.status === 'RUNNING')
            startedAttempt = value.attemptRef;
          return value;
        },
        invokeModel: dependencies.invokeModel,
      },
    );
    return {
      status: result.ok ? 'CANDIDATE_SAVED' : 'REQUIRES_ATTENTION',
      reviewTurnRef: next.reviewTurnRef,
      result,
    };
  } catch (error) {
    const code = errorCode(error);
    // A local/model failure before commit ends only this candidate attempt.
    // Never cancel a commit whose response may merely have been lost.
    if (startedAttempt && !commitStarted) {
      try {
        await dependencies.callTool('cancel_action_attempt', {
          attemptRef: startedAttempt,
          reason: `HOSTED_REVIEW_EXECUTION_FAILED:${code}`,
        });
      } catch (cancelError) {
        throw new Error(
          `${code};ATTEMPT_STOP_FAILED:${errorCode(cancelError)}`,
        );
      }
    }
    throw error;
  }
}

function errorCode(error) {
  const text = String(error?.code ?? error?.message ?? 'HOSTED_REVIEW_FAILED');
  return /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(text)
    ? text
    : 'HOSTED_REVIEW_FAILED';
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write(
      'Usage: node consume-hosted-review-turn.mjs --work-item-id WI-... [--checkpoint-root PATH] [--openclaw-config PATH]\nRuns one pending candidate-only review, or exits without a model call when idle.\n',
    );
    return;
  }
  const workItemId =
    option(argv, '--work-item-id') ?? env.WL_REVIEW_WORK_ITEM_ID;
  if (!workItemId) throw new Error('REVIEW_WORK_ITEM_ID_REQUIRED');
  const runtime = await resolveRuntimeConfig(argv, env);
  assertHostedModelGatewayReady(runtime);
  const connection = await createHostMcpConnection(runtime);
  try {
    if (!connection.hasTool('get_pending_review_turn'))
      throw new Error('HOST_AUTO_REVIEW_UNAVAILABLE');
    const result = await consumePendingReviewTurn(
      {
        workItemId,
        checkpointRoot:
          option(argv, '--checkpoint-root') ??
          join(homedir(), '.openclaw', 'wiselink-review-runs'),
      },
      {
        callTool: connection.callTool,
        invokeModel: (input, hooks = {}) =>
          invokeHostedReviewModel(input, { ...runtime, ...hooks }),
      },
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'REQUIRES_ATTENTION') process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), process.env).catch((error) => {
    process.stderr.write(`${errorCode(error)}\n`);
    process.exitCode = 1;
  });
}
