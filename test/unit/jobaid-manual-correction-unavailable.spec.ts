import 'reflect-metadata';
import { RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { CanonicalHostModule } from '../../server/modules/canonical-host/canonical-host.module';
import { CanonicalJobAidManualCorrectionUnavailableController } from '../../server/modules/canonical-host/canonical-jobaid-manual-correction-unavailable.controller';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../../server/modules/work-item/production-miaoda-browser-ingress';

describe('partial Host delivery keeps manual correction writes unavailable', () => {
  it('registers the closed authenticated POST in both Host compositions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CanonicalJobAidManualCorrectionUnavailableController))
      .toBe('api/canonical-host/work-items/:workItemId/assessment-work/corrections');
    expect(Reflect.getMetadata(GUARDS_METADATA, CanonicalJobAidManualCorrectionUnavailableController))
      .toContain(ProductionMiaodaBrowserObjectIngressGuard);
    expect(Reflect.getMetadata(METHOD_METADATA, CanonicalJobAidManualCorrectionUnavailableController.prototype.save))
      .toBe(RequestMethod.POST);
    const staticControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CanonicalHostModule) as unknown[];
    const dynamicControllers = CanonicalHostModule.forRoot().controllers ?? [];
    for (const controllers of [staticControllers, dynamicControllers]) {
      expect(controllers.filter(controller => controller === CanonicalJobAidManualCorrectionUnavailableController)).toHaveLength(1);
      expect(controllers.some(controller => typeof controller === 'function' && controller.name === 'CanonicalJobAidWorkCorrectionController'))
        .toBe(false);
    }
  });

  it('constructs the actual controller without persistence and rejects every invocation', async () => {
    const context = await Test.createTestingModule({ controllers: [CanonicalJobAidManualCorrectionUnavailableController] }).compile();
    try {
      const controller = context.get(CanonicalJobAidManualCorrectionUnavailableController);
      expect(controller).toBeInstanceOf(CanonicalJobAidManualCorrectionUnavailableController);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          controller.save();
          throw new Error('manual correction unexpectedly accepted');
        } catch (error) {
          expect(error).toBeInstanceOf(ServiceUnavailableException);
          expect((error as ServiceUnavailableException).getStatus()).toBe(503);
          expect((error as ServiceUnavailableException).getResponse()).toEqual({
            code: 'JOBAID_MANUAL_CORRECTION_NOT_ENABLED', message: '当前版本暂未启用人工更正。',
          });
        }
      }
    } finally { await context.close(); }
  });

  it('does not include the manual repository producer as an alternative entry', () => {
    expect(Reflect.get(JobAidWorkRepository.prototype, 'saveManualCorrection')).toBeUndefined();
    expect(Reflect.get(JobAidWorkRepository.prototype, 'readManualCorrection')).toBeUndefined();
  });
});
