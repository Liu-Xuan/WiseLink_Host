# Dedicated Registrar Base adapter — local acceptance

Date: 2026-08-14

## Outcome

The canonical host has one local, server-only Open Platform Base transport for the selected
WorkItems, Decisions and ExecutionLogs tables. It uses a dedicated application's
`tenant_access_token`; it does not use a logged-in user's `userContext` as the Base caller and does
not consume the generic `feishu-bitable` client capability as Registrar write authority.

The transport is not registered in `AppModule`. Without the future dedicated app configuration the
host stays zero-write and the existing Registrar readiness remains blocked on its existing Master,
permission and validation-write inputs.

## Runtime integration inputs

All values are ordinary server runtime configuration. No real secret is committed.

| Environment key                             | Required input                               |
| ------------------------------------------- | -------------------------------------------- |
| `WL_REGISTRAR_OPEN_PLATFORM_APP_ID`         | exact dedicated Open Platform app ID         |
| `WL_REGISTRAR_OPEN_PLATFORM_APP_SECRET`     | app secret from server-only secret injection |
| `WL_REGISTRAR_OPEN_PLATFORM_TOKEN_ENDPOINT` | official tenant token endpoint               |
| `WL_REGISTRAR_OPEN_PLATFORM_API_BASE_URL`   | official OpenAPI base URL                    |
| `WL_REGISTRAR_BASE_TOKEN`                   | selected isolated Registrar Base token       |
| `WL_REGISTRAR_WORK_ITEMS_TABLE_ID`          | exact 65-field WorkItems table ID            |
| `WL_REGISTRAR_DECISIONS_TABLE_ID`           | exact 28-field Decisions table ID            |
| `WL_REGISTRAR_EXECUTION_LOGS_TABLE_ID`      | exact 17-field ExecutionLogs table ID        |

Before binding, the main controller must also provide the app's exact record search/create/update
permissions and access to the selected Base, plus the existing Registrar mapper that owns CAS,
append-only Decision/ExecutionLog semantics and actor fields. This transport does not invent those
semantics.

## Tested behavior

- missing secret returns `BLOCKED` before HTTP I/O;
- successful search/create/update uses one cached tenant token;
- expiry uses the returned `expire` seconds and ordinary refresh time;
- one Base `401` refreshes the token once, then fails closed;
- token rejection, `403`, `429`, `5xx` and transport failures return stable secret-free errors;
- authenticated business actor JSON is sent and read back unchanged;
- three table roles resolve only to their configured table IDs;
- no default module wiring, online request or write occurs.

## Claims and non-claims

Claim: the low-level dedicated Base transport and failure behavior are locally executable and
tested. It is ready to receive the exact dedicated app identity/scopes and the already-selected
Registrar business mapper.

Non-claims: no app identity or scope is frozen here; no tenant token was requested; no Base,
FileService or environment was read or changed; no hosted Registrar activation, Decision, WorkItem,
ExecutionLog, push, release or current switch occurred.
