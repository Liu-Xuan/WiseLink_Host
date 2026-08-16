import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runPhase6dAeoSameWorkItemLoop } from './run-phase6d-aeo-same-workitem.mjs';

const workItemId = 'WI-9fd1dd58-c7ed-4889-bc67-9a5d3bfbd52e';
const workItemRows = JSON.parse(
  await readFile('/private/tmp/wiselink-phase10-work-item-export.json', 'utf8'),
);
const row = workItemRows.find(
  (candidate) => candidate.work_item_id === workItemId,
);
assert.ok(row?.projection_json, 'PHASE10_WORKITEM_PROJECTION_REQUIRED');

const result = await runPhase6dAeoSameWorkItemLoop({
  phase10Hosted: true,
  canonicalWorkItem: JSON.parse(row.projection_json),
  assessmentActualBytes: await readFile(
    '/private/tmp/wiselink-phase10-hosted-assessment.json',
  ),
  sourceParsedPackageActualBytes: await readFile(
    '/private/tmp/wiselink-phase10-hosted-frozen2.json',
  ),
  fast62Bytes: null,
});

assert.equal(result.workItemId, workItemId);
assert.deepEqual(result.stateVersionTransition, [5, 9]);
assert.equal(result.explicitDispositions.length, 1);
assert.equal(result.explicitDispositions[0].usage, 'ADOPT');
assert.equal(result.word.ooxmlZipSignature, 'PK');
assert.equal(result.automaticallyAdopted, false);
assert.equal(result.engineeringApproved, false);
assert.equal(result.onlineWrites, 0);

process.stdout.write(`${JSON.stringify(result)}\n`);
