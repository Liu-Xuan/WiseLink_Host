#!/usr/bin/env node
/** Offline documentation export. No Host business handler or external transport runs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const { Client } = require('@modelcontextprotocol/client');
const { InMemoryTransport } = require('@modelcontextprotocol/server');
const checkOnly = process.argv.includes('--check');
const outputIndex = process.argv.indexOf('--output');
const out = outputIndex < 0
  ? join(root, 'docs/coordination/host-codex-interface-20261025')
  : resolve(process.argv[outputIndex + 1] ?? '');
assert.ok(isAbsolute(out) && out.startsWith(`${root}${sep}`), 'OUTPUT_MUST_BE_INSIDE_REPOSITORY');

const loaded = new Set();
const sourceText = path => readFileSync(join(root, path), 'utf8');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = new Set([
  'server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts',
  'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts',
  'server/modules/canonical-host/canonical-host-executor-policy.ts',
  'server/modules/canonical-host/configured-development-service-scope.authorization.ts',
  'server/modules/canonical-host/canonical-host-openclaw-runtime-policy.ts',
  'server/modules/canonical-host/canonical-host-openclaw-discovery.service.ts',
  'server/modules/canonical-host/canonical-jobaid-problem.service.ts',
  'server/modules/canonical-host/program-controlled-assessment.ts',
  'server/modules/canonical-host/jobaid-overall-projection.ts',
  'server/modules/canonical-host/jobaid-problem-work.ts',
  'server/modules/canonical-host/automatic-work-item-dispatch.service.ts',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor.mjs',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs',
  'openclaw/codex-evaluator/codex-generation.mjs',
  'openclaw/codex-evaluator/run_codex_generation.py',
  'openclaw/codex-evaluator/miaoda_responses_bridge.py',
  'openclaw/codex-evaluator/preflight.mjs',
  'openclaw/codex-evaluator/check-host-contract.mjs',
  'openclaw/codex-evaluator/current-interface.test.mjs',
  'openclaw/codex-evaluator/contracts/host-source-interface.json',
  'openclaw/codex-evaluator/contracts/host-input-examples.json',
  'openclaw/codex-evaluator/contracts/runtime-configuration-status.json',
  'openclaw/skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs',
  'test/unit/codex-host-program-boundary.spec.ts',
  'scripts/export-host-codex-contract.mjs',
  'docs/openapi.json',
]);

/** Transpile the actual source without decorator type metadata: that metadata
 * otherwise loads runtime-only DI dependencies irrelevant to tool registration.
 * Source JS uses ESM with extensionless imports, so it receives the same local
 * CommonJS conversion. Nothing is edited and no compiled product is emitted. */
function loadSource(path) {
  const previousTs = require.extensions['.ts'];
  const previousJs = require.extensions['.js'];
  const previousResolve = Module._resolveFilename;
  const compile = (module, filename) => {
    loaded.add(relative(root, filename).split(sep).join('/'));
    const result = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, emitDecoratorMetadata: false, esModuleInterop: true, allowJs: true },
    });
    module._compile(result.outputText, filename);
  };
  require.extensions['.ts'] = compile;
  require.extensions['.js'] = (module, filename) =>
    ['server', 'shared'].some(folder => filename.startsWith(`${join(root, folder)}${sep}`))
      ? compile(module, filename) : previousJs(module, filename);
  Module._resolveFilename = function (request, parent, ...remaining) {
    if (request.startsWith('@shared/')) request = join(root, 'shared', request.slice(8));
    if (request.startsWith('@server/')) request = join(root, 'server', request.slice(8));
    return previousResolve.call(this, request, parent, ...remaining);
  };
  try { return require(join(root, path)); }
  finally {
    if (previousTs) require.extensions['.ts'] = previousTs;
    else delete require.extensions['.ts'];
    require.extensions['.js'] = previousJs;
    Module._resolveFilename = previousResolve;
  }
}

