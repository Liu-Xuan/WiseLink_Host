import { isCanonicalHostOpenClawSkillVersionCompatible } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';

describe('canonical Host OpenClaw Skill compatibility', () => {
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
