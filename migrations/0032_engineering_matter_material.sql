-- Direct document materials extend the existing Matter aggregate. Legacy WI
-- links keep their original meaning and authorization; no historical conversion.
BEGIN;

ALTER TABLE engineering_matter ADD COLUMN IF NOT EXISTS default_family_id varchar(96)
  REFERENCES dm_publication_family(family_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_engineering_matter_default_family
  ON engineering_matter(tenant_id, created_by_user_id, default_family_id);
COMMENT ON COLUMN engineering_matter.default_family_id IS
  'Stable default-intake dedup identity in the existing owner management scope; not an assessment target.';
ALTER TABLE engineering_matter_revision ALTER COLUMN changed_work_item_id DROP NOT NULL;
ALTER TABLE engineering_matter_revision ADD COLUMN IF NOT EXISTS material_command_json text;
ALTER TABLE engineering_matter_revision DROP CONSTRAINT IF EXISTS ck_engineering_matter_revision_kind;
ALTER TABLE engineering_matter_revision ADD CONSTRAINT ck_engineering_matter_revision_kind
  CHECK (change_kind IN ('CREATED', 'WORK_ITEM_LINKED', 'MATERIALS_REVISED'));
COMMENT ON COLUMN engineering_matter_revision.material_command_json IS
  'Exact material command for request replay; null on legacy WorkItem revisions.';

CREATE TABLE IF NOT EXISTS engineering_matter_material_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  matter_id varchar(96) NOT NULL,
  matter_revision_id varchar(96) NOT NULL,
  material_id varchar(96) NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind IN ('MEMBER', 'RELATED', 'EXPECTED')),
  family_id varchar(96) REFERENCES dm_publication_family(family_id),
  document_version_id varchar(96) REFERENCES dm_document_version(document_version_id),
  material_json text NOT NULL,
  created_by_user_id varchar(255) NOT NULL,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile,
  CONSTRAINT uk_engineering_matter_material_revision UNIQUE(matter_revision_id, material_id),
  CONSTRAINT fk_engineering_matter_material_revision FOREIGN KEY(tenant_id, matter_id, matter_revision_id)
    REFERENCES engineering_matter_revision(tenant_id, matter_id, matter_revision_id),
  CONSTRAINT ck_engineering_matter_material_identity CHECK (
    (kind = 'EXPECTED' AND family_id IS NULL AND document_version_id IS NULL) OR
    (kind IN ('MEMBER', 'RELATED') AND family_id IS NOT NULL AND document_version_id IS NOT NULL)
  ),
  CONSTRAINT ck_engineering_matter_material_json CHECK (
    material_json::jsonb ->> 'materialId' = material_id AND
    material_json::jsonb ->> 'kind' = kind AND
    (material_json::jsonb ->> 'familyId') IS NOT DISTINCT FROM family_id AND
    (material_json::jsonb ->> 'documentVersionId') IS NOT DISTINCT FROM document_version_id
  )
);
CREATE INDEX IF NOT EXISTS idx_engineering_matter_material_family
  ON engineering_matter_material_link(tenant_id, family_id, matter_revision_id);
COMMENT ON TABLE engineering_matter_material_link IS
  'Immutable material relationship snapshots; source, scope, expectation and human correction stay versioned with Matter composition.';

