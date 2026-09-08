import { assertCanonicalHostOpenClawRuntimePolicy, isCanonicalHostOpenClawSkillVersionCompatible } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';

describe('canonical Host OpenClaw Skill compatibility', () => {
  it('requires the semantic translation runtime even when final assembly reuses saved blocks', () => {
    const task = { taskType: 'OPENCLAW_TRANSLATE', modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2' } } as never;
    const result = { modelVersion: 'host-assembly/no-model-call', skillVersion: 'wiselink-research-and-synthesize@r09.c44',
      promptVersion: 'wiselink-translation-block@r09.c44', toolVersions: { 'wiselink-openclaw-engineering-assessment': '1.2.0' } };
    expect(() => assertCanonicalHostOpenClawRuntimePolicy(result as never, task)).not.toThrow();
    expect(() => assertCanonicalHostOpenClawRuntimePolicy({ ...result, skillVersion: 'wiselink-research-and-synthesize@r09.c43' } as never, task))
      .toThrow('OPENCLAW_TRANSLATION_V2_RUNTIME_POLICY_MISMATCH');
    expect(() => assertCanonicalHostOpenClawRuntimePolicy({ ...result, promptVersion: 'legacy-translation' } as never, task))
      .toThrow('OPENCLAW_TRANSLATION_V2_RUNTIME_POLICY_MISMATCH');
  });

  it.each([
    'wiselink-research-and-synthesize@r09.c10',
    'wiselink-research-and-synthesize@r09.c11',
    'wiselink-research-and-synthesize@r09.c99',
  ])('accepts a compatible r09 package revision: %s', (version) => {
    expect(isCanonicalHostOpenClawSkillVersionCompatible(version)).toBe(true);
  });

  it.each([
    'wiselink-research-and-synthesize@r09.c9',
    'wiselink-research-and-synthesize@r09.c8',
    'wiselink-research-and-synthesize@r09.c09',
    'wiselink-research-and-synthesize@r09',
    'wiselink-research-and-synthesize@r10.c9',
    'another-skill@r09.c11',
  ])('rejects an incompatible or malformed package revision: %s', (version) => {
    expect(isCanonicalHostOpenClawSkillVersionCompatible(version)).toBe(false);
  });
});
