# FTD controlled selection ReviewAction handoff (2026-09-24)

## Scope

The existing `CanonicalHostApplicabilitySelectionService.configure` could
persist a Fleet-backed selection, but no browser or controller write route
called it. The c117 additional FTD scope requires a persisted selection and
rejects the legacy global aircraft/date target. This change adds a separate,
explicit engineer confirmation path on the WorkItem assessment page.

The path is disabled unless
`WL_APPLICABILITY_SELECTION_REVIEW_ACTION_ENABLED=1`. When enabled, the
server also requires one exact extra WorkItem in
`WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS`, distinct from
`WL_OPENCLAW_SERVICE_WORK_ITEM_ID`, and a private
`WL_APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY` of at least 32 characters.
None of these keys is set by this commit. Missing or malformed configuration
fails closed.

An authenticated owner first previews an aircraft identifier and ISO date.
The Host checks the current WorkItem revision, the one controlled Fleet asset,
and the Fleet snapshot/revision/authority/source date. It returns those facts
with a 15-minute HMAC-bound draft scoped to tenant, actor, WorkItem, document
version and revision. The UI displays them before enabling an explicit
confirmation. Confirmation obtains a fresh `CONFIGURE_APPLICABILITY_SELECTION`
grant, verifies the draft signature and expiry, re-reads Fleet, rejects any
source or WorkItem drift, then uses the existing WorkItem CAS. The persisted
selection records the confirming actor and time; the API reads the saved
revision and source back. If the response is lost, the UI reads current
selection before suggesting any further action. No model output confirms the
selection or formally adopts the resulting engineering candidate.

After any confirmation attempt, the browser blocks that signed draft from a
second POST, including when the response or readback is unavailable or
mismatched. A read-only recovery can recognize the saved target or discard the
old draft after checking the current WorkItem scope and revision. Any further
attempt requires a fresh Fleet preview with a different signed confirmation
token and a new explicit confirmation. The attempted token remains blocked
through React state updates, including after a successful readback.

The existing initial-analysis panel remains read-oriented; this is a
separate ReviewAction dialog. The project's coding guide references a
`forms-skill` that is not installed in this environment, so the dialog uses
the repository's existing shadcn Dialog, Input and Label patterns directly.

## Integration order

1. Review and integrate the exact commit, then publish it by final release
   `commit_id`. Keep the feature flag absent during publication.
2. Obtain the real FTD aircraft and assessment date from the responsible
   engineer. Do not copy the legacy 777 `B-1266` selection.
3. Configure the exact additional WorkItem allowlist and a new private
   signing key. Enable the ReviewAction flag only for this controlled trial.
4. Use the logged-in WorkItem page to preview, explicitly confirm and read
   back the FTD selection with its Fleet source and new WorkItem revision.
5. Bind the exact additional applicability context to that same WorkItem,
   then proceed with the separately accepted Skill/runtime and authorized
   model execution. A Review conversation binding is required only after a
   real conversation exists.

This branch makes no online environment, WorkItem, Skill, cron, model,
release or Git remote change. Local tests and technical publication alone
are not real Hosted business acceptance.

## Local verification

- Five focused Jest suites: 107/107, covering default closure, signed
  preview, Fleet and revision drift, expiry, revoked access, controller body
  rejection, API wiring, existing presentation behavior and the browser's
  no-repeat rule after an unknown confirmation outcome.
- `npm run lint`: ESLint, server/client TypeScript and Stylelint passed.
- `npm run build:client` and `npm run build:server`: passed.
- `git diff --check`: passed. Full `npm run build` could not start because
  the host's shared npm cache is owned by another user; the two actual
  production compilation steps passed independently.
