import { Module } from '@nestjs/common';

import { AssessmentHostConsumerService } from './assessment-host-consumer.service';
import { EvaluationContextService } from './evaluation-context.service';
import { KnowledgeRetrievalContextService } from './knowledge-retrieval-context.service';

/**
 * Import this module into the one canonical Miaoda Nest host. It intentionally
 * has no controller, database provider, Registrar or persistence side effect.
 */
@Module({
  providers: [
    AssessmentHostConsumerService,
    EvaluationContextService,
    KnowledgeRetrievalContextService,
  ],
  exports: [AssessmentHostConsumerService],
})
export class AssessmentHostConsumerModule {}
