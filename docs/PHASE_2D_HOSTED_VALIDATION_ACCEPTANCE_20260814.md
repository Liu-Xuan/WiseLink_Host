# Phase 2D hosted validation acceptance

Date: 2026-08-14

App: `app_17bzc551rsg` (`WiseLink 3.1｜工程资料与综合评估`)

## Hosted result

The DEV validation window followed the hosted platform's startup-time environment semantics:

1. Independently read all seven Document Management tables as zero rows.
2. Confirmed FileService contained only the two authorized FTD PDFs.
3. Enabled the validation run before deployment and created validation release
   `7673580510757227714` from commit
   `fd145954ccc81e41351c1b8fae0cab51b8bff581`.
4. Sent exactly one authenticated, CSRF-protected validation POST.
5. Disabled the validation environment and removed the run ID before creating closure release
   `7673582126276726025` from the same commit.
6. Re-read all seven tables as zero rows and FileService as exactly the same two files.

The single validation POST stopped before a catalog or immutable-source write. The two uploaded
objects were addressed by numeric FileService paths, while the validation wrapper incorrectly
required the storage path basename to equal the original upload filename. This run therefore did
not claim the hosted two-version loop passed.

The closure deployment is the current hosted state. Its strict frozen.2 Reader probe passed, the
validation run ID is absent, and the ordinary validation route remains disabled. A closure probe
reached the server-owned refusal but exposed a second ordinary implementation defect: the global
exception filter converted the stable 403 object into an HTTP 500 response. No additional release
or online retry was made after these findings.

## Exact hosted data readback

| Object | Result |
| --- | --- |
| `dm_source_artifact` | 0 rows |
| `dm_acquisition` | 0 rows |
| `dm_publication_family` | 0 rows |
| `dm_document` | 0 rows |
| `dm_document_version` | 0 rows |
| `dm_ingress_preflight` | 0 rows |
| `dm_currentness_decision` | 0 rows |
| FileService | 2 files, 241489 bytes total |

The files were:

- `/1873430484255770.pdf`: 119387 bytes,
  `d93100d54ea7e5f7eff9f18ac157e31580d31da45a2dcd4b7248969de823f36c`;
- `/1873430479421449.pdf`: 122102 bytes,
  `b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`.

No WorkItem, ParsedPackage, Decision, ExecutionLog or engineering conclusion was created.

## Local corrective implementation

The host now uses the existing `MiaodaFileServiceArtifactStore.readSelection` actual-byte path to
verify each selected object by fixed SHA-256 and byte length before any Document Management
transaction. The original filename is supplied by the server-owned validation profile as the
ingestion descriptor; a numeric provider path is no longer treated as document identity. A wrong
FileService object still fails before catalog or immutable-source writes.

The global exception filter now preserves an internal module error only when it has a non-empty
server-owned code, message, and integer HTTP status in the 400–599 range. It does not expose an
unknown exception stack through this branch. The closed validation route therefore maps its stable
denial to HTTP 403 locally.

## Local verification after correction

- Jest: 12 suites / 62 tests passed.
- server and client typecheck: passed.
- lint (ESLint, stylelint and typecheck): passed.
- production server and client build: passed.
- Document Management composition: passed from the built CommonJS module.
- real FTD loop: `NEW_FAMILY -> EXACT_RESUME -> NEW_REVISION -> IDEMPOTENT_REPLAY`, two immutable
  versions and current generation 2.
- canonical activation and Unified composition: passed.
- real frozen.2 Validator regression using the existing vendored Linux CPython 3.9 runtime:
  - PDF: 662441 bytes, 311 content units, 239 SourceRefs, strict pass;
  - S1000D: 9708193 bytes, 724 content units, 2034 SourceRefs, strict pass;
  - invalid `$schema`: strict rejection;
  - frozen.2 FailureReport: 1456 bytes, strict pass.
- `git diff --check`: passed.

The corrective implementation is local only. It was not pushed or released, so the hosted
two-version loop remains an explicit non-claim. A future owner-authorized validation deployment is
required to prove the corrected hosted path; it must start from the already closed, zero-row state
and must not reuse the failed validation run ID.

## Goal alignment

- This slice exercised the real hosted app, login/CSRF protocol, official DB and FileService
  surfaces, and then returned the instance to fail-closed operation.
- The two code changes address failures observed on that real route; they do not add a contract,
  hash scheme, baseline, gate or second authority.
- The remaining shortest path is one future authorized hosted rerun of the corrected DM loop,
  followed by the existing PDF frozen.2 producer/Validator/Reader on the same logical WorkItem.