let businessHandlerCalls = 0;
const blockedProvider = new Proxy(Object.create(null), {
  get(_target, property) {
    return () => {
      businessHandlerCalls += 1;
      throw new Error(`OFFLINE_EXPORT_BUSINESS_HANDLER_FORBIDDEN:${String(property)}`);
    };
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('OFFLINE_EXPORT_NETWORK_FORBIDDEN'); };

async function listing(executor) {
  const { CanonicalHostOpenClawMcpService } = loadSource(
    'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts',
  );
  // All optional modules are present in the source module composition. Supplying
  // guarded providers includes their actual schemas, but cannot execute them.
  const service = new CanonicalHostOpenClawMcpService(...Array(20).fill(blockedProvider));
  const server = service.createServer(executor);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let initialize;
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message, ...options) => {
    if (message.result?.serverInfo) initialize = structuredClone(message);
    return send(message, ...options);
  };
  const client = new Client({ name: 'wiselink-offline-contract-export', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.ok(initialize?.result?.serverInfo, 'INITIALIZE_NOT_CAPTURED');
    assert.equal(initialize.result.serverInfo.name,
      executor === 'CODEX' ? 'wiselink-codex-engineering-assessment' : 'wiselink-openclaw-engineering-assessment');
    assert.equal(initialize.result.serverInfo.version, '1.2.0');
    return { initialize, tools };
  } finally { await client.close(); await server.close(); }
}

const outputs = new Map();
const add = (path, value) => outputs.set(path, json(value));

function declarations(path, names) {
  sourceFiles.add(path);
  const text = sourceText(path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return source.statements.filter(statement =>
    (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
    (!names || names.includes(statement.name.text)),
  ).map(statement => ({ name: statement.name.text, source: path,
    line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
    declaration: statement.getFullText(source).trim() }));
}

function errorLiterals(paths) {
  const records = [];
  for (const path of paths.filter(path => existsSync(join(root, path)))) {
    sourceFiles.add(path);
    const source = ts.createSourceFile(path, sourceText(path), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.arguments) {
        const expression = node.expression.getText(source);
        if (/Error$|(?:^|\.)(?:fail|policyError|scopeError|invalid|unavailable|conflict)$/u.test(expression)) {
          for (const argument of node.arguments) {
            if ((ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) &&
                /^[A-Z][A-Z0-9_:.-]+$/u.test(argument.text)) records.push({ code: argument.text,
              source: path, line: source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1 });
            else if (ts.isTemplateExpression(argument) && /^[A-Z][A-Z0-9_:.-]*$/u.test(argument.head.text))
              records.push({ codeTemplate: argument.getText(source), source: path,
                line: source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1 });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return records;
}

function normalizeSchema(value, annotationsRemoved = false, key = '') {
  if (Array.isArray(value)) {
    const items = value.map(item => normalizeSchema(item, annotationsRemoved));
    return ['required', 'enum', 'type', 'allOf', 'anyOf', 'oneOf'].includes(key)
      ? items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : items;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(name => !annotationsRemoved || !['$schema', '$comment', 'title', 'description', 'examples'].includes(name))
    .map(name => [name, normalizeSchema(value[name], annotationsRemoved, name)]));
}

function schemaDifferences(current, pinned, pointer = '') {
  if (JSON.stringify(current) === JSON.stringify(pinned)) return [];
  if (Array.isArray(current) && Array.isArray(pinned)) {
    const changes = [];
    for (let index = 0; index < Math.max(current.length, pinned.length); index += 1)
      changes.push(...schemaDifferences(current[index], pinned[index], `${pointer}/${index}`));
    return changes;
  }
  if (current && pinned && typeof current === 'object' && typeof pinned === 'object' &&
      !Array.isArray(current) && !Array.isArray(pinned))
    return [...new Set([...Object.keys(current), ...Object.keys(pinned)])].sort().flatMap(key =>
      schemaDifferences(current[key], pinned[key], `${pointer}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`));
  return [{ pointer: pointer || '/', current: current ?? { absent: true }, pinned: pinned ?? { absent: true } }];
}

function recoverySourceExpressions() {
  const fragments = [];
  for (const path of ['openclaw/codex-evaluator/codex-generation.mjs',
    'openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs']) {
    const source = ts.createSourceFile(path, sourceText(path), ts.ScriptTarget.Latest, true);
    const append = (name, node) => fragments.push({name, source:path,
      line:source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      expression:node.getText(source)});
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'codexReceipt')
        append('codexReceipt',node.initializer);
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'binding' &&
          path.endsWith('codex-generation.mjs')) append('generationBinding',node.initializer);
      if (ts.isCallExpression(node) && node.arguments.length > 1 && ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text === 'program-receipt-links') append('programReceiptLinks',node.arguments[1]);
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  return fragments;
}

try {
  const hosted = await listing('HOSTED');
  const codex = await listing('CODEX');
  assert.deepEqual(hosted.tools, codex.tools, 'EXECUTOR_TOOL_SCHEMAS_DIFFER');
  const { validateHostToolMetadata } = await import(pathToFileURL(join(root,
    'openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs')).href);
  validateHostToolMetadata(codex.tools);
  add('mcp/hosted.initialize.response.json', hosted.initialize);
  add('mcp/codex.initialize.response.json', codex.initialize);
  add('mcp/hosted.tools-list.json', hosted.tools);
  add('mcp/codex.tools-list.json', codex.tools);
  for (const tool of codex.tools.tools) add(`mcp/tools/${tool.name}.json`, tool);
  add('mcp/tool-index.json', {
    source: 'actual-source-registration-and-official-sdk-in-memory-tools-list',
    toolCount: codex.tools.tools.length,
    serverInfo: codex.initialize.result.serverInfo,
    toolVersionPolicy: 'No independent per-tool version is declared by these registrations. null is not the server version.',
    tools: codex.tools.tools.map(tool => ({ name: tool.name,
      metadataFile: `tools/${tool.name}.json`,
      toolVersion: tool.version ?? tool._meta?.version ?? null,
      outputSchemaDeclared: tool.outputSchema !== undefined,
      schemaDialect: tool.inputSchema?.$schema ?? null })),
  });

  const pinnedClient = JSON.parse(sourceText('openclaw/codex-evaluator/contracts/host-source-interface.json'));
  const pinnedRecords = {...pinnedClient.serverSource.tools, ...pinnedClient.serverSource.excludedToolSchemas};
  const clientComparison = Object.entries(pinnedRecords).map(([name, record]) => {
    const current = codex.tools.tools.find(tool => tool.name === name);
    assert.ok(current?.inputSchema, `CURRENT_SDK_SCHEMA_MISSING:${name}`);
    return { name, currentMetadataFile: `tools/${name}.json`, currentIndividualToolVersion: null,
      upstreamSchemaStatus: record.schemaStatus,
      upstreamUnresolvedDependencies: record.unresolvedDependencies ?? [],
      currentDependencyStatus: 'COMPLETE_SDK_INPUT_SCHEMA_AVAILABLE',
      completeUpstreamSchemaCompared: record.inputSchema !== undefined,
      ...(record.inputSchema ? {
        fullSchemaDifferences: schemaDifferences(normalizeSchema(current.inputSchema), normalizeSchema(record.inputSchema)),
        validationKeywordDifferences: schemaDifferences(normalizeSchema(current.inputSchema, true), normalizeSchema(record.inputSchema, true)),
      } : {}),
      semanticBoundary: 'Published JSONSchema is a complete SDK input-shape export; runtime Zod transformations/refinements and Host business authorization remain authoritative.',
    };
  });
  assert.equal(clientComparison.length, 42);
  add('mcp/client-94c54de-comparison.json', {
    upstreamCommit: '94c54de74a0d7a0c0d66778a04a161e2017fce28',
    upstreamParent: 'fc1322919b1b52433c33086c8db4aeb957f0e982',
    upstreamArtifactPath: 'openclaw/codex-evaluator/contracts/host-source-interface.json',
    upstreamArtifactBoundary: pinnedClient.serverSource.identityStatus,
    currentSdkTools: codex.tools.tools.length, upstreamInventoriedNames: clientComparison.length,
    upstreamMechanicalInputSchemas: clientComparison.filter(item => item.completeUpstreamSchemaCompared).length,
    upstreamSourceOnlyNames: clientComparison.filter(item => !item.completeUpstreamSchemaCompared).map(item => item.name),
    additionalCurrentTools: codex.tools.tools.filter(tool => !Object.hasOwn(pinnedRecords,tool.name))
      .map(tool => ({name:tool.name, currentMetadataFile:`tools/${tool.name}.json`})),
    summary: {
      validationKeywordEqualNames: clientComparison.filter(item => item.completeUpstreamSchemaCompared &&
        item.validationKeywordDifferences.length === 0).map(item => item.name),
      validationKeywordDifferenceNames: clientComparison.filter(item => item.completeUpstreamSchemaCompared &&
        item.validationKeywordDifferences.length > 0).map(item => item.name),
    },
    currentVerifier: 'node openclaw/codex-evaluator/check-host-contract.mjs --current-interface',
    comparisonNote: 'Annotation/dialect fields are omitted only in validationKeywordDifferences; required/enum/union order is normalized. Differences are reported, not silently declared acceptance-equivalent. No tool-list copy or new runtime contract is created.',
    tools: clientComparison,
  });

  const api = JSON.parse(sourceText('docs/openapi.json'));
  const paths = Object.fromEntries(Object.entries(api.paths).filter(([path]) =>
    /^\/openapi\/wiselink\/(?:(?:openclaw|codex)-mcp|(?:codex-)?(?:next-work-item|ack-work-item|block-work-item|apply-pending-model-configuration))$/u.test(path),
  ));
  for (const path of ['/openapi/wiselink/codex-mcp', '/openapi/wiselink/codex-next-work-item',
    '/openapi/wiselink/codex-ack-work-item', '/openapi/wiselink/codex-block-work-item',
    '/openapi/wiselink/codex-apply-pending-model-configuration']) assert.ok(paths[path], `OPENAPI_PATH_MISSING:${path}`);
  add('rest/openapi.paths.json', { paths });

  const typeRecords = [
    ...declarations('server/modules/action-attempt/action-attempt-envelope.types.ts'),
    ...declarations('server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.ts',
      ['BeginDynamicEvaluationResult', 'CommitDynamicEvaluationResult']),
    ...declarations('server/modules/canonical-host/canonical-jobaid-problem.service.ts', ['BeginJobAidProblemResult']),
    ...declarations('server/modules/canonical-host/jobaid-problem-task.ts',
      ['JobAidSourceBinding', 'JobAidProblemModelInput', 'JobAidProblemModelWorkContent', 'JobAidProblemTaskInput']),
    ...declarations('shared/api.interface.ts', ['AutomaticWorkItemClaimResult', 'NextAutomaticWorkItemRequest',
      'AcknowledgeAutomaticWorkItemRequest', 'AcknowledgeAutomaticWorkItemResponse', 'BlockAutomaticWorkItemRequest',
      'AutomaticWorkItemCancellationBinding', 'BlockAutomaticWorkItemResponse', 'CanonicalExecutionModelSelection']),
    ...declarations('shared/jobaid-problem-assessment.interface.ts'),
    ...declarations('shared/document-original.interface.ts'),
    ...declarations('shared/assessment-reading.interface.ts'),
    ...declarations('server/modules/canonical-host/canonical-host-executor-policy.ts'),
  ];
  add('types/source-declarations.json', { format: 'unmodified-typescript-type-declarations',
    note: 'These are exact source declarations, not generated JSONSchema or a new wire protocol. Imported type references retain their original names.',
    declarations: typeRecords });
  add('types/consumer-recovery-source.json', {
    format:'actual-source-object-expressions',
    note:'Current consumer-local receipt objects, not a new Host API/schema or proof of real execution. Runtime paths and secret values are not included.',
    fragments:recoverySourceExpressions(),
  });

  add('errors/source-catalog.json', { format: 'source-error-codes-and-templates',
    note: 'Exact throw/helper error literals from the listed sources. Not all errors have a dedicated HTTP status or reach every endpoint; no business call was made to synthesize a failure.',
    errors: errorLiterals([
      'server/modules/canonical-host/canonical-host-executor-policy.ts',
      'server/modules/canonical-host/canonical-service-scope.authorization.ts',
      'server/modules/canonical-host/configured-development-service-scope.authorization.ts',
      'server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.ts',
      'server/modules/canonical-host/canonical-jobaid-problem.service.ts',
      'server/modules/canonical-host/jobaid-work.repository.ts',
      'server/modules/canonical-host/program-assessment-materials.ts',
      'server/modules/canonical-host/program-controlled-assessment.ts',
      'server/modules/canonical-host/automatic-work-item-dispatch.service.ts',
      'server/modules/canonical-host/canonical-host-openclaw-runtime-policy.ts',
      'server/modules/action-attempt/action-attempt-envelope.ts',
      'server/modules/action-attempt/action-attempt-lifecycle.service.ts',
      'openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs',
      'openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor.mjs',
      'openclaw/codex-evaluator/codex-generation.mjs',
    ]) });

  const settingSources = [
    'server/modules/canonical-host/canonical-host-executor-policy.ts',
    'server/modules/canonical-host/configured-development-service-scope.authorization.ts',
    'server/modules/canonical-host/automatic-work-item-dispatch.service.ts',
    'server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.ts',
    'server/modules/canonical-host/canonical-host-openclaw-runtime-policy.ts',
  ];
  const suffixes = [...new Set(settingSources.flatMap(path =>
    [...sourceText(path).matchAll(/canonicalExecutorSetting\('([A-Z_]+)'\)/gu)].map(match => match[1]),
  ))].sort();
  add('configuration/source-names.json', {
    source: 'literal canonicalExecutorSetting suffixes in the current production sources',
    selector: { name: 'WL_MODEL_EXECUTOR', accepted: ['HOSTED', 'CODEX'], defaultWhenAbsent: 'HOSTED' },
    codexRuntimeIdentity: { name: 'WL_CODEX_RUNTIME_APP_ID', required: true,
      valuePattern: '^app_[a-z0-9]+$', valuesExported: false },
    scopeSettings: suffixes.map(suffix => ({ suffix,
      codexName: `WL_CODEX_${suffix}`, hostedName: `WL_OPENCLAW_${suffix}` })),
    directEnvironmentNames: [...new Set(settingSources.flatMap(path =>
      [...sourceText(path).matchAll(/process\.env\.(WL_(?:CODEX|OPENCLAW|MODEL)_[A-Z_]+)/gu)].map(match => match[1]),
    ))].sort(),
    relatedFeatureFlagNames: ['WL_JOBAID_PROBLEM_V2_ENABLED', 'WL_TRANSLATION_V2_ENABLED'],
    prefixFallback: false,
    runtimeConsumerOptions: ['modelExecutor', 'hostMcpUrl', 'headers', 'codexOptions.codexBinary',
      'codexOptions.configPath', 'codexOptions.runRoot', 'codexOptions.pythonBinary',
      'codexOptions.reasoningEffort', 'codexOptions.maxOutputTokens', 'codexOptions.timeoutSeconds'],
    note: 'A listed optional scope name is not a request to enable that scope. Presence never proves value correctness or current authorization.',
  });
  add('configuration/runtime-identity.json', {
    source: 'Host executor policy, service-scope authorization and existing Task/Result validators; rollout target supplied by the coordinator',
    activeSelector: 'WL_MODEL_EXECUTOR', codexSelectorValue: 'CODEX',
    mcpServerInfo: codex.initialize.result.serverInfo,
    runtimeKind: 'CODEX', runtimeAppSetting: 'WL_CODEX_RUNTIME_APP_ID',
    approvedTargetRuntimeAppId: 'app_17gr74pbere',
    runtimeAppConfigurationValueVerified: false,
    legacyRuntimeAppIdRejectedForCodex: true,
    independentPrincipalRequired: true, exactNewWorkItemAndIntakeRequired: true,
    firstRolloutBusiness: 'PROGRAM_CONTROLLED_V1_INITIAL_ASSESSMENT',
    unsupportedCodexBusiness: ['APPLICABILITY', 'REVIEW', 'PENDING_REVIEW_DISCOVERY', 'SUCCESSOR_REVIEW_OVERALL'],
    unsupportedError: {code:'CANONICAL_CODEX_OPERATION_NOT_SUPPORTED', statusCode:403},
    retainedWireNames: ['wiselink.3_1.openclaw_task_envelope.v1',
      'wiselink.3_1.openclaw_result_envelope.v1', 'OPENCLAW_DYNAMIC_EVALUATION',
      'wiselink-openclaw-engineering-assessment'],
    retainedWireServiceVersion: '1.2.0',
    retainedSharedAppLiteralMeaning: 'Historical sealed wire/provenance field; not the new runtime registration identity.',
    discovery: 'CODEX source is accepted; missing historical runtimeAppId is not populated from current configuration.',
    deployedOrAuthenticated: false,
  });

  for (const path of loaded) sourceFiles.add(path);
  const recordedSources = [...sourceFiles].filter(path => existsSync(join(root, path))).sort()
    .map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  assert.equal(businessHandlerCalls, 0, 'BUSINESS_HANDLER_EXECUTED');
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const recordedHead = checkOnly
    ? JSON.parse(await readFile(join(out, 'source-manifest.json'), 'utf8')).sourceHead : currentHead;
  // This documents the export's ancestry. The actual source-file bytes are the
  // comparison below; committing the package must not create a self-hash loop.
  if (checkOnly) execFileSync('git', ['merge-base', '--is-ancestor', recordedHead, currentHead], { cwd: root });
  add('source-manifest.json', {
    sourceHead: recordedHead,
    scope: 'local-working-source-including-uncommitted-executor-transition',
    exportMethod: 'TypeScript transpile in memory; actual production createServer; official SDK InMemoryTransport initialize and tools/list',
    networkAccessed: false, hostBusinessHandlersCalled: businessHandlerCalls,
    environmentOrCredentialValuesExported: false, deploymentVerified: false,
    optionalProviders: 'guarded-present: exports the full source-registered module surface; not a claim that every runtime scope is configured',
    perToolVersionInvented: false,
    files: recordedSources,
  });

  for (const [path, bytes] of outputs) {
    const destination = join(out, path);
    if (checkOnly) assert.equal(await readFile(destination, 'utf8'), bytes, `EXPORT_STALE:${path}`);
    else { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); }
  }
  process.stdout.write(`${JSON.stringify({ status: checkOnly ? 'VERIFIED' : 'EXPORTED',
    tools: codex.tools.tools.length, machineFiles: outputs.size, hostBusinessHandlersCalled: businessHandlerCalls,
    networkAccessed: false, perToolVersionInvented: false })}\n`);
} finally { globalThis.fetch = originalFetch; }
