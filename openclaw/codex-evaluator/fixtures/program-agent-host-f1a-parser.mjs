// Test-only loader of exact public f1a pure functions. It does not start a Host
// service or replace its policy/material validators with a Native mock.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vm from 'node:vm';
import * as crypto from 'node:crypto';

const hashes = {
  'server/modules/canonical-host/program-agent-policy.ts': '8eb98a87bd6bb21f24b12174455b4f3a2d9ac62c2dbbd12d09acbcb443442adc',
  'server/modules/canonical-host/program-assessment-materials.ts': 'fbd471d8641bed7e622d6c83b6303cebedcf0ab69d8a3da674c435e2c90cb543',
  'server/modules/action-attempt/action-attempt-envelope.ts': 'e8bdf3ec5ad794e3cba9b9276110ff74795ca9e96955edfec6f2861fda25e286',
  'server/modules/model-settings/canonical-execution-model.ts': '590e3bd5b029cb173fc425b07cdbefbc4be682dbc16edb8160953c25d22b4622',
  'server/modules/model-settings/canonical-model-output-budget.ts': '6cbf8cb391d3681eaed19e059d7e620a6112ce26bf90778eb32adfff4514ca33',
};

export async function loadExactHostMaterialParser() {
  const root = process.env.WISELINK_HOST_F1A_SOURCE_ROOT;
  const zodRoot = process.env.WISELINK_HOST_F1A_ZOD_ROOT;
  assert.ok(root && zodRoot, 'exact Host source and its pinned Zod are required');
  assert.equal(JSON.parse(await readFile(join(zodRoot, 'package.json'), 'utf8')).version, '4.6.5');
  const zod = await import(pathToFileURL(join(zodRoot, 'index.js')));
  const cache = new Map();
  const synthetic = (id, exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier: id });
  const load = async id => {
    if (cache.has(id)) return cache.get(id);
    const pending = (async () => {
      if (id === 'zod/v4') return synthetic(id, { z: zod.z });
      if (id === 'node:crypto') return synthetic(id, crypto);
      // Only uncalled controlled-mode evidence projection and error creation
      // are isolated. Actual f1a agent policy, selection, canonical hashing
      // and material comparison code below are executed without rewriting.
      if (id.endsWith('/overall-assessment-reading.ts')) return synthetic(id, {
        overallModelEvidenceRegistry: () => { throw new Error('CONTROLLED_HOST_PROJECTION_NOT_IN_SCOPE'); } });
      if (id.endsWith('/canonical-model-catalog.ts')) return synthetic(id, {
        canonicalModelError: code => new Error(code) });
      const relative = Object.keys(hashes).find(path => resolve(root, path) === id);
      assert.ok(relative, `unexpected Host import: ${id}`);
      const bytes = await readFile(id);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hashes[relative]);
      return new vm.SourceTextModule(stripTypeScriptTypes(bytes.toString(), { mode: 'strip' }), { identifier: id });
    })();
    cache.set(id, pending); return pending;
  };
  const module = await load(resolve(root, 'server/modules/canonical-host/program-assessment-materials.ts'));
  await module.link((specifier, importer) => load(specifier.startsWith('.')
    ? resolve(dirname(importer.identifier), specifier + '.ts') : specifier));
  await module.evaluate();
  return module.namespace.parseProgramMaterialSnapshot;
}
