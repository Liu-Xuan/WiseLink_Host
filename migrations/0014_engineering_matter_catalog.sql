-- WiseLink R09 V1.1/V1.2 Host-owned Engineering Matter catalog.
--
-- Matter is an index over existing WorkItems. It does not copy WorkItem
-- projection/current, DocumentVersion bytes/currentness, or SourceRefs.
-- A MatterRevision snapshots only the linked WorkItem ids and their observed
-- revisions; browser reads always fresh-read each WorkItem and DM identity.

BEGIN;

CREATE TABLE IF NOT EXISTS engineering_matter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  title text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  current_revision_no integer NOT NULL,
  current_matter_revision_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineering_matter_business_id UNIQUE (matter_id),
  CONSTRAINT uk_engineering_matter_tenant_identity
    UNIQUE (tenant_id, matter_id),
  CONSTRAINT uk_engineering_matter_create_request
    UNIQUE (tenant_id, created_by_user_id, request_id),
  CONSTRAINT ck_engineering_matter_title
    CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT ck_engineering_matter_status CHECK (status = 'ACTIVE'),
  CONSTRAINT ck_engineering_matter_revision CHECK (current_revision_no > 0)
);

CREATE TABLE IF NOT EXISTS engineering_matter_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_revision_id varchar(96) NOT NULL,
  matter_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  revision_no integer NOT NULL,
  request_id varchar(96) NOT NULL,
  change_kind varchar(32) NOT NULL,
  change_summary text NOT NULL,
  changed_work_item_id varchar(96) NOT NULL,
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineering_matter_revision_business_id
    UNIQUE (matter_revision_id),
  CONSTRAINT uk_engineering_matter_revision_scope
    UNIQUE (tenant_id, matter_id, matter_revision_id),
  CONSTRAINT uk_engineering_matter_revision_number
    UNIQUE (matter_id, revision_no),
  CONSTRAINT uk_engineering_matter_revision_request
    UNIQUE (matter_id, request_id),
  CONSTRAINT fk_engineering_matter_revision_matter
    FOREIGN KEY (tenant_id, matter_id)
    REFERENCES engineering_matter(tenant_id, matter_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_engineering_matter_revision_changed_work_item
    FOREIGN KEY (changed_work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_engineering_matter_revision_number CHECK (revision_no > 0),
  CONSTRAINT ck_engineering_matter_revision_kind
    CHECK (change_kind IN ('CREATED', 'WORK_ITEM_LINKED')),
  CONSTRAINT ck_engineering_matter_revision_summary
    CHECK (length(btrim(change_summary)) BETWEEN 1 AND 1000)
);

CREATE TABLE IF NOT EXISTS engineering_matter_revision_work_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_revision_id varchar(96) NOT NULL,
  matter_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  ordinal integer NOT NULL,
  relation_role varchar(32) NOT NULL,
  linked_at_work_item_revision integer NOT NULL,
  CONSTRAINT uk_engineering_matter_revision_work_item
    UNIQUE (matter_revision_id, work_item_id),
  CONSTRAINT uk_engineering_matter_revision_ordinal
    UNIQUE (matter_revision_id, ordinal),
  CONSTRAINT fk_engineering_matter_revision_work_item_revision
    FOREIGN KEY (tenant_id, matter_id, matter_revision_id)
    REFERENCES engineering_matter_revision(
      tenant_id,
      matter_id,
      matter_revision_id
    ),
  CONSTRAINT fk_engineering_matter_revision_work_item_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_engineering_matter_revision_work_item_ordinal
    CHECK (ordinal > 0),
  CONSTRAINT ck_engineering_matter_revision_work_item_role
    CHECK (relation_role IN ('PRIMARY', 'RELATED')),
  CONSTRAINT ck_engineering_matter_revision_work_item_revision
    CHECK (linked_at_work_item_revision >= 0)
);

