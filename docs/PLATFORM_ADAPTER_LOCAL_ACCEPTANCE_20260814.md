# Host platform adapters — local acceptance

Date: 2026-08-14

## Inputs and scope

- host baseline: `6b16aa7752be613378b5c46fd365e0ffc61704c1`
- Unified source input: `b3e7a20245af19349a8bfa9c0da995d5eeac6acf`
- Registrar source input: `bb73aacfc4d883ce13fb6cc2fec6704057b98f24`
- execution: the unique local canonical-host candidate only
- online reads/writes, push, release and environment changes: `0`

This slice consumes the non-overlapping Unified public provider surface and ordinary
`pythonModulePath` passthrough. It does not replace the host's already selected Unified
FailureReport authority or copy Unified HTTP mutation routes.

## Port coverage

| Port/capability | Result | Evidence |
| --- | --- | --- |
| Registrar activation artifact actual-byte read | implemented | dedicated `MiaodaRegistrarActivationArtifactStoreAdapter`; FileService bucket/path/object/bytes and configured store identity verified |
| Unified U0 Python module path | retained | public provider construction passes an ordinary `pythonModulePath`; existing hosted U0 config is unchanged |
| Immutable acceptance receipt owner DI | consumed | Unified public factory and explicit unconfigured default are present |
| Immutable acceptance receipt persistence | not configured | no platform-selected validation-write-controlled owner exists |
| Master signature/trust | not configured | no implementation or simulation added |
| sole-writer permission fresh-read | not configured | no implementation or simulation added |
| Registrar validation-write authorization | not configured | no implementation or simulation added |

The read adapter has no upload/remove methods and cannot activate Registrar by itself. Registrar
readiness therefore remains `BLOCKED`; Unified readiness explicitly reports
`IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_NOT_CONFIGURED`. No activation manifest, acceptance receipt,
signature, permission snapshot or authorization was generated.

## Results

- Jest: 14 suites / 68 tests passed.
- targeted Registrar/Unified adapter tests: 3 suites / 11 tests passed.
- server and client typecheck: passed.
- ESLint, stylelint and composite lint: passed.
- server and client production builds: passed.
- Unified composition/readiness: passed; default receipt owner unconfigured, injected fake owner
  only exercised the local DI branch and performed no I/O.
- canonical activation delta composition: passed; all authority ports remain unconfigured.
- Document Management CommonJS composition: passed.
- real local two-FTD-PDF loop: passed with the existing four-step outcome; 2 immutable versions,
  generation 2, orphan reuse 0 upload/0 delete, online mutation false.

`npm run test:unified:host-vendored-real` was also invoked without its required manual arguments.
It stopped before business execution with `ARGUMENT_REQUIRED:pythonExecutable`. This script is a
parameterized hosted-runtime probe, not a zero-argument suite. The already hosted-verified U0
configuration was preserved; this local-only slice makes no new hosted-runtime claim and does not
invent Linux/Python inputs to turn the command green.

## Claims and non-claims

Claim: the unique host now has the correct ordinary read adapter for exact Registrar activation
artifact refs and the relevant Unified `b3e7a...` public provider surface. Local compilation,
composition, readiness and real DM regression pass.

Non-claims: Registrar is not activated; the immutable acceptance receipt owner is not configured;
Master trust, sole-writer permission and validation-write authorization do not exist in this host;
no manifest/receipt was generated; no application was pushed or released; no online FileService,
Base, DB, WorkItem, package, Decision or ExecutionLog I/O occurred.
