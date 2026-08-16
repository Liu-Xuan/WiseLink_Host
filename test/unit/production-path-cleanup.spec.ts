import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('Phase 13C production path', () => {
  it('does not expose old validation actions or host-owned OpenClaw automation', async () => {
    const [app, controller, runtimeController, client, externalModule, assets, packageJson] =
      await Promise.all([
        source('server/app.module.ts'),
        source('server/modules/canonical-host/canonical-host.controller.ts'),
        source('server/modules/runtime-probe/runtime-probe.controller.ts'),
        source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
        source('server/modules/external-discovery/external-discovery.module.ts'),
        source('scripts/sync-document-management-assets.mjs'),
        source('package.json'),
      ]);

    expect(app).not.toContain('DocumentManagementValidationModule');
    expect(app).not.toContain('ExternalDiscoveryModule.forRoot');
    expect(controller).not.toContain('phase10-aeo-candidate-loop');
    expect(controller).toContain(
      "work-items/:workItemId/integrated-assessment/base-rules",
    );
    expect(controller).toContain(
      "work-items/:workItemId/integrated-assessment/overall-synthesis",
    );
    expect(runtimeController).not.toContain('file-service-upload');
    expect(client).not.toContain('RUN PHASE 10 AEO ONCE');
    expect(client).not.toContain('phase10-aeo-candidate-loop-trigger');
    expect(client).toContain('integratedAssessment.baseRules');
    expect(client).toContain('integratedAssessment.overallSynthesis');
    expect(client).toContain('WAITING_REAL_BASE_RESULT');
    expect(externalModule).not.toContain('ExternalDiscoveryAutomation');
    expect(externalModule).not.toContain('@Automation');
    expect(assets).not.toContain('phase10-aeo');
    expect(packageJson).not.toContain('test:phase6d:aeo-same-workitem');
    await expect(
      access(resolve(root, 'server/modules/aeo-authoring/public-api.ts')),
    ).rejects.toBeDefined();
  });

  it('publishes the nullable integrated assessment summary on the fixed status OpenAPI', async () => {
    const openApi = JSON.parse(
      await source('docs/openapi.json'),
    ) as {
      paths: Record<string, {
        get?: {
          responses?: Record<string, {
            content?: Record<string, {
              schema?: {
                required?: string[];
                properties?: Record<string, unknown>;
              };
            }>;
          }>;
        };
      }>;
    };
    const responseSchema = openApi.paths[
      '/openapi/wiselink/work-items/status'
    ]?.get?.responses?.['200']?.content?.['application/json']?.schema;

    expect(responseSchema?.required).toContain(
      'integratedAssessmentSummary',
    );
    expect(responseSchema?.properties).toHaveProperty(
      'integratedAssessmentSummary',
    );
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