-- Same encoding as the existing DM tenantFamilyIdentityPrefix; tenant strings
-- are not assumed to contain only ASCII identifiers.
CREATE OR REPLACE FUNCTION engineering_matter_uri_component(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE bytes bytea := convert_to(value, 'UTF8'); result text := ''; n integer; b integer;
BEGIN
  FOR n IN 0..length(bytes)-1 LOOP
    b := get_byte(bytes, n);
    IF (b BETWEEN 65 AND 90) OR (b BETWEEN 97 AND 122) OR (b BETWEEN 48 AND 57)
      OR b IN (33,39,40,41,42,45,46,95,126) THEN result := result || chr(b);
    ELSE result := result || '%' || upper(lpad(to_hex(b), 2, '0')); END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION engineering_matter_document_owned_by_actor(target_tenant_id varchar, target_version_id varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT engineering_matter_actor_has_tenant(target_tenant_id) AND (
    EXISTS (SELECT 1 FROM work_item w WHERE w.tenant_id = target_tenant_id
      AND w.document_version_id = target_version_id
      AND w.requested_by_user_id = current_setting('app.user_id', true))
    OR EXISTS (SELECT 1 FROM dm_document_version v
      JOIN dm_publication_family f ON f.family_id = v.family_id
      JOIN dm_acquisition a ON a.document_version_id = v.document_version_id AND a.source_artifact_id = v.source_artifact_id
      WHERE v.document_version_id = target_version_id
        AND a.acquired_by = current_setting('app.user_id', true)
        AND a.status IN ('COMMITTED_CANONICAL', 'LINKED_EXACT_DOCUMENT_VERSION')
        AND starts_with(f.canonical_identity_key, 'tenant:' || engineering_matter_uri_component(target_tenant_id) || ':family:')
        AND starts_with(a.idempotency_key, 'tenant:' || engineering_matter_uri_component(target_tenant_id) || ':request:'))
  );
$$;

CREATE OR REPLACE FUNCTION engineering_matter_material_owned_by_actor(target_tenant_id varchar, material jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT engineering_matter_actor_has_tenant(target_tenant_id)
    AND jsonb_typeof(material -> 'basis') = 'array'
    AND CASE WHEN material ->> 'kind' = 'EXPECTED' THEN
      jsonb_typeof(material #> '{expected,fulfilledBy}') = 'array'
      AND jsonb_array_length(material -> 'basis') > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(material #> '{expected,fulfilledBy}') bound
        WHERE engineering_matter_document_owned_by_actor(target_tenant_id, (bound ->> 'documentVersionId')::varchar) IS NOT TRUE
          OR NOT EXISTS (SELECT 1 FROM dm_document_version v WHERE v.document_version_id = bound ->> 'documentVersionId' AND v.family_id = bound ->> 'familyId'))
    ELSE
      engineering_matter_document_owned_by_actor(target_tenant_id, (material ->> 'documentVersionId')::varchar)
      AND EXISTS (SELECT 1 FROM dm_document_version v WHERE v.document_version_id = material ->> 'documentVersionId' AND v.family_id = material ->> 'familyId')
    END
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(material -> 'basis') basis
      WHERE engineering_matter_document_owned_by_actor(target_tenant_id, (basis ->> 'documentVersionId')::varchar) IS NOT TRUE);
$$;

-- Keep the historic all-member rule. Direct materials add another source root;
-- neither an empty Matter nor a partially accessible composition becomes visible.
CREATE OR REPLACE FUNCTION engineering_matter_all_links_owned_by_actor(target_tenant_id varchar, target_matter_revision_id varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT (
    EXISTS (SELECT 1 FROM engineering_matter_revision_work_item l
      WHERE l.tenant_id = target_tenant_id AND l.matter_revision_id = target_matter_revision_id)
    OR EXISTS (SELECT 1 FROM engineering_matter_material_link m
      WHERE m.tenant_id = target_tenant_id AND m.matter_revision_id = target_matter_revision_id)
  ) AND NOT EXISTS (SELECT 1 FROM engineering_matter_revision_work_item l
    WHERE l.tenant_id = target_tenant_id AND l.matter_revision_id = target_matter_revision_id
      AND engineering_matter_work_item_owned_by_actor(target_tenant_id, l.work_item_id) IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM engineering_matter_material_link m
      WHERE m.tenant_id = target_tenant_id AND m.matter_revision_id = target_matter_revision_id
        AND engineering_matter_material_owned_by_actor(target_tenant_id, m.material_json::jsonb) IS NOT TRUE);
$$;

ALTER TABLE engineering_matter_material_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY engineering_matter_material_select ON engineering_matter_material_link
  FOR SELECT TO authenticated, service_role USING (
    engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
  );
CREATE POLICY engineering_matter_material_insert ON engineering_matter_material_link
  FOR INSERT TO authenticated, service_role WITH CHECK (
    created_by_user_id = current_setting('app.user_id', true)
    AND engineering_matter_revision_owned_by_actor(tenant_id, matter_id, matter_revision_id)
    AND engineering_matter_material_owned_by_actor(tenant_id, material_json::jsonb)
  );
-- No UPDATE/DELETE policy: correcting a relationship appends a new snapshot.
CREATE POLICY engineering_matter_direct_revision_insert ON engineering_matter_revision
  FOR INSERT TO authenticated, service_role WITH CHECK (
    changed_work_item_id IS NULL AND material_command_json IS NOT NULL
    AND created_by_user_id = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  );
CREATE POLICY engineering_matter_direct_create ON engineering_matter
  FOR INSERT TO service_role WITH CHECK (
    default_family_id IS NOT NULL
    AND created_by_user_id = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(tenant_id)
  );
CREATE POLICY engineering_matter_direct_update ON engineering_matter
  FOR UPDATE TO service_role USING (
    default_family_id IS NOT NULL
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
  ) WITH CHECK (
    default_family_id IS NOT NULL
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
  );
CREATE POLICY engineering_matter_direct_legacy_link_copy ON engineering_matter_revision_work_item
  FOR INSERT TO service_role WITH CHECK (
    engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_revision_owned_by_actor(tenant_id, matter_id, matter_revision_id)
    AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
  );
COMMIT;
