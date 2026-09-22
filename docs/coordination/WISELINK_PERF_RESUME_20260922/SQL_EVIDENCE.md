# Engineering Matter Directory SQL Evidence

## Scope

- Local isolated PostgreSQL: `127.0.0.1:55441`
- Database: `wiselink_directory_test`
- Role: unique `NOBYPASSRLS` role with actor and tenant session settings
- Test: `test/node/engineering-matter-directory-postgres.test.mjs`
- Production code: `EngineeringMatterDirectoryService.list`

The local RLS fixture reproduces tenant/actor row visibility and WorkItem
ownership. It does not reproduce the complete Miaoda gateway identity,
provenance or production permission function chain.

Representative data had five matters total, with three visible to the primary
actor. Scale data added 80 matters, one to four working revisions per matter,
and working state JSON from roughly 4 KiB to 36 KiB.

## Query Count And Normal Calls

- Representative visible page: 6 query executions, 7.572 ms normal service
  call.
- Empty search result: 1 query execution, no composition/working follow-up.
- Scale page, limit 20: 6 query executions, 27.137 ms normal service call.
- Query count is independent of page row count because composition,
  materials, working summaries and two confirmations are batched.

These are single local timings, not p95, network time or production service
latency.

## EXPLAIN Summary

Small:

| Query | Elapsed ms | Planning ms | Execution ms | Top node | Shared hits | Shared reads | Temp read | Temp written |
| ----- | ---------: | ----------: | -----------: | -------- | ----------: | -----------: | --------: | -----------: |
| 1     |      0.508 |       0.070 |        0.025 | Limit    |          22 |            0 |         0 |            0 |
| 2     |      0.476 |       0.082 |        0.027 | Sort     |          25 |            0 |         0 |            0 |
| 3     |      0.265 |       0.013 |        0.006 | Sort     |           3 |            0 |         0 |            0 |
| 4     |      0.992 |       0.046 |        0.623 | Unique   |           8 |            0 |         0 |            0 |
| 5     |      0.268 |       0.014 |        0.004 | Result   |           2 |            0 |         0 |            0 |
| 6     |      0.268 |       0.016 |        0.010 | Unique   |           8 |            0 |         0 |            0 |

Scale:

| Query | Elapsed ms | Planning ms | Execution ms | Top node | Shared hits | Shared reads | Temp read | Temp written |
| ----- | ---------: | ----------: | -----------: | -------- | ----------: | -----------: | --------: | -----------: |
| 1     |      0.508 |       0.087 |        0.057 | Limit    |          44 |            0 |         0 |            0 |
| 2     |      0.536 |       0.119 |        0.090 | Sort     |          46 |            0 |         0 |            0 |
| 3     |      0.228 |       0.019 |        0.010 | Sort     |           3 |            0 |         0 |            0 |
| 4     |     22.570 |       0.062 |       22.070 | Unique   |         108 |            0 |         0 |            0 |
| 5     |      0.320 |       0.042 |        0.017 | Result   |           4 |            0 |         0 |            0 |
| 6     |      0.305 |       0.046 |        0.080 | Unique   |         108 |            0 |         0 |            0 |

Query 4 dominates because it projects each selected Matter's latest working
state and decisive claim array from JSON. It still reads only the projected
fields, not complete working state JSON into Node.

## Production-Generated SQL

Whitespace below is normalized; query semantics are unchanged.

### Query 1: Matter Page

```sql
select
  "matter_id",
  "title",
  "current_matter_revision_id",
  "created_at",
  "updated_at"
from "engineering_matter"
where (
  "engineering_matter"."tenant_id" = $1
  and not exists (
    select "id"
    from "engineering_matter_revision_work_item"
    where (
      "engineering_matter_revision_work_item"."tenant_id" = $2
      and "engineering_matter_revision_work_item"."matter_id" =
        "engineering_matter"."matter_id"
      and "engineering_matter_revision_work_item"."matter_revision_id" =
        "engineering_matter"."current_matter_revision_id"
      and not exists (
        select "work_item_id"
        from "work_item"
        where (
          "work_item"."tenant_id" = $3
          and "work_item"."work_item_id" =
            "engineering_matter_revision_work_item"."work_item_id"
          and "work_item"."requested_by_user_id" = $4
        )
      )
    )
  )
)
order by
  "engineering_matter"."created_at" desc,
  "engineering_matter"."matter_id" desc
limit $5;
```

### Query 2: Current Revision Links And Source Bindings

