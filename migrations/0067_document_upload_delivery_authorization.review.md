# 0067 controlled rollout and 0068 dev policy correction: verified delivery writes

## Current readback — 2026-09-29

Both dev and online now contain the authorization table and the expected eight
delivery/immutability/TRUNCATE triggers, all enabled. Both environments have
`auto_document_delivery_no_browser`, `auto_document_delivery_service_read`
and `auto_document_delivery_service_admit`; neither has the erroneous
`auto_document_delivery_no_generic_service` policy. The SELECT policy targets
the exact workspace service role and remains `true`; the UPDATE policy binds
WAITING → ADMITTED to `app.user_id`. This is current object/policy readback,
not a reconstruction of the platform's migration execution ledger.
The historical rollout narrative below predates this state; do not rerun 0067
or treat online as unmigrated. Source-driven admission still requires its own
reviewed successor changes. Current runtime evidence is maintained in
`docs/coordination/M_INTEGRATION.md`.

## Historical rollout narrative

The user authorized a staged dev-to-online application of
`0067_document_upload_delivery_authorization.sql` on 2026-09-28, with a short
pause of new 17b uploads and C136 during the change. C198 0067 was applied
on dev; online remains untouched. The platform rewrote its generic
`service_role` restrictive policy target to the exact workspace service role.
That false policy blocks exact service SELECT and UPDATE despite their positive
policies. C199 removes it from the 0067 source and supplies the idempotent
`0068_document_delivery_service_policy_repair.sql` to repair the already migrated
dev database; 0068 has not yet been applied there. The generic service role has no permissive authorization-table
policy and therefore remains denied by RLS. Controlled execution and exact
role readback remain required before either environment is recorded as ready.

The exact-link trigger accepts a newly acquired copy of an existing immutable
DocumentVersion. It compares the new acquisition's source ID and verified
bytes with that version and a READY exact-link preflight. The version keeps its
original acquisition and committer. The migration targets both legacy
`authenticated` and the exact 17b browser role
`authenticated_workspace_aadkpkjef3slu` for delivery-intent DML, upload
acquisition terminal updates/deletes, and preflight finalization edits. It
adds BEFORE TRUNCATE guards to those three source tables for browser roles.
Platform-managed table privileges include TRUNCATE and cannot be changed by
application SQL; RLS handles row DML while the statement triggers handle
TRUNCATE. A browser-set `app.user_id` alone cannot make terminal transitions.

The server candidate now uses the existing `SessionResolver.withRequestSession`
at the OAuth development-create and document-upload HTTP entries. The
`withVerifiedServiceSql` callback verifies the opaque session against the
native actor, tenant, and application before entering service SQL. Only
`MiaodaWorkItemRepository.reserve()` is elevated for development intake. Its
WorkItem, parse attempt, and `DOCUMENT_DELIVERY_INTENT` (including `NONE`)
remain one Drizzle transaction.

For document uploads, the Core passes an upload commit scope only when the
server-minted document-upload authority is present. Catalog rechecks the
actor, tenant, selection, source, bytes, immutable version or new-version
command, and server-computed decision against the stored preflight under the
transaction. A browser-created READY preflight alone cannot authorize a Host
commit. Exact-link now updates the
acquisition and preflight in one transaction. New-version creation, currentness
CAS, acquisition link, preflight commit, and selected authorization trigger
also share one transaction. Historical confirmation was already transactional;
it now uses the verified service scope and checks upload actor/tenant binding.
The selected authorization row is written by the acquisition trigger in that
same transaction. Other Catalog callers do not enter service SQL.
The draft authorization table also has the platform's four `_created/_updated`
audit columns. Its admission trigger maintains the update pair while the
effective update scope comes from the actor-bound RLS policy and immutable
column trigger.
For queued WorkItems and uploads, a pending document remains
`DOCUMENT_PENDING` so the consumer can advance its parse `STEP`. The Host
returns the exact selected attempt or acquisition cursor, which the consumer
validates and saves before work; the next tick scans later WorkItems and then
uploads. An empty tail page clears the cursor to revisit earlier work. A
terminal upload parse needing human attention stays `WAITING`, is logged, and
is skipped for that discovery tick without being admitted.

The upload, historical-confirmation, and historical-refresh HTTP entries now
return the existing `SESSION_REQUIRED` / HTTP 401 response when an opaque OAuth
session has expired after a successful whoami read. The client normalizes this
exact response to `OFFICIAL_OAUTH_SESSION_REQUIRED`, clears only its official
OAuth cache, and checks whoami again on the next attempt. It retains the
independent platform login and cached native identity. The failed POST is not
automatically replayed.

## Evidence and remaining review

- `DOCUMENT_DELIVERY_TEST_DATABASE_URL=<disposable wl_delivery_test database>
  node --test test/node/document-upload-delivery-authorization-postgres.test.mjs`
  passes against isolated PostgreSQL. It models the exact 17b browser and
  service roles without generic-role inheritance, giving the browser broad
  permissive policies and platform-like default grants before applying 0067.
  PostgreSQL rejects browser terminal/preflight edits, delivery-intent INSERT,
  and TRUNCATE through the RLS and statement-trigger guards. The
  exact workspace service role can read all rows of the new authorization
  table under its SELECT policy. The Host selector filters by verified tenant,
  then binds each candidate to the exact source and actor before dispatch.
  Admission UPDATE remains actor-scoped; the role cannot INSERT, DELETE, or
  alter immutable columns. Generic roles and an unrelated workspace service
  role cannot read authorization rows. The test also reproduces the observed
  platform role-target rewrite, verifies it blocks exact service reads, then
  applies 0068 twice and verifies access is restored without a new grant. It
  also covers wrong-schema rejection, exact-link rollback, selected and
  `NONE` reserve rollback/success, source mismatch, and populated
  audit columns. The fixture is smaller than the application schema and does
  not run the Nest/Drizzle chain.
