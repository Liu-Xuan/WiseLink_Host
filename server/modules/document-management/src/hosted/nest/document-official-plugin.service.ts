import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod/v4';

export interface DocumentPluginProducer {
  kind: 'OFFICIAL_PLUGIN';
  instanceId: string;
  pluginVersion: string;
  actionKey: string;
  concreteModel: null;
}

/** A completed local validation, distinct from an upstream call with unknown outcome. */
export class DocumentPluginOutputError extends Error {}
function output<T>(schema: z.ZodType<T>, raw: unknown, code: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new DocumentPluginOutputError(code);
  return result.data;
}

/** Schema evidence is recorded in P_DELIVERY. Host scope never comes from plugin output. */
@Injectable()
// Registered by M in the document module during integration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentOfficialPluginService {
  private readonly logger = new Logger(DocumentOfficialPluginService.name);
  constructor(private readonly capabilities: CapabilityService) {}

  private async call(instanceId: string, actionKey: string, params: Record<string, unknown>) {
    const invocationId = randomUUID();
    const started = performance.now(), rssBeforeBytes = process.memoryUsage().rss;
    this.logger.log({ event: 'DOCUMENT_PLUGIN_CALL_STARTED', invocationId, instanceId, actionKey, rssBeforeBytes });
    try {
      const raw = await this.capabilities.load(instanceId).call(actionKey, params);
      // RETURNED describes transport only; schema/lease checks and persistence
      // still happen afterwards. Never log params, signed URLs or output bodies.
      this.logger.log({ event: 'DOCUMENT_PLUGIN_CALL_RETURNED', invocationId, instanceId, actionKey,
        elapsedMs: Math.round(performance.now() - started), rssAfterBytes: process.memoryUsage().rss,
        processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
      return raw;
    } catch (error) {
      this.logger.warn({ event: 'DOCUMENT_PLUGIN_CALL_ERROR', invocationId, instanceId, actionKey,
        elapsedMs: Math.round(performance.now() - started), rssAfterBytes: process.memoryUsage().rss,
        processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
      throw error;
    }
  }

  configured() {
    const config = this.capabilities.getCapability('wl-document-parser');
    return config?.pluginKey === '@official-plugins/ai-doc-parser' && config.pluginVersion === '1.0.16';
  }

  async parseOriginal(input: {
    /** Callback resolves the exact authorized file immediately before this call. */
    originalUrl: () => Promise<string>;
    assertActive: () => Promise<void>;
  }) {
    await input.assertActive();
    const url = await input.originalUrl();
    if (!url || new URL(url).protocol !== 'https:') throw new Error('DOCUMENT_PLUGIN_ORIGINAL_URL_INVALID');
    await input.assertActive();
    const raw = await this.call('wl-document-parser', 'parseDocToMarkdown', { fileUrl: [url] });
    await input.assertActive();
    const result = output(z.object({ content: z.string().min(1) }), raw, 'DOCUMENT_PARSER_OUTPUT_INVALID');
    return { markdown: result.content, producer: producer('wl-document-parser', '1.0.16', 'parseDocToMarkdown') };
  }

  async translateProse(content: string, assertActive: () => Promise<void>, context: unknown = null) {
    if (!content.trim()) throw new Error('DOCUMENT_TRANSLATION_EMPTY_INPUT');
    await assertActive();
    // Installed nestjs-capability.call aggregates stream chunks through the installed
    // ai-translate aggregate function, which concatenates chunk.translation. This
    // method returns one completed semantic block, not a browser token stream.
    const raw = await this.call('wl-document-translate', 'translate', { content, contextJson: JSON.stringify(context) });
    await assertActive();
    const result = output(z.object({ translation: z.string().refine(value => value.trim().length > 0) }), raw, 'DOCUMENT_TRANSLATION_OUTPUT_INVALID');
    return { translation: result.translation, producer: producer('wl-document-translate', '1.0.11', 'translate') };
  }

  async checkTranslation(check: { blockId: string; anchors: Array<{ anchorId: string; sourceText: string }>; candidate: unknown; context: unknown },
    assertActive: () => Promise<void>) {
    const snapshot = structuredClone(check);
    await assertActive();
    const raw = await this.call('wl-document-translation-check', 'textToJson', { checkJson: JSON.stringify(snapshot) });
    await assertActive();
    const result = output(z.strictObject({ blockId: z.string().min(1), issues: z.array(z.strictObject({
      code: z.string().min(1), severity: z.enum(['BLOCK', 'REVIEW', 'NOTE']), message: z.string().min(1),
      anchorIds: z.array(z.string().min(1)).min(1),
    })) }), raw, 'DOCUMENT_TRANSLATION_CHECK_OUTPUT_INVALID');
    if (result.blockId !== snapshot.blockId || result.issues.some(issue =>
      issue.anchorIds.some(id => !snapshot.anchors.some(anchor => anchor.anchorId === id))))
      throw new DocumentPluginOutputError('DOCUMENT_TRANSLATION_CHECK_SCOPE_INVALID');
    return { review: result, producer: producer('wl-document-translation-check', '1.0.26', 'textToJson') };
  }

  async translateStructure(items: Array<{ id: string; text: string }>, assertActive: () => Promise<void>, context: unknown = null) {
    const snapshot = items.map(item => ({ ...item }));
    if (!snapshot.length || new Set(snapshot.map(item => item.id)).size !== snapshot.length ||
        snapshot.some(item => !item.id || !item.text.trim())) throw new Error('DOCUMENT_TRANSLATION_ITEMS_INVALID');
    await assertActive();
    const raw = await this.call('wl-document-structured-translate', 'textToJson', {
      itemsJson: JSON.stringify(snapshot), contextJson: JSON.stringify(context),
    });
    await assertActive();
    const result = output(z.object({ items: z.array(z.strictObject({
      id: z.string().min(1), translation: z.string().refine(value => value.trim().length > 0),
    })) }), raw, 'DOCUMENT_TRANSLATION_OUTPUT_INVALID');
    if (result.items.length !== snapshot.length || result.items.some((item, index) => item.id !== snapshot[index].id))
      throw new DocumentPluginOutputError('DOCUMENT_TRANSLATION_ID_MISMATCH');
    return { items: result.items, producer: producer('wl-document-structured-translate', '1.0.26', 'textToJson') };
  }
}

function producer(instanceId: string, pluginVersion: string, actionKey: string): DocumentPluginProducer {
  return { kind: 'OFFICIAL_PLUGIN', instanceId, pluginVersion, actionKey, concreteModel: null };
}
