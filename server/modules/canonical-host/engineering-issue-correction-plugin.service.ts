import { Injectable } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod/v4';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemIssue } from '@shared/jobaid-problem-assessment.interface';

/** Only Host-selected business material crosses the plugin boundary. */
export interface EngineeringIssueCorrectionContext {
  question: string;
  body: string;
  correctionReason: string;
  evidence: Array<{ evidenceRef: string; text: string; kind: AssessmentEvidence['kind'];
    title: string; versionLabel: string | null; locator: string | null }>;
  relatedUnderstanding: string | null;
  structuredContext: Pick<JobAidProblemIssue,
    'riskScenarios' | 'measures' | 'otherClassifications' | 'openQuestions' | 'requirementHandling'>;
  limitations: string[];
}

const nonblank = z.string().refine(value => value.trim().length > 0);
const resultSchema = z.strictObject({
  body: z.string().refine(value => value.trim().length > 0),
  changeSummary: z.string().refine(value => value.trim().length > 0),
  requirementHandling: z.array(z.strictObject({
    methodRef: nonblank, requirement: nonblank, conditions: z.array(nonblank),
    treatment: z.enum(['ADDRESSED', 'CONDITIONS_UNCONFIRMED', 'NOT_APPLICABLE_WITH_BASIS',
      'LATER_BUSINESS_STAGE', 'NOT_YET_ADDRESSED']),
    basisRefs: z.array(nonblank), explanation: nonblank,
  })),
  openQuestions: z.array(z.strictObject({
    question: nonblank, affects: nonblank, nextEvidence: nonblank, reason: nonblank,
  })),
});
const instanceId = 'wl-engineering-issue-correction';

/** Generation only: the durable attempt owner persists the receipt and calls the existing SAVE. */
@Injectable()
export class EngineeringIssueCorrectionPluginService {
  constructor(private readonly capabilities: CapabilityService) {}

  async generate(context: EngineeringIssueCorrectionContext, assertActive: () => Promise<void>) {
    const config = this.capabilities.getCapability(instanceId);
    if (config?.pluginKey !== '@official-plugins/ai-text-to-json' || config.pluginVersion !== '1.0.26')
      throw new Error('ENGINEERING_CORRECTION_PLUGIN_NOT_CONFIGURED');
    // Explicit projection prevents runtime identities or accidental extra properties entering the prompt.
    const supplied = {
      question: context.question, body: context.body, correctionReason: context.correctionReason,
      evidence: context.evidence.map(item => ({ evidenceRef: item.evidenceRef, text: item.text,
        kind: item.kind, title: item.title, versionLabel: item.versionLabel, locator: item.locator })),
      relatedUnderstanding: context.relatedUnderstanding, limitations: [...context.limitations],
      structuredContext: {
        riskScenarios: structuredClone(context.structuredContext.riskScenarios),
        measures: structuredClone(context.structuredContext.measures),
        otherClassifications: structuredClone(context.structuredContext.otherClassifications),
        openQuestions: structuredClone(context.structuredContext.openQuestions),
        requirementHandling: structuredClone(context.structuredContext.requirementHandling),
      },
    };
    if (!supplied.question.trim() || !supplied.body.trim() || !supplied.correctionReason.trim() ||
        !supplied.evidence.length || supplied.evidence.some(item => !item.evidenceRef.trim() || !item.text.trim()) ||
        new Set(supplied.evidence.map(item => item.evidenceRef)).size !== supplied.evidence.length)
      throw new Error('ENGINEERING_CORRECTION_CONTEXT_INVALID');
    await assertActive();
    // The installed manifest supports String and Array fields with explicit item schemas.
    const raw = await this.capabilities.load(instanceId).call('textToJson', {
      correctionContextJson: JSON.stringify(supplied),
    });
    await assertActive();
    const result = resultSchema.safeParse(raw);
    if (!result.success) throw new Error('ENGINEERING_CORRECTION_OUTPUT_INVALID');
    const withoutCitations = result.data.body.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '');
    if (withoutCitations.includes('[[') || withoutCitations.includes(']]'))
      throw new Error('ENGINEERING_CORRECTION_CITATION_MALFORMED');
    const refs = [...result.data.body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].map(match => match[1]);
    const delivered = new Set(supplied.evidence.map(item => item.evidenceRef));
    if (!refs.length || refs.some(ref => !delivered.has(ref)) ||
        result.data.requirementHandling.some(item =>
          !delivered.has(item.methodRef) || item.basisRefs.some(ref => !delivered.has(ref))))
      throw new Error('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
    if (result.data.requirementHandling.some(item =>
      supplied.evidence.find(evidence => evidence.evidenceRef === item.methodRef)?.kind !== 'METHOD_CLAUSE'))
      throw new Error('ENGINEERING_CORRECTION_METHOD_IDENTITY');
    return {
      ...result.data,
      producer: { kind: 'OFFICIAL_PLUGIN' as const, instanceId, pluginVersion: config.pluginVersion,
        actionKey: 'textToJson' as const, concreteModel: null },
    };
  }
}
