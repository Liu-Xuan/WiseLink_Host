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

  it('pins the exact 7a8403e R09 fixture bytes used by the local same-WorkItem loop', () => {
    const bytes = readFileSync(
      resolve(process.cwd(), 'test/fixtures/aeo-r09-authoring-seed.json'),
    );
    expect(bytes.byteLength).toBe(78_811);
    expect(JSON.parse(bytes.toString('utf8')).parsePackageId).toBe(
      'AEOPARSE-D39EB2E83C552549A9AA5784',
    );
  });
});
