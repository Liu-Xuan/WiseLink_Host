import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import { MatterAssessmentActivityController } from '../../server/modules/canonical-host/matter-assessment-activity.controller';
import { EngineeringMatterWorkingService } from '../../server/modules/canonical-host/engineering-matter-working.service';
import { MatterActionAttemptService } from '../../server/modules/canonical-host/matter-action-attempt.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION } from '../../server/modules/canonical-host/canonical-service-scope.authorization';

// A real loopback HTTP rejection probe, not a Hosted identity/business test.
describe('Matter activity local HTTP ingress', () => {
  let app: INestApplication;
  let origin: string;
  const readWorking = jest.fn();
  const readActivityForBrowser = jest.fn();
  const authorizeOpenClawMatterRequest = jest.fn();
  const previousLocal = process.env.MIAODA_LOCAL_DEV;

  beforeAll(async () => {
    process.env.MIAODA_LOCAL_DEV = '1';
    const module = await Test.createTestingModule({
      controllers: [MatterAssessmentActivityController],
      providers: [
        { provide: EngineeringMatterWorkingService, useValue: { readWorking } },
        {
          provide: MatterActionAttemptService,
          useValue: { readActivityForBrowser },
        },
        {
          provide: CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
          useValue: { authorizeOpenClawMatterRequest },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    if (previousLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
    else process.env.MIAODA_LOCAL_DEV = previousLocal;
  });

  it.each(['', '?attemptRef=untrusted&limit=10'])(
    'denies direct browser reads%s before any business access',
    async (query) => {
      const response = await fetch(
        `${origin}/api/canonical-host/engineering-matters/local-test/assessment-activity${query}`,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE' },
      });
      expect(readWorking).not.toHaveBeenCalled();
      expect(readActivityForBrowser).not.toHaveBeenCalled();
      expect(authorizeOpenClawMatterRequest).not.toHaveBeenCalled();
    },
  );
});
