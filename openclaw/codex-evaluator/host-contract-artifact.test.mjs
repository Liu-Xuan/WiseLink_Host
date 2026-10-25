import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const check=fileURLToPath(new URL('./check-host-contract.mjs',import.meta.url));
const source=JSON.parse(await readFile(new URL('./contracts/host-source-interface.json',import.meta.url),'utf8'));
const cases=JSON.parse(await readFile(new URL('./contracts/host-zod-validation-cases.json',import.meta.url),'utf8'));
async function altered(mutateContract,mutateCases) {
  const dir=await mkdtemp(join(tmpdir(),'wiselink-schema-evidence-'));
  try {
    const contract=structuredClone(source), evidence=structuredClone(cases);
    mutateContract?.(contract); mutateCases?.(evidence);
    const cp=join(dir,'contract.json'), ep=join(dir,'cases.json');
    await writeFile(cp,JSON.stringify(contract)); await writeFile(ep,JSON.stringify(evidence));
    return spawnSync(process.execPath,[check,cp,ep],{encoding:'utf8'});
  } finally { await rm(dir,{recursive:true,force:true}); }
}

test('exported real-Zod schema and validation evidence remain linked',async()=>{
  const result=await altered();
  assert.equal(result.status,0,result.stderr);
});

test('a permissive replacement schema is rejected even with unchanged passing-case counts',async()=>{
  const result=await altered(contract=>{
    contract.serverSource.tools.translation_workspace.inputSchema={};
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/pinned-zod-schema-evidence-mismatch:translation_workspace/u);
});

test('weakening a nested bound is rejected against the real-Zod export evidence',async()=>{
  const result=await altered(contract=>{
    const schema=contract.serverSource.tools.document_reading.inputSchema;
    const read=schema.oneOf.find(value=>value.properties.action.const==='READING_READ');
    read.properties.limit.maximum=5000;
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/pinned-zod-schema-evidence-mismatch:document_reading/u);
});

test('editing a negative case while retaining its count invalidates validation evidence',async()=>{
  const result=await altered(null,evidence=>{
    evidence.tools.translation_workspace.rejected[0].input={phase:'READ'};
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/pinned-zod-cases-evidence-mismatch:translation_workspace/u);
});
