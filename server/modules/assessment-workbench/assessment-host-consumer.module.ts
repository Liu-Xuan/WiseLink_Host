import { Module } from '@nestjs/common';

import { AssessmentHostConsumerService } from './assessment-host-consumer.service';
import { BaseOneShotAssessmentProcessor } from './base-one-shot-assessment.processor';
import { DynamicRulesEvaluationProcessor } from './dynamic-rules-evaluation.processor';
import { EvaluationContextService } from './evaluation-context.service';
import { KnowledgeRetrievalContextService } from './knowledge-retrieval-context.service';

/**
 * Import this module into the one canonical Miaoda Nest host. It intentionally
 * has no controller, database provider, Registrar or persistence side effect.
 */
@Module({
  providers: [
    AssessmentHostConsumerService,
    DynamicRulesEvaluationProcessor,
    BaseOneShotAssessmentProcessor,
    EvaluationContextService,
    KnowledgeRetrievalContextService,
  ],
  exports: [
    AssessmentHostConsumerService,
    DynamicRulesEvaluationProcessor,
    BaseOneShotAssessmentProcessor,
  ],
})
export class AssessmentHostConsumerModule {}
