import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

test('generated rebuild resolver remains byte-for-byte synchronized with its shared TypeScript',()=>{
 const require=createRequire(import.meta.url),ts=require('typescript');
 const source=readFileSync(new URL('../../shared/document-activity-quote-selection.ts',import.meta.url),'utf8');
 const expected='// Rebuild implementation generated from shared/document-activity-quote-selection.ts.\n'+ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'document-activity-quote-selection.ts'}).outputText;
 assert.equal(readFileSync(new URL('../../openclaw/skills/wiselink-research-and-synthesize/scripts/resolve-document-activity-quote-selection.mjs',import.meta.url),'utf8'),expected);
});
