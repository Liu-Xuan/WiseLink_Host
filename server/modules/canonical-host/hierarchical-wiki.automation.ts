import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { Logger } from '@nestjs/common';
import { HierarchicalWikiService } from './hierarchical-wiki.service';
import { AilyBackgroundDispatchService } from './aily-background-dispatch.service';

/** Platform backstop only reserves due work. The native consumer performs model
 * work. A cron invocation without the configured service scope must fail closed. */
@Automation()
export class HierarchicalWikiAutomation {
  private readonly logger = new Logger(HierarchicalWikiAutomation.name);
  constructor(private readonly wiki: HierarchicalWikiService,
    private readonly aily: AilyBackgroundDispatchService) {}

  @BindTrigger('hierarchical_wiki_due')
  async reserveDue(): Promise<void> {
    const result = await this.wiki.next();
    if (result.status !== 'IDLE')
      this.logger.log(`Hierarchical Wiki reservation: ${result.status}`);
  }

  /** New independent binding; no platform trigger is created or enabled here. */
  @BindTrigger('wiselinkAilyEngineeringTick')
  async tickAilyEngineering() {
    const result = await this.aily.runOnce();
    this.logger.log(`Aily engineering invocation: ${result.status}`);
    return result;
  }
}