- `DOCUMENT_DELIVERY_SESSION_TEST_DATABASE_URL=<separate disposable
  wl_delivery_test_session_* database> node --test
  test/node/document-delivery-verified-intake-postgres.test.mjs` passes through
  the actual `SessionResolver.withRequestSession` / `withVerifiedServiceSql`,
  SQL middleware, Drizzle repository reserve, and 0067 exact workspace service
  role. It verifies selected and `NONE` new intake, stable replay, rejected
  changed selection, no grant or intent on a pre-migration legacy WorkItem,
  browser denial, expired OAuth session and actor/tenant mismatch, and full
  transaction rollback when the intent insert fails. This remains a local
  application-column fixture, not a hosted middleware or deployed-client run.
- Server build and focused Jest tests compile and exercise the request/service
  scope and session rejection. With the same disposable database, run
  `DOCUMENT_DELIVERY_TEST_DATABASE_URL=<disposable wl_delivery_test database>
  npx jest --runInBand test/unit/document-upload-new-version-postgres.spec.ts`.
  This test applies the local 0001 and 0067 drafts to that database and calls
  the real Drizzle Catalog `commitNewVersion()` and replay reader. Both selected
  and `NONE` choices commit exactly one version and currentness decision;
  selected creates one authorization, `NONE` creates none. A repeated commit
  and repeated idempotency read reuse the same version and authorization;
  changing the choice under the same key is rejected. The isolated test uses
  the exact workspace service role; it does not prove hosted middleware
  session behavior. On a separate isolated `wl_delivery_test_c197` PostgreSQL
  database, the same Catalog suite passes four tests including selected uploads
  from two tenants: the service role's direct SELECT sees both rows, each
  tenant selector returns only its own candidate, and a wrong tenant or
  cross-tenant cursor returns none.
- Focused client and hosted-controller Jest suites passed locally: 2 suites,
  95 tests. They cover all three upload POSTs after a successful whoami read,
  both resolved and rejected HTTP 401 responses, retained platform identity,
  and a new whoami request on retry. Each controller route returns the stable
  `SESSION_REQUIRED` / 401 response without calling its service when the
  session is absent. Client and server TypeScript checks and targeted ESLint
  passed; TypeScript build-info files were written under `/private/tmp` because
  this draft worktree denies writes to their default paths.
- The broader affected unit set passed locally: 14 suites, 276 passed and one
  skipped; the two automatic-dispatch suites passed 29 tests. Three affected
  OpenClaw Node test files passed 305 tests. These are local checks, not a
  hosted middleware or deployed-client result.
- Focused dispatch/runtime Jest and OpenClaw queue tests verify that a RUNNING
  upload still receives a parse `STEP`, the next tick scans a later acquisition,
  the tail page wraps to the first, and terminal parses leave the authorization
  waiting while later work proceeds. These are local scheduling checks.
- Online 17b read-only inspection established `current_schema()` and DM
  tables in `workspace_aadkpkjef3slu`. The hosted SQL service and browser
  roles are `service_role_workspace_aadkpkjef3slu` and
  `authenticated_workspace_aadkpkjef3slu`; neither inherits its generic
  counterpart. The service role is not superuser and does not bypass RLS. The
  browser has broad grants and permissive policies on the source tables.
  On dev, `dataloom_user`'s workspace default ACL grants new tables broad
  privileges to generic and exact service/browser roles and workspace anon;
  the exact service role does not inherit those other roles. None is superuser
  or BYPASSRLS. The first dev attempt was rejected by the platform on a
  GRANT/REVOKE statement before any SQL applied. C198 0067 then applied on
  dev, where readback exposed the generic service policy role rewrite. C199
  0067 omits that policy, and 0068 is the pending repair for migrated dev.
  Both contain no GRANT/REVOKE. 0067 checks the exact schema and roles, then uses
  restrictive RLS to deny browser and anon access to the new table. Generic
  service has no permissive policy, so PostgreSQL's default RLS deny applies.
  The exact service role can SELECT all rows and UPDATE only its
  selected actor's `WAITING` row to `ADMITTED`; an unconditional trigger denies
  TRUNCATE. The service role's table privileges still include other verbs,
  but RLS and the trigger deny those operations. Tenant isolation during
  discovery comes from the Host selector and exact source/actor authorization,
  not from SELECT RLS.
- Before applying 0067 online or 0068 dev, review the installed grants/RLS and exercise the
  hosted middleware and real application schema. The local integration tests
  above use isolated databases and the exact hosted role but cannot establish
  the deployed platform's grants or session injection. The upload picker now
  obtains the official OAuth session before FileService upload, and its API checks before
  each upload, historical confirmation, and refresh POST. Local client tests
  cover missing session and preserved request ID. The deployed client and
  hosted middleware have not been exercised end to end.
  No online database, 17c app, or production source was changed here.
