import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Body: noOp,
    Controller: noOp,
    Get: noOp,
    HttpCode: noOp,
    Inject: noOp,
    Param: noOp,
    Post: noOp,
    Query: noOp,
    Req: noOp,
    Res: noOp,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { IdentityModule } from '../../server/modules/identity/identity.module';
import { ReviewConversationController } from '../../server/modules/review-persistence/review-conversation.controller';
import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';
import { ReviewConversationService } from '../../server/modules/review-persistence/review-conversation.service';
import { ReviewPersistenceModule } from '../../server/modules/review-persistence/review-persistence.module';
import { WorkItemRuntimeModule } from '../../server/modules/work-item/work-item-runtime.module';

describe('ReviewPersistenceModule composition', () => {
  it('wires session identity, WorkItem ACL, persistence and API together', () => {
    const imports = Reflect.getMetadata('imports', ReviewPersistenceModule);
    const controllers = Reflect.getMetadata(
      'controllers',
      ReviewPersistenceModule,
    );
    const providers = Reflect.getMetadata('providers', ReviewPersistenceModule);
    expect(imports).toEqual(
      expect.arrayContaining([IdentityModule, WorkItemRuntimeModule]),
    );
    expect(controllers).toContain(ReviewConversationController);
    expect(providers).toEqual(
      expect.arrayContaining([
        ReviewConversationRepository,
        ReviewConversationService,
      ]),
    );
  });
});
