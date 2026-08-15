# Local owner refresh acceptance — 2026-08-14

> **ARCHIVED / SUPERSEDED** — 本文记录 activation-first 阶段的历史验收。当前 ordinary 妙搭
> WorkItem/ActionAttempt 已取代 Hosted Registrar/Base 路线；文中的 Registrar blockers 不再是
> 产品主线 blocker。

## Scope

This is a local-only integration slice after Phase 2 was permanently stopped. It consumes:

- main-controller SSOT `13b5a442eb966f39e07ec46dbdf139b12dd3ffdf` read-only;
- Document Management owner `4d88666a3c494633dc083388ef781ea7aafab998`;
- Assessment Registrar owner `bb73aacfc4d883ce13fb6cc2fec6704057b98f24`.

The DM bundle was exported with its owner exporter into an empty temporary directory. The host's
two owner-owned runtime files are byte-identical to that export. The Registrar provider and
activation files are byte-identical to the exact owner commit; its mapping remains:

- app `app_17bzc551rsg`;
- store `VorbbDXAkaHbLMsUTV2cBCW5nRd`;
- WorkItems / Decisions / ExecutionLogs fields `65 / 28 / 17`.

## Real local path

The production host build consumed two real FTD PDFs:

- `777-FTD-31-21002_Doc_07042025.pdf`, `119387` bytes,
  `d93100d54ea7e5f7eff9f18ac157e31580d31da45a2dcd4b7248969de823f36c`;
- `777-FTD-31-21002_Doc_09262025.pdf`, `122102` bytes,
  `b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`.

Observed business sequence:

1. `INGEST_NEW_FAMILY`;
2. `RESUME_EXISTING_PROCESS`;
3. `INGEST_NEW_REVISION`;
4. `IDEMPOTENT_REPLAY`.

The result contains two immutable versions and one current family at generation `2`. Before the
first ingest the loop preloaded the exact content-addressed first-PDF object. The host verified its
actual bytes and reused it with `0` upload and `0` delete. The newer PDF caused the only immutable
upload; the replay caused no I/O.

## Checks

- host Jest: `13` suites / `65` tests passed;
- DM owner hosted module: `10/10` passed, including timestamp precision, orphan reuse and
  wrong-existing-bytes rejection;
- DM CommonJS composition: passed, `23` family adapters;
- Unified composition: passed with default unconfigured authority and no generic fallback;
- Registrar targeted tests: `5/5`; missing trusted ports keep `BLOCKED` and
  `writeAuthorized=false` before runtime I/O;
- server/client typecheck, eslint/stylelint, production server/client build and `git diff --check`:
  passed.

## Claims and non-claims

Claim: the unique host locally consumes the exact DM and Registrar owner revisions and completes
the real two-PDF path, including safe orphan reuse. `updatedAt` is audit-only; bucket, canonical
path, provider object ID and actual bytes remain strict.

Non-claims: no push, release, online read or POST, environment change, Base/FileService/database/
WorkItem/workflow mutation, current switch, self-signed receipt, authority activation or engineering
decision occurred. Registrar and DM mutation readiness remain blocked until the main controller
provides verified Master trust, permission fresh-read and explicit write authority.
