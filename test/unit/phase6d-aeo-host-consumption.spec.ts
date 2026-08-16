import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Phase 6D AEO host consumption', () => {
  it('keeps the canonical AppModule unconfigured and adds no AEO route', () => {
    const appModule = readFileSync(resolve(process.cwd(), 'server/app.module.ts'), 'utf8');
    expect(appModule).not.toContain('AeoAuthoringModule');
    expect(appModule).not.toContain('AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER');
  });

  it('registers the owner adapter only through the explicit public provider', () => {
    const moduleSource = readFileSync(
      resolve(process.cwd(), 'server/modules/aeo-authoring/aeo-authoring.module.ts'),
      'utf8',
    );
    const publicApiSource = readFileSync(
      resolve(process.cwd(), 'server/modules/aeo-authoring/public-api.ts'),
      'utf8',
    );
    expect(moduleSource).toContain('sameWorkItemAssessmentAdapterProvider?: Provider');
    expect(moduleSource).toContain(
      'sameWorkItemAssessmentAdapterProvider\n          ? [sameWorkItemAssessmentAdapterProvider]\n          : []',
    );
    expect(moduleSource).toContain('provideAeoSameWorkItemAssessmentAdapter');
    expect(publicApiSource).toContain('AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER');
    expect(publicApiSource).toContain('provideAeoSameWorkItemAssessmentAdapter');
  });

  it('pins the exact cf9a377 R09 fixture bytes used by the local same-WorkItem loop', () => {
    const bytes = readFileSync(
      resolve(process.cwd(), 'test/fixtures/aeo-r09-authoring-seed.json'),
    );
    expect(bytes.byteLength).toBe(78_811);
    expect(JSON.parse(bytes.toString('utf8')).parsePackageId).toBe(
      'AEOPARSE-D39EB2E83C552549A9AA5784',
    );
  });

  it('requires the current explicit cumulative resynthesis before AEO projection', () => {
    const adapterSource = readFileSync(
      resolve(
        process.cwd(),
        'server/modules/aeo-authoring/aeo-same-workitem-assessment.adapter.ts',
      ),
      'utf8',
    );
    const sourceReceipt = readFileSync(
      resolve(process.cwd(), 'server/modules/aeo-authoring/SOURCE.md'),
      'utf8',
    );
    expect(sourceReceipt).toContain(
      '8a2ea67aea5d60c0c72750a9e539404214296aeb',
    );
    expect(adapterSource).toContain('ASSESSMENT_EXPLICIT_RESYNTHESIS_REQUIRED');
    expect(adapterSource).toContain('assertCurrentResynthesizedAssessment');
    expect(adapterSource).toContain("staleState.reason !== 'ENGINEER_ITEM_SET_CHANGED'");
  });
});
