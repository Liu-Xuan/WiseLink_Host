import { consumeAutomaticWorkItemQueueTick, consumeHostedDocument }
  from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';

// Local test subprocess only. IPC substitutes transport/checkpoint/provider ports;
// both consumers above are the actual production exports, with no copied logic.
let serial = 0;
const pending = new Map();
const rpc = (method, input) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  process.send({ type: 'rpc', id, method, input });
});
process.on('message', message => {
  if (message.type !== 'reply') return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
  else request.resolve(message.value);
});
process.once('message', async input => {
  const records = new Map(Object.entries(input.checkpoints ?? {}));
  const writes = [];
  let modelInvocations = 0;
  const unexpected = async () => { throw new Error('UNEXPECTED_CONSUMER_PORT'); };
  const invokeModel = async () => {
    modelInvocations++;
    throw new Error('MODEL_DISPATCH_FORBIDDEN_IN_LOCAL_REPLAY');
  };
  const checkpoint = {
    readOptional: async name => records.get(name) ?? null,
    write: async (name, value) => { writes.push({ name, value }); records.set(name, value); },
    withActiveClaimOwner: operation => operation(),
  };
  const documentDependencies = {
    callTool: (name, args) => rpc('tool', { name, args }),
    readingCheckpoint: async () => ({ readOptional: async () => null, write: unexpected }),
    documentTranslationCheckpoint: {}, activityCheckpoint: {},
    invokeReadingModel: invokeModel, invokeActivityModel: invokeModel, invokeTranslationModel: invokeModel,
  };
  try {
    const result = input.mode === 'reading'
      ? await consumeHostedDocument({ ...input.target, leaseOwner: 'local-replay-consumer' }, documentDependencies)
      : await consumeAutomaticWorkItemQueueTick({}, {
        checkpoint, nextWorkItem: args => rpc('next', args),
        acknowledgeWorkItem: unexpected, consumeWorkItem: unexpected, readInitialStatus: unexpected,
        consumeDocument: (documentVersionId, deliveryRef) => consumeHostedDocument({
          documentVersionId, deliveryRef, leaseOwner: 'local-replay-consumer',
        }, documentDependencies),
        consumeWikiIdle: () => rpc('wiki', null),
      });
    process.send({ type: 'done', result, writes, checkpoints: Object.fromEntries(records), modelInvocations });
  } catch (error) {
    process.send({ type: 'done', error: { message: error.message, name: error.name,
      code: error.code, statusCode: error.statusCode, stack: error.stack },
      writes, checkpoints: Object.fromEntries(records), modelInvocations });
  } finally { process.disconnect(); }
});
process.send({ type: 'ready' });