```sql
select
  "engineering_matter_revision_work_item"."matter_revision_id",
  "engineering_matter_revision_work_item"."work_item_id",
  "engineering_matter_revision_work_item"."relation_role",
  "engineering_matter_revision_work_item"."ordinal",
  "work_item"."requested_by_user_id",
  "work_item"."document_id",
  "work_item"."document_version_id",
  "dm_document_version"."document_id",
  "dm_document_version"."document_version_id",
  "dm_document_version"."family_id",
  "dm_publication_family"."family_id"
from "engineering_matter_revision_work_item"
left join "work_item" on (
  "work_item"."tenant_id" = "engineering_matter_revision_work_item"."tenant_id"
  and "work_item"."work_item_id" =
    "engineering_matter_revision_work_item"."work_item_id"
)
left join "dm_document_version" on
  "dm_document_version"."document_version_id" = "work_item"."document_version_id"
left join "dm_publication_family" on
  "dm_publication_family"."family_id" = "dm_document_version"."family_id"
where (
  "engineering_matter_revision_work_item"."tenant_id" = $1
  and "engineering_matter_revision_work_item"."matter_revision_id"
    in ($2, $3, $4)
)
order by
  "engineering_matter_revision_work_item"."matter_revision_id" asc,
  "engineering_matter_revision_work_item"."ordinal" asc;
```

### Query 3: Material JSON

```sql
select
  "matter_revision_id",
  "material_id",
  "material_json"
from "engineering_matter_material_link"
where (
  "engineering_matter_material_link"."tenant_id" = $1
  and "engineering_matter_material_link"."matter_revision_id"
    in ($2, $3, $4)
)
order by
  "engineering_matter_material_link"."matter_revision_id" asc,
  "engineering_matter_material_link"."material_id" asc;
```

### Query 4: Latest Working Summary Projection

```sql
select distinct on ("engineering_matter_work_revision"."matter_id")
  "matter_id",
  "working_revision",
  "created_at",
  coalesce(
    jsonb_typeof("state_json"::jsonb -> 'substantiveResult') <> 'null',
    false
  ),
  "state_json"::jsonb #>> '{substantiveResult,resultRef}',
  ("state_json"::jsonb #>> '{substantiveResult,resultRevision}')::integer,
  "state_json"::jsonb #>> '{substantiveResult,content,headline}',
  "state_json"::jsonb #>> '{substantiveResult,content,listBrief}',
  "state_json"::jsonb #>> '{substantiveResult,scope,kind}',
  "state_json"::jsonb #>> '{substantiveResult,scope,matterId}',
  case
    when jsonb_typeof(
      "state_json"::jsonb -> 'substantiveResult' -> 'content' -> 'claims'
    ) <> 'array' then null
    else (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'claimId', claim ->> 'claimId',
            'text', claim ->> 'text'
          )
          order by claim_order
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(
        "state_json"::jsonb -> 'substantiveResult' -> 'content' -> 'claims'
      ) with ordinality as claims(claim, claim_order)
      where jsonb_exists(
        "state_json"::jsonb
          -> 'substantiveResult' -> 'content' -> 'decisiveClaimIds',
        claim ->> 'claimId'
      )
    )
  end,
  "state_json"::jsonb #>> '{problemWork,overviewStatus}'
from "engineering_matter_work_revision"
where (
  "engineering_matter_work_revision"."tenant_id" = $1
  and "engineering_matter_work_revision"."matter_id" in ($2, $3, $4)
)
order by
  "engineering_matter_work_revision"."matter_id" asc,
  "engineering_matter_work_revision"."working_revision" desc;
```

### Query 5: Matter Revision Confirmation

```sql
select "matter_id", "current_matter_revision_id"
from "engineering_matter"
where (
  "engineering_matter"."tenant_id" = $1
  and "engineering_matter"."matter_id" in ($2, $3, $4)
);
```

### Query 6: Working Revision Confirmation

```sql
select distinct on ("engineering_matter_work_revision"."matter_id")
  "matter_id",
  "working_revision"
from "engineering_matter_work_revision"
where (
  "engineering_matter_work_revision"."tenant_id" = $1
  and "engineering_matter_work_revision"."matter_id" in ($2, $3, $4)
)
order by
  "engineering_matter_work_revision"."matter_id" asc,
  "engineering_matter_work_revision"."working_revision" desc;
```

## Concurrency Result

The test delays the working-summary RLS read, changes the Matter current
revision during that delay, and verifies the final batch confirmation rejects
the read with `ENGINEERING_MATTER_DIRECTORY_CHANGED`. It does not return a
mixture of old composition and new working identity.
