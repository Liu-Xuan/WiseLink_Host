import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { Logger } from '@nestjs/common';
import { HierarchicalWikiService } from './hierarchical-wiki.service';

/** Platform backstop only reserves due work. The native consumer performs model
 * work. A cron invocation without the configured service scope must fail closed. */
@Automation()
export class HierarchicalWikiAutomation {
  private readonly logger = new Logger(HierarchicalWikiAutomation.name);
  constructor(private readonly wiki: HierarchicalWikiService) {}

  @BindTrigger('hierarchical_wiki_due')
  async reserveDue(): Promise<void> {
    const result = await this.wiki.next();
    if (result.status !== 'IDLE')
      this.logger.log(`Hierarchical Wiki reservation: ${result.status}`);
  }
}
