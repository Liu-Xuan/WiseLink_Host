# WiseLink 3.1 TranslationRuleSet V1 private migration

Status: CANDIDATE_ONLY / PRIVATE_NOT_WIRED / G3_NOT_COMPLETE.

This slice is derived from exact canonical Host release
9c61eab81f22e5b20a70265ccd2263d165416516 on branch
codex/wl31-translation-v1-private-20260826. R08 cloud contract
MA3fdjEycoISjHxptAqcsyxvn9b was fresh-read in full at revision 613 on
2026-08-26.

## Successor lineage audit

The requested successor reference efffd749b2fc695da92fdebc588115407b4a50b6
exists and is the parent of the current clean successor worktree HEAD
c7eb033c0beffb6fe765100ba1b4f310f59575a8. The lineage is:

- 92b1bd9f6: versioned rule selection and deterministic validation;
- 2cd7f66e0: owner SourceUnit row identity/integrity guards;
- 66c920e44: runtime malformed-row fail-closed guards;
- efffd749b: exact SourceRef sets, currentness binding, engineer revision
  metadata;
- c7eb033c0: exact rule id/version pair, private result contract, full
  engineer binding, regex and numeric-multiset cleanup for R08 rev613.

That successor diverges from the current release at merge-base
77f2a56d4eacecd31e4a501630ee5fe3985fb25a; it was not cherry-picked.
Only the listed semantics were migrated onto exact 9c61eab.

## Semantics migrated

1. Canonical private translation contract:
   - Host-frozen SourceUnits;
   - exact rule identity (rulePackId, rulePackVersion);
   - private task and result runtime contracts;
   - deterministic omission/addition, terminology/no-translate, identifier,
     signed numeric multiset, unit, ATA, part-number, citation, table parity,
     exact SourceRef-set, currentness, and engineer-revision validation;
   - malformed or mixed-type arrays, duplicate source/candidate keys, invalid
     regexes, missing bindings, and unknown identities reject without fallback.
2. Host-owned V1 TranslationRuleSet asset:
   - rules are concrete data, not prompt-only instructions;
   - recursively frozen at runtime;
   - independently versioned as exact id
     wiselink.host.translation-rules.zh-cn.v1 plus version 1.0.0;
   - explicit en / en-US / en-GB to zh-CN selection;
   - the narrow private provider returns only that exact tuple and never
     selects a default.
3. Reader SourceUnit row guards:
   - rows required when translation-required units exist;
   - exact nonblank row identities and SourceRef fields;
   - unique unit keys and recognized translated/pending state;
   - row totals must equal owner aggregate counts;
   - malformed runtime shapes fail closed without throwing.
4. Currentness and engineer revision:
   - reuse the existing CanonicalTranslationConsumptionBinding as the only
     currentness identity;
   - compare document/revision/SBD/TCP package and content identity field by
     field;
   - any rule/source/revision drift rejects or marks the engineer revision
     stale; no new hash, fence, baseline, gate, or currentness owner exists.

## Explicitly retired or not migrated

- 0.11/0.10 LLM runtime, gateway, provider, transport, owner service, secret,
  and cross-runtime currentness;
- prompt-only rules and implicit/default rule selection;
- any second translation DB, currentness table, FileService, queue, or owner;
- browser/Workbench rendering and shared API changes.

## Serial wiring checklist

1. Shared owner freezes the durable TRANSLATE ActionAttempt input using exact
   SourceUnits, the selected V1 rule asset, and
   CanonicalTranslationConsumptionBinding.
2. OpenClaw execution adapter maps that private task into the existing shared
   TaskEnvelope; model/provider choice remains OpenClaw configuration.
3. Shared ResultEnvelope owner embeds or maps the private
   TranslationResultContract without widening untrusted fields.
4. Host ResultGate runs validateTranslationResultContract, then persists an
   immutable candidate artifact and uses the existing CAS/current projection.
5. ReviewAction owner records engineer corrections and invalidates affected
   candidates on source, rule version, or correction currentness drift.
6. Reader/Workbench owner projects exact validated rows and both consumption
   axes through the existing shared API, then runs a real Hosted
   DocumentVersion → ActionAttempt → OpenClaw → ResultGate/CAS readback.

Every step is serial because it touches shared module/API/ActionAttempt/DB or
UI ownership outside this private slice.

## Non-claims

- No canonical-host.module.ts, shared/API, ActionAttempt, DB schema,
  Reader/Workbench frontend, or OpenClaw configuration change.
- No real provider, LLM, OpenClaw, Hosted DB/FileService, browser, or end-user
  execution.
- No production observation, deployment, push, release, G3 completion,
  engineering approval, airworthiness approval, or current switch.
- Unit tests and build evidence prove only this private deterministic slice.
