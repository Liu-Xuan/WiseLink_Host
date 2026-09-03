import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  inspectPublishLiteSource,
  writeDeterministicSkillArchive,
} from '../../scripts/package-wiselink-openclaw-skill.mjs';

test('aligns the Host, packaged Skill, interface prompt, and fixtures', async () => {
  const source = await inspectPublishLiteSource();

  assert.equal(source.slug, 'wiselink-research-and-synthesize');
  assert.equal(source.version, 'wiselink-research-and-synthesize@r09.c12');
  assert.equal(source.compatibilityRef, 'wiselink-research-and-synthesize@r09');
  assert.equal(
    source.minimumCompatibleSkillVersion,
    'wiselink-research-and-synthesize@r09.c10',
  );
  assert.equal(source.fileCount, 20);
  assert.ok(source.claims.some(({ path }) => path === 'agents/openai.yaml'));
});

test(
  'writes byte-identical archives across different wall-clock timestamps',
  { timeout: 15_000 },
  async () => {
    const outputDirectory = await mkdtemp(
      join(tmpdir(), 'wiselink-skill-publish-lite-'),
    );
    const firstArchive = join(outputDirectory, 'first.zip');
    const secondArchive = join(outputDirectory, 'second.zip');

    await writeDeterministicSkillArchive({ archivePath: firstArchive });
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await writeDeterministicSkillArchive({ archivePath: secondArchive });

    assert.deepEqual(
      await readFile(firstArchive),
      await readFile(secondArchive),
    );
  },
);
