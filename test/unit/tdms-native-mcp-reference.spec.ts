import 'reflect-metadata';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { CanonicalHostOpenClawMcpService } from '@server/modules/canonical-host/canonical-host-openclaw-mcp.service';
import { tdmsApprovedOpinionRef } from '@server/modules/canonical-host/tdms-approved-opinion-context';

interface RegisteredTool {
  definition: { inputSchema: z.ZodType; annotations: Record<string, unknown> };
  handler: (value: unknown) => Promise<unknown>;
}
function registeredTools() {
  const registered = new Map<string, RegisteredTool>();
  const spy = jest
    .spyOn(McpServer.prototype, 'registerTool')
    .mockImplementation(function (
      name: string,
      definition: unknown,
      handler: unknown,
    ) {
      registered.set(name, { definition, handler } as RegisteredTool);
      return {
        remove: jest.fn(),
        enable: jest.fn(),
        disable: jest.fn(),
        update: jest.fn(),
      } as never;
    });
  const jobAid = {
    readSources: jest.fn().mockResolvedValue({ readPerformed: true }),
  };
  const summary = {
    readSources: jest.fn().mockResolvedValue({ readPerformed: true }),
  };
  const scope = {
    tenantId: 'tenant',
    principalId: 'principal',
    appId: 'app',
    authorizationFingerprint: 'verified',
  };
  const authorization = {
    authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue(scope),
  };
  try {
    const service = new CanonicalHostOpenClawMcpService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      authorization as never,
      jobAid as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      summary as never,
    );
    (service as unknown as { createServer(): McpServer }).createServer();
  } finally {
    spy.mockRestore();
  }
  const jobAidTool = registered.get('read_assessment_sources')!;
  const summaryTool = registered.get('derived_summary_attempt')!;
  expect(jobAidTool).toBeDefined();
  expect(summaryTool).toBeDefined();
  return { jobAid, summary, scope, jobAidTool, summaryTool };
}
const fence = {
  attemptRef: 'AQ-fixture',
  leaseToken: 'f1111111-1111-4111-8111-111111111111',
  leaseGeneration: 1,
  purpose: 'Read exact approved native opinion',
};
const jobAidInput = (refs: string[]) => ({
  ...fence,
  sourceRefs: refs,
  context: 'EXACT',
});
const summaryInput = (refs: string[], operation = 'READ_SOURCES') => ({
  ...fence,
  summaryId: 'DS-fixture',
  operation,
  evidenceRefs: refs,
});
function ref(component: string, revision: string) {
  return tdmsApprovedOpinionRef({
    scope: {
      tenantId: component,
      sourceKey: 'TDMS',
      sourceInstanceId: component,
      scopeId: component,
    },
    sourceRevisionRef: revision,
    opinionIndex: 0,
  });
}
const nativeRefs = [
  ['269', ref('a'.repeat(64), 'assessment-'.padEnd(45, 'r'))],
  ['above512', ref('a'.repeat(170), 'assessment-'.padEnd(45, 'r'))],
  ['above1024', ref('a'.repeat(255), 'r'.repeat(255))],
  ['escaped', ref('工:程/%'.repeat(51), '评'.repeat(255))],
];

test.each(
  nativeRefs.flatMap(([name, nativeRef]) => [
    ['JobAid', name, nativeRef],
    ['Summary', name, nativeRef],
  ]),
)(
  'actual registered %s READ schema preserves valid native %s reference',
  async (toolName, _name, nativeRef) => {
    const f = registeredTools();
    if (toolName === 'JobAid') {
      const parsed = f.jobAidTool.definition.inputSchema.parse(
        jobAidInput([nativeRef!]),
      );
      await f.jobAidTool.handler(parsed);
      expect(f.jobAid.readSources).toHaveBeenCalledWith(
        expect.objectContaining({ sourceRefs: [nativeRef] }),
      );
    } else {
      const parsed = f.summaryTool.definition.inputSchema.parse(
        summaryInput([nativeRef!]),
      );
      await f.summaryTool.handler(parsed);
      expect(f.summary.readSources).toHaveBeenCalledWith(
        expect.objectContaining({ evidenceRefs: [nativeRef], scope: f.scope }),
      );
    }
  },
);

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH } from '@shared/tdms-approved-opinion-reference';