ALTER TABLE engineering_matter
  ADD CONSTRAINT fk_engineering_matter_current_revision
  FOREIGN KEY (tenant_id, matter_id, current_matter_revision_id)
  REFERENCES engineering_matter_revision(
    tenant_id,
    matter_id,
    matter_revision_id
  )
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_engineering_matter_owner
  ON engineering_matter(tenant_id, created_by_user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_engineering_matter_revision_history
  ON engineering_matter_revision(matter_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_engineering_matter_work_item_lookup
  ON engineering_matter_revision_work_item(work_item_id, matter_revision_id);

-- Policy helper functions execute as the table owner so their subqueries do
-- not become recursively filtered by the policies they support. They return
-- booleans only and always bind the decision to the current app.user_id.
CREATE OR REPLACE FUNCTION engineering_matter_actor_has_tenant(
  target_tenant_id varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.identity_subject_mapping AS current_mapping
    WHERE current_mapping.miaoda_user_id =
      current_setting('app.user_id', true)
      AND current_mapping.miaoda_tenant_id = target_tenant_id
      AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
      AND current_mapping.status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION engineering_matter_owned_by_actor(
  target_tenant_id varchar,
  target_matter_id varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.engineering_matter AS owned_matter
    WHERE owned_matter.tenant_id = target_tenant_id
      AND owned_matter.matter_id = target_matter_id
      AND owned_matter.created_by_user_id =
        current_setting('app.user_id', true)
  );
$$;

CREATE OR REPLACE FUNCTION engineering_matter_work_item_owned_by_actor(
  target_tenant_id varchar,
  target_work_item_id varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_item AS owned_work_item
    WHERE owned_work_item.tenant_id = target_tenant_id
      AND owned_work_item.work_item_id = target_work_item_id
      AND owned_work_item.requested_by_user_id =
        current_setting('app.user_id', true)
  );
$$;

CREATE OR REPLACE FUNCTION engineering_matter_revision_owned_by_actor(
  target_tenant_id varchar,
  target_matter_id varchar,
  target_matter_revision_id varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.engineering_matter_revision AS owned_revision
    JOIN public.engineering_matter AS owned_matter
      ON owned_matter.matter_id = owned_revision.matter_id
      AND owned_matter.tenant_id = owned_revision.tenant_id
    WHERE owned_revision.tenant_id = target_tenant_id
      AND owned_revision.matter_id = target_matter_id
      AND owned_revision.matter_revision_id = target_matter_revision_id
      AND owned_revision.created_by_user_id =
        current_setting('app.user_id', true)
      AND owned_matter.created_by_user_id =
        current_setting('app.user_id', true)
  );
$$;

CREATE OR REPLACE FUNCTION engineering_matter_all_links_owned_by_actor(
  target_tenant_id varchar,
  target_matter_revision_id varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.engineering_matter_revision_work_item AS current_link
      WHERE current_link.tenant_id = target_tenant_id
        AND current_link.matter_revision_id = target_matter_revision_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.engineering_matter_revision_work_item AS current_link
      JOIN public.work_item AS linked_work_item
        ON linked_work_item.work_item_id = current_link.work_item_id
      WHERE current_link.tenant_id = target_tenant_id
        AND current_link.matter_revision_id = target_matter_revision_id
        AND (
          linked_work_item.tenant_id <> target_tenant_id
          OR linked_work_item.requested_by_user_id <>
            current_setting('app.user_id', true)
        )
    );
$$;

REVOKE ALL ON FUNCTION engineering_matter_actor_has_tenant(varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_matter_owned_by_actor(varchar, varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_matter_work_item_owned_by_actor(
  varchar,
  varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_matter_revision_owned_by_actor(
  varchar,
  varchar,
  varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_matter_all_links_owned_by_actor(
  varchar,
  varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION engineering_matter_actor_has_tenant(varchar)
  TO authenticated;
GRANT EXECUTE ON FUNCTION engineering_matter_owned_by_actor(varchar, varchar)
  TO authenticated;
GRANT EXECUTE ON FUNCTION engineering_matter_work_item_owned_by_actor(
  varchar,
  varchar
) TO authenticated;
GRANT EXECUTE ON FUNCTION engineering_matter_revision_owned_by_actor(
  varchar,
  varchar,
  varchar
) TO authenticated;
GRANT EXECUTE ON FUNCTION engineering_matter_all_links_owned_by_actor(
  varchar,
  varchar
) TO authenticated;

ALTER TABLE engineering_matter ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_matter_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_matter_revision_work_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_matter_authenticated_select
  ON engineering_matter;
CREATE POLICY engineering_matter_authenticated_select
ON engineering_matter FOR SELECT TO authenticated
USING (
  engineering_matter_actor_has_tenant(engineering_matter.tenant_id)
  AND engineering_matter_all_links_owned_by_actor(
    engineering_matter.tenant_id,
    engineering_matter.current_matter_revision_id
  )
);

DROP POLICY IF EXISTS engineering_matter_authenticated_insert
  ON engineering_matter;
CREATE POLICY engineering_matter_authenticated_insert
ON engineering_matter FOR INSERT TO authenticated
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(engineering_matter.tenant_id)
);

DROP POLICY IF EXISTS engineering_matter_authenticated_update
  ON engineering_matter;
CREATE POLICY engineering_matter_authenticated_update
ON engineering_matter FOR UPDATE TO authenticated
USING (
  engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(
    tenant_id,
    current_matter_revision_id
  )
)
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(engineering_matter.tenant_id)
  AND engineering_matter_all_links_owned_by_actor(
    engineering_matter.tenant_id,
    engineering_matter.current_matter_revision_id
  )
);

DROP POLICY IF EXISTS engineering_matter_revision_authenticated_select
  ON engineering_matter_revision;
CREATE POLICY engineering_matter_revision_authenticated_select
ON engineering_matter_revision FOR SELECT TO authenticated
USING (
  engineering_matter_actor_has_tenant(engineering_matter_revision.tenant_id)
  AND engineering_matter_all_links_owned_by_actor(
    engineering_matter_revision.tenant_id,
    engineering_matter_revision.matter_revision_id
  )
);

DROP POLICY IF EXISTS engineering_matter_revision_authenticated_insert
  ON engineering_matter_revision;
CREATE POLICY engineering_matter_revision_authenticated_insert
ON engineering_matter_revision FOR INSERT TO authenticated
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(
    engineering_matter_revision.tenant_id
  )
  AND engineering_matter_owned_by_actor(
    engineering_matter_revision.tenant_id,
    engineering_matter_revision.matter_id
  )
  AND engineering_matter_work_item_owned_by_actor(
    engineering_matter_revision.tenant_id,
    engineering_matter_revision.changed_work_item_id
  )
);

DROP POLICY IF EXISTS engineering_matter_link_authenticated_select
  ON engineering_matter_revision_work_item;
CREATE POLICY engineering_matter_link_authenticated_select
ON engineering_matter_revision_work_item FOR SELECT TO authenticated
USING (
  engineering_matter_work_item_owned_by_actor(
    engineering_matter_revision_work_item.tenant_id,
    engineering_matter_revision_work_item.work_item_id
  )
);

DROP POLICY IF EXISTS engineering_matter_link_authenticated_insert
  ON engineering_matter_revision_work_item;
CREATE POLICY engineering_matter_link_authenticated_insert
ON engineering_matter_revision_work_item FOR INSERT TO authenticated
WITH CHECK (
  engineering_matter_work_item_owned_by_actor(
    engineering_matter_revision_work_item.tenant_id,
    engineering_matter_revision_work_item.work_item_id
  )
  AND engineering_matter_revision_owned_by_actor(
    engineering_matter_revision_work_item.tenant_id,
    engineering_matter_revision_work_item.matter_id,
    engineering_matter_revision_work_item.matter_revision_id
  )
);

COMMENT ON TABLE engineering_matter IS
  'Stable cross-WorkItem catalog identity; it is not a WorkItem or assessment current owner.';
COMMENT ON TABLE engineering_matter_revision IS
  'Immutable MatterRevision metadata. The current pointer is advanced by Host CAS.';
COMMENT ON TABLE engineering_matter_revision_work_item IS
  'Revision-scoped WorkItem ids only; WorkItem/DM/SourceRef values are fresh-read from their owners.';

COMMIT;
