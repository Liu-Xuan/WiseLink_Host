# Phase 9 hosted Boeing 737 Assessment acceptance

Date: 2026-08-16 (Asia/Shanghai)  
Application: `app_17bzc551rsg` (`WiseLink 3.1｜工程资料与综合评估`)  
Environment: authenticated DEV only

## Result

The first hosted Boeing SB vertical completed on one ordinary WorkItem:

`FileService selection → DM immutable DocumentVersion → WorkItem → frozen.2 package → U0 full Validator → Unified Reader → Job Aid N=150 candidate → one engineer deferred review → explicit resynthesis → same Miaoda page`.

- Source: `737-34-3830 Original.pdf`, 1,060,204 bytes,
  `sha256:add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a`.
- SourceArtifact: `source_artifact_602810a8fe9c2b682f71fade`; provider object/version
  `1873632780655707`; actual-byte readback PASS.
- DocumentVersion: `document_version_f4813607b91ee1a20e754e2d`, `DATE:2026-05-13`,
  `COMMITTED_IMMUTABLE`.
- WorkItem: `WI-9fd1dd58-c7ed-4889-bc67-9a5d3bfbd52e`.
- Parsed package: `urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d`;
  raw artifact SHA-256 `84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac`;
  273,349 bytes; frozen.2 full strict Validator PASS.
- Reader: 75 content units / 76 SourceRefs; `applicability` query returned 38 source-bound rows.
- Evaluate: `ATT-d22e0cbd-8109-40d4-9176-6f7ca8d1e61a`; WorkItem revision 3→4;
  150 criteria; `CANDIDATE_ONLY / BLOCKED_MISSING_INPUT / 待核实`.
- Evaluate artifact: SHA-256 `63df6c4d5b5de01f97afe5a42332fb052b944e00c8f02a18dfa9e8fe85b83918`,
  2,568,260 bytes; actual-byte readback PASS.
- Engineer change: `APP-001`, decision `deferred`, status `NEEDS_REVIEW`; actor came from
  the authenticated server context.
- Resynthesis: `ATT-607f98a9-a2d0-401b-9515-9bd5e6059654`; WorkItem revision 4→5;
  `CANDIDATE_ONLY_RESYNTHESIZED`, `ENGINEER_ITEM_SET_CHANGED`, previous overall stale.
- Resynthesis artifact: SHA-256 `33fa0888b8b1756b4fdfdfbd849dddc97edc93e938e558cbb53015f16481df22`,
  2,570,655 bytes; actual-byte readback PASS. The cumulative snapshot contains the authenticated
  engineer review on `APP-001`.

The final database counts are exactly two rows in each of the seven DM tables and `work_item`, and
four `action_attempt` rows. FileService contains 11 immutable objects. The prior FTD WorkItem remains
present and unchanged.

## Releases and traces

- closed baseline release: `7674392290617871296`, commit `559454761b80aaeadc27d239bc22e8e4a92eed54`;
- one-shot fixed-input parse release: `7674390040353770444`, commit
  `77a59cf8e433ed8fde2f054c164a486f28dc005e`;
- closure release: `7674400466549246906`, commit
  `04a5e108394f6e46ab01f621d17083fdd636acec`, status `finished`, no release errors.

The temporary fixed-input parse button was removed before Assessment actions. No parse request was retried.
Relevant traces include parse `f3cae7bda0dc73e36e78d5bdea7655bc`, evaluate
`6074eec1db4d1eac15d945d315bab631`, resynthesis `2f8162a65ec373cd31f4af44bd9e466d`,
and final page fresh-read `1dd066b2c81c43a6839ffe16c95c5595`.

## Follow-up findings

1. Assessment CAS was observed rewriting the already completed primary `PARSE_PDF` ActionAttempt timestamps.
   The local follow-up makes primary-attempt synchronization explicit and disables it for Assessment-only CAS;
   targeted and full ordinary tests cover this without adding a gate or contract.
2. The active OpenAPI Key scope is correctly limited to the three fixed GET paths. A safe existing secret
   reference was not found in project documentation or runtime environment metadata. The three Bearer calls
   therefore remain `READONLY_KEY_SECRET_REFERENCE_NOT_FOUND`; the key was not reset, recreated, broadened,
   logged, or guessed. The authenticated Miaoda page itself completed a server fresh-read of the same WorkItem.

## Non-claims

- No production/current switch, public/tenant scope expansion, Assessment/AEO auto-adoption, Aily publish,
  OpenClaw invocation, applicability decision, engineering closure, or airworthiness conclusion occurred.
- The local ActionAttempt audit fix is not published in this acceptance record.
- The three fixed Bearer GET calls are not claimed as executed.
