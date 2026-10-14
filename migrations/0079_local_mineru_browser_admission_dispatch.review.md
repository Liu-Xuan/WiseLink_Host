# Local MinerU browser admission discovery

An authenticated browser can reserve a `LOCAL_MINERU_WORKER` parse for an existing
library document without an automatic WorkItem, a completed grant, or an upload
acquisition. The old dispatcher could not find that admitted run. Its claim and
subsequent source/renew/result lookups all depended on those unrelated directories.

0079 uses the already immutable `dm_document_parse_run` admission as a locator. It
adds one function and changes no tables, columns, grants, RLS policies, or original
source data. It returns only tenant, actor, parse-run ID and document-version ID;
it returns no body, original locator, lease, token, settings or candidate bytes.
There is no new queue or synthetic WorkItem/grant.

The platform has rejected GRANT/REVOKE statements before executing migrations.
This migration therefore includes neither. Default PUBLIC execution does not
confer discovery access: the first function-body check calls the existing
`derived_summary_sql_role_allowed(true)`, which reads PostgreSQL's validated SDK
`role` setting and accepts only `service_role_<frozen current_schema>`. Ordinary
authenticated/anonymous callers and forged `app.role` claims receive 42501. The
definer search path is fixed at creation, following the existing dispatch helpers.

The tenant argument comes exclusively from the verified canonical service scope
after transport authorization. Claim input remains an empty object; caller JSON
cannot provide tenant or actor. SQL restricts each returned row to that tenant,
the active identity mapping for the existing WiseLink client, local-worker mode
and settings, and absence of an automatic WorkItem binding. Paginated claim
discovery additionally requires active status, an unexpired deadline, no cancel
or error, and an available/expired step lease. An exact ID lookup also retains
terminal rows so the existing same-receipt result acknowledgement can remain
idempotent; it does not make those rows new claim work.

Locators never authorize source use. Both claim and all three subsequent
operations enter the saved actor's ordinary RLS scope, reload the exact run,
compare actor/tenant/parse/version/mode and reject automatic bindings, then call
the existing `readLocalWorkerRun` source/ACL checks and existing principal/lease
logic. The dispatcher does not bypass RLS to read the original or accept a result.
Revocation, changed source, bad fences and mismatched principals remain failures.
The existing automatic/completed-grant/upload paths remain available.

Status maintenance reuses reserve's existing hard-deadline archival operation.
After the ordinary source authorization, `current` archives only the current
actor's own expired RUNNING/STAGING rows. It preserves any existing error code,
source binding, deadline, lease and artifacts, and supplies
`DOCUMENT_PARSE_INTERRUPTED` only when no earlier error exists. Other actors,
unexpired attempts and PUBLISHED rows remain unchanged. The existing immutable
`parse-resume-<predecessor>` admission then performs same-source/settings/version
checks and replay handling. The original deadline is never extended.

Validation used a disposable PostgreSQL 14 cluster over a private Unix socket
with TCP disabled and nonowner/NOBYPASSRLS SDK-role fixtures. The real browser
start, repository, dispatcher, source read, renewal, fenced candidate acceptance
and repeat receipt succeeded without any old directory. The unchanged PDF
publisher was stubbed after the real stored candidate acceptance; this is not a
claim of a new business parse/published reading. PUBLIC-role rejection, source
and actor revocation, tenant/receipt boundaries, automatic/cancelled/expired
exclusion, own-expiry preservation and same-source recovery/replay were checked.
The temporary clusters were normally stopped; no application database was used.

Deployment dependency: apply the exact 0079 function in both actual application
schemas before deploying code that calls it. The existing derived-summary role
helper, identity mapping, parse schema and step leases must already be present.
This delivery neither executes that migration nor qualifies an online caller,
saved B787 grant, task recovery, Host release, or Native action.
