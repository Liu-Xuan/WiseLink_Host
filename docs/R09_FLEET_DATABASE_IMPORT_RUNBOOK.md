# R09 FleetMasterData database import

This runbook restores the approved WiseLink 0.10 Fleet authority snapshot into
the WiseLink 3.1 Miaoda PostgreSQL owner. It does not deploy the app, read a
legacy file at product runtime, or create any aircraft configuration fact.

## Inputs and boundaries

- Migration source contract:
  `config/0_10/fleet-master-data-authority-migration.json` in the controlled
  WiseLink authority repository.
- Immutable source: the exact legacy Object Layer export named by that
  contract. Its SHA-256 must equal the contract value.
- Checked-in runtime import assets:
  `config/fleet-master-data/ameco-fleet-20260605/`.
- Expected rows: 587 aircraft assets, 2579 identity aliases, and 0
  configuration facts.
- Only an approved database migration/service owner may import. The
  `authenticated` browser role remains read-only and tenant-scoped by RLS.

## Offline generation/readback

Run this only in the controlled migration workspace, never in the deployed
application runtime:

```sh
node scripts/generate-canonical-fleet-master-data-assets.mjs \
  --contract /approved/WiseLink/config/0_10/fleet-master-data-authority-migration.json \
  --source /approved/WiseLink-v9-v91-legacy/data/wiselink/runtime/ftd-05282026-mainline-reports/2026-06-05T20-28-49-064Z/object-layer.json
```

The generator fails if the source hash/counts drift, if an alias is orphaned,
or if the source contains any `AircraftConfigSnapshot`. Verify that every
generated file is at most 1 MiB and 5000 lines. Review the generated diff; the
source snapshot ID and Fleet digest must remain the values in `manifest.json`.

## DEV/UAT database procedure

1. Confirm the target is the intended WiseLink 3.1 DEV/UAT Miaoda database and
   that migrations `0001` through `0010` are already present.
2. Apply `migrations/0011_canonical_fleet_master_data.sql` once using the
   approved database owner. Read back all five `canonical_fleet_%` tables and
   their RLS policies using the queries at the end of the migration.
3. Put the database URL in the runner environment only. Do not pass or print a
   credential on the command line.
4. Preview, apply, and immediately replay the import:

```sh
node scripts/import-canonical-fleet-master-data.mjs --tenant-id TARGET_TENANT
CANONICAL_FLEET_IMPORT_DATABASE_URL='postgresql://…' \
  node scripts/import-canonical-fleet-master-data.mjs \
  --tenant-id TARGET_TENANT --apply
CANONICAL_FLEET_IMPORT_DATABASE_URL='postgresql://…' \
  node scripts/import-canonical-fleet-master-data.mjs \
  --tenant-id TARGET_TENANT --apply
```

The first result must be `applied`; the replay must be `idempotent_replay`.
Both must read back 587/2579/0 and authority revision 1. A later source change
requires the exact current head through
`--expected-current-source-snapshot-id`; otherwise the importer fails closed.

5. As the application browser role, set the normal Host user context and verify
   same-tenant SELECT succeeds, other-tenant rows are invisible, and INSERT,
   UPDATE, and DELETE are denied.
6. Through the OAuth Host API, PUT a real controlled identifier such as
   `B-1266` and an as-of date on the current WorkItem, then GET it back. The
   public read model must show the Fleet source revision/authority revision but
   no locator, credential, actor ID, tenant ID, record hash, or internal source
   record ID.

## Expected applicability result

`B-1266` resolves from the imported authority to `B777-39L`, series
`B777-300`, MSN `65300`. The snapshot contains no
`equipmentModelInstalled=AIMS-2` fact. The existing property registry therefore
normalizes the qualifier to `AIMS2`, and the existing Kleene evaluator returns
`UNKNOWN` with a `fact_unknown` blocker. No default, inference, or model output
may turn that absence into a configuration fact.

The existing overall synthesis owner does not require a current applicability
candidate before producing a candidate-only preliminary overall result. It can
carry `UNKNOWN/WAITING_INPUT`, conditions, risks, and missing inputs while the
other INITIAL_ANALYSIS lanes proceed.

## Host begin handoff dependency

The DB-backed selection/provider and the existing Kleene evaluation return the
correct `fact_unknown`; no 503 or wrong-aircraft fallback remains after import.
However, `CanonicalHostOpenClawApplicabilityService.buildTaskContract` currently
adds Host missing inputs at begin only for Fleet asset resolution failures and
conflicts. It does not yet evaluate the frozen.2 deterministic
`normalizedCandidates` before the model candidate exists. The narrow successor
is confined to
`server/modules/canonical-host/canonical-host-openclaw-applicability.service.ts`
plus its existing unit test: read the already-produced normalized candidate,
translate it to the existing registry AST shape, call
`evaluateApplicabilityFragmentSetWithTrace`, and append only its
`fact_unknown` values to `hostResolvedMissingInputs`. It must not add a parser,
evaluator, store, schema, or model-derived fact.
