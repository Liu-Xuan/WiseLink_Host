# 0078 native tenant shared read handoff

`0078_native_tenant_shared_read.sql` is an intentionally unprepared source.
The prepared DDL is produced only after 0077 Wiki tables and policies appear
in a fresh official `pg_policies` snapshot:

```sh
node scripts/prepare-native-tenant-read-ddl.mjs \
  --snapshot /private/tmp/<fresh-official-pg-policies>.json \
  --output /private/tmp/0078_native_tenant_shared_read.prepared.sql
```

The default `platform` output contains no SQL permission-management statements,
because the platform rejected that DDL class during 0077. The CLI also writes
`<output>.acl-preflight.sql`, a read-only table and function ACL report. Run
that report before deployment; every table `can_select` must be true for
`authenticated_workspace_aadkpkjef3slu`. The prepared transaction rechecks
the same ACL and raises `NATIVE_READ_AUTH_SELECT_ACL_MISSING` before creating
functions or changing policies if any table is missing SELECT. The report
marks absent helpers `NOT_INSTALLED`; existing helpers show authenticated and
service EXECUTE rights. After creating the six helpers, the transaction checks
authenticated EXECUTE on all six and service EXECUTE on the five source-read
helpers, before changing any policy. Missing rights raise
`NATIVE_READ_AUTH_EXECUTE_ACL_MISSING` or
`NATIVE_READ_SERVICE_EXECUTE_ACL_MISSING` and roll back the transaction. It
does not grant missing ACLs or fall back to weaker access. The optional
`--permission-mode managed` variant emits SQL permission changes for an
environment that permits them; it is not the platform deployment variant.

The adapter refuses a missing target table, including all three 0077 Wiki
tables. It preserves each existing restrictive `FOR ALL` write expression as
separate INSERT/UPDATE/DELETE policies and retains its service/anon restriction.
It replaces authenticated restrictive SELECT with an explicit tenant boundary
and adds a restrictive tenant SELECT boundary even where old permissive
`SELECT true` or `FOR ALL true` policies exist. This migration does not execute
any platform DDL or publish the app.

The trust precondition is app `app_17bzc551rsg` having `Tenant` scope with
`require_login=true`, belonging only to tenant `63849986`. The database query
has no app tenant GUC, so `native_app_shared_read_allowed` checks the exact
`authenticated_workspace_aadkpkjef3slu` SQL role, nonempty genuine app user ID,
and this fixed app tenant. The Host still compares the trusted actor tenant
exactly; a future multi tenant app admission requires new design and DDL.
The default platform variant does not change function ACLs. PostgreSQL may
grant PUBLIC EXECUTE by default, or an existing function or altered default
privilege may keep it restricted; either way, the authenticated and service
privileges above are required. Every new helper explicitly checks the exact
authenticated SQL role, nonempty app user ID and fixed tenant before returning
true. If PUBLIC EXECUTE is present, anon and service calls still return false,
including for the two `SECURITY DEFINER` catalog helpers. 0078 does not grant
new service-role table SELECT or native review write authority.
Before release, read back app scope and tenant identity again. The test uses
isolated local PostgreSQL roles, not an external organization account.

`native_app_work_item_readable`, `native_app_document_readable`, and
`native_app_matter_revision_readable` are read-only checks for Host consumers.
The document check verifies exact version/acquisition/source artifact linkage,
matching source hash and byte length, readback and committed/link status. The
current path requires the tenant family and request prefixes. A historical
path requires an existing same-tenant WorkItem with an exact document ID,
version ID, artifact ID, source hash and byte length tuple; it rejects an
explicit foreign `tenant:` prefix on either family or acquisition. The
fact-only `native_app_dm_related_readable` helper applies the same historical
document check to tenantless catalog families, documents, acquisitions and
artifacts. Both catalog helpers use `SECURITY DEFINER` with fixed search path
to avoid DM policy recursion, but retain exact logged-in SQL-role admission
and return only boolean authorization facts. The Matter check requires a real
revision and at least one WorkItem or material, and checks every linked
WorkItem and material source.
Existing OAuth owner helpers and write/CAS/source/adoption paths stay intact.

Native reviewer INSERT/SELECT/UPDATE policies are limited to a genuine logged
in authenticated app user, that user's own actor ID, target tenant and same
tenant WorkItem/conversation. All logged in members of this single tenant can
record pure text engineering review in this release. The platform role
`wiselink_engineering_reviewer` is reserved for later access control and has
no required membership in this release. Enabling it later requires changing
both Host policy and SQL together. New review-turn INSERT is constrained to
unadopted engineer text with all model candidate fields null. There is no new
`review_turn` UPDATE policy for the OpenClaw candidate response path. The Host
must still enforce fresh `RECORD_ENGINEER_REVIEW` grant before these writes.
Engineer input INSERT also requires the exact same tenant, actor, WorkItem,
conversation and input type on its trigger-created ReviewTurn.
Ordinary `SELECT` on Review conversation/turn/input is shared within the app
tenant with WorkItem and conversation bindings; the Host source reader must
still apply exact IDs and fresh read authorization.
Personal dialogue thread/message/contribution/assessment-request rows remain
private to `actor_id=app.user_id`. Authenticated `review_aily_query` SELECT
permits that actor's exact `CHAT`/`AILY` dialogue message and an engineering
receipt tied to an exact same tenant WorkItem/ActionAttempt of type Dynamic
Evaluation or Overall Synthesis. A receipt contains no session token or token
grant. The existing service attempt policies remain unchanged. The isolated
test verifies B can read A's engineering receipt but not A's private message.

The older `FOR ALL PERMISSIVE USING (true)` policies on WorkItem, Document
Management and ActionAttempt already grant broad authenticated writes. 0078
does not create or remove those write policies; it is inaccurate to claim that
all legacy authenticated writes are denied. The isolated test verifies the
new policies preserve these old write permissions while retaining the old
restrictive write limits.

`ordinary_artifact_locator` is not included because it has no tenant field or
reliable persisted tenant association; its object read must remain behind the
Host's authorized artifact lookup. The library quicklook reads WorkItem and
AssessmentWorkRevision, both included. Local LCM candidate tables from 0072
are absent from the official online policy snapshot; 0078 neither claims
their online installation nor widens their special `app.lcm_*` scopes.

Validation: `node --test test/node/native-tenant-shared-read-postgres.test.mjs`
passed with real local PostgreSQL `SET ROLE` and RLS, including historical
WorkItem-linked DM rows across eight protected tables and mismatched, missing
or foreign-tenant source denials. It verifies missing table, authenticated
function and service function ACL each abort the whole transaction; after
test-only privileges are supplied, the default output installs without SQL
permission statements. When test-only PUBLIC EXECUTE is supplied, helpers
still return false to anon/service roles. Official prepared DDL,
platform execution and runtime admission tests remain pending the post-0077
snapshot and the release owner.
