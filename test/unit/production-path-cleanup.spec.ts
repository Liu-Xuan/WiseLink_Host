import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('Phase 13C production path', () => {
  it('does not expose old validation actions or host-owned OpenClaw automation', async () => {
    const [
      app,
      controller,
      runtimeController,
      client,
      externalModule,
      assets,
      packageJson,
    ] = await Promise.all([
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
    expect(controller).not.toContain(
      'work-items/:workItemId/integrated-assessment/base-rules',
    );
    expect(controller).not.toContain(
      'work-items/:workItemId/integrated-assessment/overall-synthesis',
    );
    expect(controller).not.toContain(
      'work-items/:workItemId/assessment/evaluate',
    );
    expect(controller).not.toContain(
      'work-items/:workItemId/assessment/resynthesize',
    );
    expect(controller).toContain(
      'work-items/:workItemId/integrated-assessment/engineer-reviews',
    );
    expect(client).toContain(
      '保存只记录工程师判断，不运行模型，也不会直接改写逐项评估结果',
    );
    const openClawMcp = await source(
      'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts',
    );
    expect(openClawMcp).toContain('begin_dynamic_evaluation');
    expect(openClawMcp).toContain('commit_dynamic_evaluation_candidate');
    expect(openClawMcp).toContain('begin_overall_synthesis');
    expect(openClawMcp).toContain('commit_overall_candidate');
    await expect(
      access(
        resolve(
          root,
          'server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.ts',
        ),
      ),
    ).resolves.toBeUndefined();
    expect(runtimeController).not.toContain('file-service-upload');
    expect(client).not.toContain('RUN PHASE 10 AEO ONCE');
    expect(client).not.toContain('phase10-aeo-candidate-loop-trigger');
    expect(client).toContain('integratedAssessment.baseRules');
    expect(client).toContain('integratedAssessment.overallSynthesis');
    expect(client).not.toContain('WAITING_OPENCLAW_DYNAMIC_EVALUATION');
    expect(client).not.toContain('运行 Base 固定规则评估');
    expect(client).not.toContain('运行 OpenClaw 整体候选综合');
    expect(client).toContain('工程评估工作台 · 判断、依据与复核');
    expect(client).not.toContain('OpenClaw 动态 N + 整体综合');
    expect(externalModule).not.toContain('ExternalDiscoveryAutomation');
    expect(externalModule).not.toContain('@Automation');
    expect(assets).not.toContain('phase10-aeo');
    expect(assets).toContain("'node_modules/pdfjs-dist'");
    expect(assets).toContain(
      "'dist/server/runtime-assets/professional-input/pdfjs-dist'",
    );
    const pdfjsAdapter = await source(
      'server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter.ts',
    );
    expect(pdfjsAdapter).toContain(
      '../../../runtime-assets/professional-input/pdfjs-dist/legacy/build/pdf.mjs',
    );
    expect(pdfjsAdapter).toContain(
      "createRequire(__filename).resolve(\n    'pdfjs-dist/legacy/build/pdf.mjs'",
    );
    expect(packageJson).not.toContain('test:phase6d:aeo-same-workitem');
    await expect(
      access(resolve(root, 'server/modules/aeo-authoring/public-api.ts')),
    ).resolves.toBeUndefined();
    const aeoPublic = await source(
      'server/modules/aeo-authoring/public-api.ts',
    );
    expect(aeoPublic).toContain('AeoReviewedIntegratedAssessmentConsumer');
    expect(aeoPublic).not.toContain('Controller');
    await expect(
      access(resolve(root, 'server/modules/aeo-authoring/aeo-aily.controller.ts')),
    ).rejects.toBeDefined();
    expect(controller).toContain(
      'work-items/:workItemId/aeo/candidate',
    );
  });

  it('publishes the nullable integrated assessment summary on the fixed status OpenAPI', async () => {
    const openApi = JSON.parse(await source('docs/openapi.json')) as {
      paths: Record<
        string,
        {
          get?: {
            responses?: Record<
              string,
              {
                content?: Record<
                  string,
                  {
                    schema?: {
                      required?: string[];
                      properties?: Record<string, unknown>;
                    };
                  }
                >;
              }
            >;
          };
        }
      >;
    };
    const responseSchema =
      openApi.paths['/openapi/wiselink/work-items/status']?.get?.responses?.[
        '200'
      ]?.content?.['application/json']?.schema;

    expect(responseSchema?.required).toContain('integratedAssessmentSummary');
    expect(responseSchema?.properties).toHaveProperty(
      'integratedAssessmentSummary',
    );
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
