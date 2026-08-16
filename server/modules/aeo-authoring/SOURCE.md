# AEO same-WorkItem host source

This directory is the 35-file transitive public-API/action closure from:

- owner repo: `ameco-ai-hub-aeo-docs`
- exact owner commit: `8a2ea67aea5d60c0c72750a9e539404214296aeb`
- public entry: `server/modules/aeo-authoring/public-api.ts`

The canonical host `AppModule` does not mount the AEO owner controllers or expose their general
authoring route family. The host has one fixed Phase 10 validation-only action which explicitly supplies
`provideAeoSameWorkItemAssessmentAdapter()` and host-owned ports for one exact WorkItem. The adapter accepts only the
server-fresh current cumulative resynthesis and exact current source ParsedPackage actual bytes, and
rejects an initial Assessment candidate or an older resynthesis before any AEO artifact I/O. Accepted
SB content units remain review-only `SB_SOURCE` candidates; they are never automatically adopted and
cannot imply applicability. No online object, endpoint,
contract, hash rule, baseline or gate is created by this source snapshot.

This snapshot is not the Aily product entry and is not a visual Workflow implementation. The
current Aily design is one Skill plus the canonical host's three fixed read-only connector
operations. The AEO controllers contained in the owner snapshot are not mounted by `AppModule` and
must not be published or configured as a parallel Aily path.

Thirty-four files are byte-identical to the owner commit. The only host adaptation is in
`aeo-authoring.module.ts`: `AeoAuthoringService` is listed in `providers` because this host's
typed-Nest ESLint rule rejects every `@Injectable()` that is not owned by a module. The class has
no constructor dependency or startup side effect; the change adds no controller, route or runtime
authority.