function metadataCheck(tool: unknown): string {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {readFileSync} from 'node:fs';
    import {validateDerivedSummaryToolMetadata} from './openclaw/skills/wiselink-research-and-synthesize/scripts/derived-summary-shape.mjs';
    try {validateDerivedSummaryToolMetadata(JSON.parse(readFileSync(0,'utf8')));process.stdout.write('VALID');}
    catch(error){process.stdout.write(error.message);}
  `,
    ],
    { cwd: process.cwd(), input: JSON.stringify(tool), encoding: 'utf8' },
  );
}
function summaryMetadata(f: ReturnType<typeof registeredTools>) {
  return {
    name: 'derived_summary_attempt',
    inputSchema: z.toJSONSchema(f.summaryTool.definition.inputSchema),
    annotations: f.summaryTool.definition.annotations,
  };
}

test.each([
  ['JobAid', 512],
  ['Summary', 1024],
] as const)(
  'actual registered %s keeps ordinary cap %s and rejects noncanonical native spellings',
  (toolName, cap) => {
    const f = registeredTools();
    const schema =
      toolName === 'JobAid'
        ? f.jobAidTool.definition.inputSchema
        : f.summaryTool.definition.inputSchema;
    const input = toolName === 'JobAid' ? jobAidInput : summaryInput;
    expect(schema.safeParse(input(['o'.repeat(cap)])).success).toBe(true);
    expect(schema.safeParse(input(['o'.repeat(cap + 1)])).success).toBe(false);
    for (const [, nativeRef] of nativeRefs) {
      if (nativeRef!.length > cap)
        expect(
          schema.safeParse(input(['ordinary:'.padEnd(nativeRef!.length, 'x')]))
            .success,
        ).toBe(false);
      expect(
        schema.safeParse(input([nativeRef!.replace(/:0$/u, ':00')])).success,
      ).toBe(false);
    }
    for (const invalid of [
      'TDMS_APPROVED_OPINION:%74:TDMS:i:s:r:0',
      'TDMS_APPROVED_OPINION:t:TDMS:i:s:%3a:0',
      'TDMS_APPROVED_OPINION:t:TDMS:i:s:r:9007199254740992',
      `TDMS_APPROVED_OPINION:${'a'.repeat(256)}:TDMS:i:s:r:0`,
      `TDMS_APPROVED_OPINION:${'a'.repeat(TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH)}`,
    ])
      expect(schema.safeParse(input([invalid])).success).toBe(false);
    expect(f.jobAid.readSources).not.toHaveBeenCalled();
    expect(f.summary.readSources).not.toHaveBeenCalled();
  },
);

test('actual registered array boundaries, strict fields and Summary member-work cap stay unchanged', () => {
  const f = registeredTools();
  expect(
    f.jobAidTool.definition.inputSchema.safeParse(jobAidInput([])).success,
  ).toBe(false);
  expect(
    f.jobAidTool.definition.inputSchema.safeParse(
      jobAidInput(Array.from({ length: 96 }, (_, i) => `source-${i}`)),
    ).success,
  ).toBe(true);
  expect(
    f.jobAidTool.definition.inputSchema.safeParse(
      jobAidInput(Array.from({ length: 97 }, (_, i) => `source-${i}`)),
    ).success,
  ).toBe(false);
  expect(
    f.summaryTool.definition.inputSchema.safeParse(summaryInput([])).success,
  ).toBe(false);
  // Summary had no schema maxItems; this patch must not introduce a new selection cap.
  expect(
    f.summaryTool.definition.inputSchema.safeParse(
      summaryInput(Array.from({ length: 97 }, (_, i) => `source-${i}`)),
    ).success,
  ).toBe(true);
  expect(
    f.summaryTool.definition.inputSchema.safeParse(
      summaryInput(['o'.repeat(1024)], 'READ_MEMBER_WORK'),
    ).success,
  ).toBe(true);
  expect(
    f.summaryTool.definition.inputSchema.safeParse(
      summaryInput([nativeRefs[2]![1]!], 'READ_MEMBER_WORK'),
    ).success,
  ).toBe(false);
  expect(
    f.jobAidTool.definition.inputSchema.safeParse({
      ...jobAidInput(['source']),
      tenantId: 'forged',
    }).success,
  ).toBe(false);
  expect(
    f.summaryTool.definition.inputSchema.safeParse({
      ...summaryInput(['source']),
      tenantId: 'forged',
    }).success,
  ).toBe(false);
});

test('consumer metadata validator accepts actual new registration and unchanged old fixture', () => {
  const f = registeredTools();
  const metadata = summaryMetadata(f);
  expect(metadataCheck(metadata)).toBe('VALID');
  const legacy = JSON.parse(
    readFileSync(
      'openclaw/skills/wiselink-research-and-synthesize/tests/fixtures/derived-summary-tool-metadata.json',
      'utf8',
    ),
  ) as unknown;
  expect(metadataCheck(legacy)).toBe('VALID');
});

test.each([
  'ordinary-cap',
  'native-cap',
  'native-pattern',
  'extra-alternative',
  'member-work-extension',
])(
  'consumer metadata rejects %s widening of actual registered native exception',
  (mutation) => {
    const metadata = summaryMetadata(registeredTools()) as unknown as {
      inputSchema: { oneOf: Array<{ properties: Record<string, any> }> };
    };
    const sources = metadata.inputSchema.oneOf.find(
      (branch) => branch.properties.operation.const === 'READ_SOURCES',
    )!.properties.evidenceRefs;
    const member = metadata.inputSchema.oneOf.find(
      (branch) => branch.properties.operation.const === 'READ_MEMBER_WORK',
    )!.properties.evidenceRefs;
    if (mutation === 'ordinary-cap') sources.items.anyOf[0].maxLength = 1025;
    else if (mutation === 'native-cap')
      sources.items.anyOf[1].maxLength =
        TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH + 1;
    else if (mutation === 'native-pattern')
      sources.items.anyOf[1].pattern = '.*';
    else if (mutation === 'extra-alternative')
      sources.items.anyOf.push({ type: 'string' });
    else member.items = structuredClone(sources.items);
    expect(metadataCheck(metadata)).toBe(
      'REVIEW_HOST_MCP_DERIVED_SUMMARY_SCHEMA_MISMATCH',
    );
  },
);
