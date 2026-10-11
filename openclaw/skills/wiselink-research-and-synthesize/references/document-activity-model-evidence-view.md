# Activity v2 model evidence encoding

For a fresh explicit `document_work ACTIVITY_BEGIN`, use
`activityV2ProductionContract(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA)` from
`scripts/document-activity-model-contract.mjs`. Its selection default freezes
`wiselink.document.activity_source_context_quote_selection_prompt.v2` in the
ordinary Host production contract. Host persists those four pins; consumer and
invoker choose the format from that frozen contract. This does not create a run,
change source authorization, or change the candidate/quote-selection schema or
tool digest.

The thirteen-field original INPUT remains the source/checkpoint/input-hash
authority. The new model user message carries a lossless evidence view: original
anchor IDs point through sourceUnitId/payloadPath to exact delivered unit text,
and ordered sourceRefIds select exact locators. Repeated complete JSON values
use a deterministic value table. Literal reserved keys are escaped as data.
Distinct source identities and array order never merge. All raw values, tables,
geometry, source context, coverage, UNKNOWN and UNREAD limitations remain.

Before a model dispatch marker or request, conservation is checked by bounded
restoration and exact canonical-hash comparison. Invalid pointers, locator
conflicts, malformed/missing/cyclic/ambiguous references or exceeded bounds
fail closed; there is no full-input fallback. The view is not new source evidence
and does not authorize a retry.

Historical selection prompt `.v1` remains supported byte for byte, with its
original full INPUT and prompt. Offset and legacy contracts also retain their
original format. Never change pins or checkpoints of an existing run to upgrade
it. Invoker and strict opt-in native recovery use the same user serialization
helper; all original success/abort, provider/model, source and deadline checks
remain mandatory. A byte reduction makes no token-fit, cost or business-quality
claim. A fresh real run still requires normal eligibility and content acceptance.
