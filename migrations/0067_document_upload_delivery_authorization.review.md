# 0067 review draft: verified delivery writes

Do not apply `0067_document_upload_delivery_authorization.sql` yet. This is a
local candidate, not a production migration or an authorization change.

The exact-link trigger accepts a newly acquired copy of an existing immutable
DocumentVersion. It compares the new acquisition's source ID and verified
bytes with that version and a READY exact-link preflight. The version keeps its
original acquisition and committer. The migration targets both legacy
`authenticated` and the exact 17b browser role
`authenticated_workspace_aadkpkjef3slu` for delivery-intent DML, upload
acquisition terminal updates/deletes, and preflight finalization edits. It
revokes TRUNCATE on those three source tables from the exact browser role.
A remaining inherited or PUBLIC TRUNCATE grant aborts the migration.
A browser-set `app.user_id` alone cannot make those terminal transitions.

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
audit columns. Its admission trigger maintains the update pair without adding
those columns to the service role's UPDATE grant.
For queued uploads, a running original remains `DOCUMENT_PENDING` so the
consumer can advance its parse `STEP`. That response carries the exact
acquisition cursor, which the consumer saves before work; the next tick scans
later acquisitions and an empty tail page clears the cursor to revisit earlier
work. A terminal parse needing human attention stays `WAITING`, is logged, and
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
  permissive policies and grants before applying 0067. PostgreSQL rejects
  browser terminal/preflight edits, delivery-intent INSERT, and TRUNCATE. The
  target service role can read and admit only the selected actor's row; it
  cannot INSERT, DELETE, or alter immutable columns. Generic roles and an
  unrelated workspace service role cannot read authorization rows. The test
  also covers wrong-schema and PUBLIC TRUNCATE rejection, exact-link rollback,
  selected and `NONE` reserve rollback/success, source mismatch, and populated
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
  session behavior.
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
  This local 0067 checks the exact schema and two exact, non-superuser,
  non-BYPASSRLS roles before DDL. Only the target service role receives
  authorization-table SELECT and UPDATE of `status` and `admitted_at`, with
  actor RLS. PUBLIC, generic roles, and browser receive no table grant.
- Before applying 0067, review the installed grants/RLS and exercise the
  hosted middleware and real application schema. The local integration tests
  above use isolated databases and the exact hosted role but cannot establish
  the deployed platform's grants or session injection. The upload picker now
  obtains the official OAuth session before FileService upload, and its API checks before
  each upload, historical confirmation, and refresh POST. Local client tests
  cover missing session and preserved request ID. The deployed client and
  hosted middleware have not been exercised end to end.
  No online database, 17c app, or production source was changed here.
