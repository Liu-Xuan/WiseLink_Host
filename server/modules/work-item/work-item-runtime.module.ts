import { Module } from '@nestjs/common';

import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';

@Module({
  providers: [MiaodaWorkItemRepository],
  exports: [MiaodaWorkItemRepository],
})
export class WorkItemRuntimeModule {}
