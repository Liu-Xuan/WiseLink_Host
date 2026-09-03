import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectPublishLiteSource } from '../../scripts/package-wiselink-openclaw-skill.mjs';

test('aligns the Host, packaged Skill, interface prompt, and fixtures', async () => {
  const source = await inspectPublishLiteSource();

  assert.equal(source.slug, 'wiselink-research-and-synthesize');
  assert.equal(source.version, 'wiselink-research-and-synthesize@r09.c11');
  assert.equal(source.compatibilityRef, 'wiselink-research-and-synthesize@r09');
  assert.equal(
    source.minimumCompatibleSkillVersion,
    'wiselink-research-and-synthesize@r09.c10',
  );
  assert.equal(source.fileCount, 19);
  assert.ok(source.claims.some(({ path }) => path === 'agents/openai.yaml'));
});
