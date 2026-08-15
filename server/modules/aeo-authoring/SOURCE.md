# AEO same-WorkItem host source

This directory is the 35-file transitive public-API/action closure from:

- owner repo: `ameco-ai-hub-aeo-docs`
- exact owner commit: `cf9a377497d2bfa0c514de4c0c4ff60a3bfc3278`
- public entry: `server/modules/aeo-authoring/public-api.ts`

The canonical host `AppModule` does not import `AeoAuthoringModule`. Production therefore remains
unconfigured and exposes no AEO route. Only the Phase 6D/8 local acceptance explicitly supplies
`provideAeoSameWorkItemAssessmentAdapter()` and local in-memory ports. The adapter accepts only the
server-fresh current cumulative resynthesis, and rejects an initial Assessment candidate or an older
resynthesis before any AEO artifact I/O. No online object, endpoint,
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
