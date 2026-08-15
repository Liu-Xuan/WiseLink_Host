# Assessment host-consumer source

This directory is a mechanical host snapshot of the ordinary Assessment consumer from:

- repository: `v3-1-sb-job-aid`
- implementation boundary: `56d35d2b0ebf83e235b1583303bb996e5a93081f`
- public API snapshot: `765062c255c4c9a402db2fffe53be22d8f70ae0a`
- reviewed external OEM seam: `1c24231137873752f71bde05de93b0d7d57669ba`
- sequential engineer-change retention: `bf4521ac47dd1354d63c709a67ced28ce5598612`

The canonical host only changed import paths so the copied consumer uses
`shared/assessment-host.interface.ts`, and registers the copied injectable dependencies in the
host module. Assessment business rules remain owned by the source repository.

The old Assessment Registrar is not part of this ordinary WorkItem path. The host owns only
authorization, WorkItem CAS, ActionAttempt bookkeeping and immutable FileService persistence.
