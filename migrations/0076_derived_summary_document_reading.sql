BEGIN;
-- Add independent reading leaves to the existing exact source boundary.
CREATE OR REPLACE FUNCTION derived_summary_reading_sources_owned(t varchar, actor varchar, reading jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE member jsonb; leaf jsonb; e jsonb; saved record; prior jsonb; prior_reading jsonb;
  statement_source jsonb; statement_reference jsonb; statement_original jsonb; statement_saved record;
BEGIN
  IF NOT derived_summary_sql_role_allowed(false)
    OR actor IS DISTINCT FROM current_setting('app.user_id', true)
    OR NOT engineering_matter_actor_has_tenant(t)
    OR jsonb_typeof(reading->'members') IS DISTINCT FROM 'array'
    OR jsonb_typeof(reading->'evidence') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  -- A sealed revision task also carries the old candidate body. Protect that
  -- copy using the exact persisted prior's full source reading, including sources
  -- removed from current members. Never trust only the request's prior refs.
  IF reading->>'purpose'='REVISE_SAVED_SUMMARY' OR reading ? 'revisionContext' THEN
    IF reading->>'purpose' IS DISTINCT FROM 'REVISE_SAVED_SUMMARY'
      OR jsonb_typeof(reading->'revisionContext') IS DISTINCT FROM 'object'
      OR jsonb_typeof(reading->'revisionContext'->'previousSummary') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    prior := reading->'revisionContext'->'previousSummary';
    IF jsonb_typeof(prior->'revision') IS DISTINCT FROM 'number'
      OR (prior->>'revision') !~ '^[1-9][0-9]{0,9}$'
      OR (prior->>'revision')::numeric >= 2147483647 THEN RETURN false; END IF;
    SELECT r.content_json INTO prior_reading FROM derived_summary_revision r
      WHERE r.tenant_id=t AND r.actor_user_id=actor
        AND r.summary_id=prior->>'summaryId' AND r.summary_ref=prior->>'summaryRef'
        AND r.revision=(prior->>'revision')::integer;
    IF NOT FOUND OR jsonb_typeof(prior_reading->'members') IS DISTINCT FROM 'array'
      OR jsonb_typeof(prior_reading->'evidence') IS DISTINCT FROM 'array'
      OR prior_reading ? 'revisionContext'
      OR prior_reading->>'summaryId' IS DISTINCT FROM prior->>'summaryId'
      OR prior_reading->>'summaryRef' IS DISTINCT FROM prior->>'summaryRef'
      OR prior_reading->'revision' IS DISTINCT FROM prior->'revision'
      OR prior->'candidateOnly' IS DISTINCT FROM 'true'::jsonb
      OR prior_reading->'candidateOnly' IS DISTINCT FROM 'true'::jsonb
      OR prior_reading->>'classificationStatus' IS DISTINCT FROM 'CANDIDATE'
      OR prior_reading->'content' IS DISTINCT FROM prior->'content'
      OR prior_reading->'scope' IS DISTINCT FROM prior->'scope' THEN RETURN false; END IF;
    -- A saved revision is a closed material snapshot, not a revision task. Reject
    -- nested revisionContext above and combine the two source bases directly;
    -- no recursive authorization call or circular candidate dependency is added.
    reading := jsonb_build_object('members', (reading->'members') || (prior_reading->'members'),
      'evidence', (reading->'evidence') || (prior_reading->'evidence'));
  END IF;
  FOR member IN SELECT jsonb_array_elements(reading->'members') LOOP
    IF jsonb_typeof(member->'leaves') IS DISTINCT FROM 'array' OR jsonb_array_length(member->'leaves')=0 THEN RETURN false; END IF;
    FOR leaf IN SELECT jsonb_array_elements(member->'leaves') LOOP
      IF leaf->>'kind'='WORK_ITEM_WORK' THEN
        IF NOT engineering_matter_work_item_owned_by_actor(t,(leaf->>'workItemId')::varchar)
          OR NOT engineering_matter_document_owned_by_actor(t,(leaf->>'documentVersionId')::varchar)
          OR NOT EXISTS (SELECT 1 FROM assessment_work_revision r WHERE r.tenant_id=t
            AND r.work_item_id=leaf->>'workItemId' AND r.assessment_work_revision_id=leaf->>'workRef'
            AND r.document_version_id=leaf->>'documentVersionId' AND r.work_revision=(leaf->>'workRevision')::integer
            AND r.created_by_user_id=actor) THEN RETURN false; END IF;
      ELSIF leaf->>'kind'='MATTER_WORK' THEN
        SELECT r.based_on_matter_revision_id,m.current_matter_revision_id INTO saved
          FROM engineering_matter_work_revision r JOIN engineering_matter m
            ON m.tenant_id=r.tenant_id AND m.matter_id=r.matter_id
          WHERE r.tenant_id=t AND r.matter_id=leaf->>'matterId' AND r.matter_work_revision_id=leaf->>'workRef'
            AND r.working_revision=(leaf->>'workRevision')::integer AND r.created_by_user_id=actor;
        IF NOT FOUND OR NOT engineering_matter_owned_by_actor(t,(leaf->>'matterId')::varchar)
          OR NOT engineering_matter_all_links_owned_by_actor(t,saved.based_on_matter_revision_id)
          OR NOT engineering_matter_all_links_owned_by_actor(t,saved.current_matter_revision_id) THEN RETURN false; END IF;
      ELSIF leaf->>'kind'='DOCUMENT_READING' THEN
        SELECT r.document_version_id,r.parse_run_id,r.parse_revision INTO saved
          FROM dm_document_reading_run r
          JOIN dm_document_parse_run p ON p.tenant_id=r.tenant_id AND p.document_version_id=r.document_version_id
            AND p.parse_run_id=r.parse_run_id AND p.parse_revision=r.parse_revision AND p.status='PUBLISHED'
            AND p.manifest_artifact->>'sha256'=r.original_manifest_sha256
          JOIN dm_document_semantic_revision s ON s.tenant_id=r.tenant_id AND s.document_version_id=r.document_version_id
            AND s.parse_run_id=r.parse_run_id AND s.parse_revision=r.parse_revision
            AND s.semantic_revision=r.semantic_revision AND s.original_manifest_sha256=r.original_manifest_sha256
          WHERE r.tenant_id=t AND r.document_version_id=leaf->>'documentVersionId'
            AND r.run_ref=leaf->>'readingRunRef' AND r.parse_run_id=leaf->>'parseRunId'
            AND to_jsonb(r.reading_revision)=leaf->'readingRevision' AND to_jsonb(r.semantic_revision)=leaf->'semanticRevision'
            AND r.status='SAVED' AND r.result_json->>'schemaVersion'='wiselink.document.reading.v1'
            AND r.result_json->'candidateOnly'='true'::jsonb AND r.result_json->>'readingRunRef'=r.run_ref
            AND r.result_json->'readingRevision'=to_jsonb(r.reading_revision)
            AND r.result_json->'sourceBinding'->'semanticRevision'=to_jsonb(r.semantic_revision)
            AND r.result_json->'sourceBinding'->'original'->>'documentVersionId'=r.document_version_id
            AND r.result_json->'sourceBinding'->'original'->>'parseRunId'=r.parse_run_id
            AND r.result_json->'sourceBinding'->'original'->'parseRevision'=to_jsonb(r.parse_revision)
            AND r.result_json->'sourceBinding'->'original'->>'sourceArtifactId'=p.source_binding->>'sourceArtifactId'
            AND r.result_json->'sourceBinding'->'original'->>'sourceSha256'=p.source_binding->>'pdfSha256'
            AND r.result_json->'sourceBinding'->'original'->'sourceByteLength'=p.source_binding->'byteLength'
            AND NOT EXISTS (SELECT 1 FROM dm_document_reading_retraction x WHERE x.tenant_id=r.tenant_id AND x.run_ref=r.run_ref);
        IF NOT FOUND OR document_translation_attempt_owned(t,actor,saved.document_version_id,
          saved.parse_run_id,saved.parse_revision) IS NOT TRUE THEN RETURN false; END IF;
      ELSE RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOR e IN SELECT jsonb_array_elements(reading->'evidence') LOOP
    IF e ? 'sourceStatement' THEN
      statement_source := e->'sourceStatement';
      statement_reference := statement_source->'reference';
      statement_original := statement_source->'sourceBinding'->'original';
      IF e->>'kind' IS DISTINCT FROM 'PRIOR_RESULT' OR e ? 'sourceWork'
        OR jsonb_typeof(statement_source) IS DISTINCT FROM 'object'
        OR jsonb_typeof(statement_reference) IS DISTINCT FROM 'object'
        OR jsonb_typeof(statement_source->'sourceBinding') IS DISTINCT FROM 'object'
        OR jsonb_typeof(statement_original) IS DISTINCT FROM 'object'
        OR jsonb_typeof(statement_reference->'runRef') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_reference->'statementId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_reference->'candidateRevision') IS DISTINCT FROM 'number'
        OR jsonb_typeof(statement_original->'documentVersionId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_original->'parseRunId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_original->'parseRevision') IS DISTINCT FROM 'number'
        OR jsonb_typeof(statement_original->'sourceArtifactId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_original->'sourceSha256') IS DISTINCT FROM 'string'
        OR jsonb_typeof(statement_original->'sourceByteLength') IS DISTINCT FROM 'number'
        OR jsonb_typeof(statement_source->'sourceBinding'->'semanticRevision') IS DISTINCT FROM 'number'
      THEN RETURN false; END IF;
      SELECT a.document_version_id, a.parse_run_id, a.parse_revision INTO statement_saved
        FROM dm_document_activity_run a
        JOIN dm_document_parse_run p ON p.tenant_id=a.tenant_id AND p.document_version_id=a.document_version_id
          AND p.parse_run_id=a.parse_run_id AND p.parse_revision=a.parse_revision
          AND p.manifest_artifact->>'sha256'=a.original_manifest_sha256
        JOIN dm_document_semantic_revision s ON s.tenant_id=a.tenant_id AND s.document_version_id=a.document_version_id
          AND s.parse_run_id=a.parse_run_id AND s.parse_revision=a.parse_revision
          AND s.semantic_revision=a.semantic_revision AND s.original_manifest_sha256=a.original_manifest_sha256
        WHERE a.tenant_id=t AND a.document_version_id=statement_original->>'documentVersionId'
          AND a.parse_run_id=statement_original->>'parseRunId'
          AND to_jsonb(a.parse_revision)=statement_original->'parseRevision'
          AND to_jsonb(a.semantic_revision)=statement_source->'sourceBinding'->'semanticRevision'
          AND a.run_ref=statement_reference->>'runRef'
          AND to_jsonb(a.candidate_revision)=statement_reference->'candidateRevision' AND a.status='SAVED'
          AND p.status='PUBLISHED' AND p.manifest_artifact->>'relativePath'='original/manifest.json'
          AND p.manifest_artifact->>'role'='MANIFEST' AND p.manifest_artifact->>'readback'='VERIFIED'
          AND p.source_binding->>'documentVersionId'=statement_original->>'documentVersionId'
          AND p.source_binding->>'sourceArtifactId'=statement_original->>'sourceArtifactId'
          AND p.source_binding->>'pdfSha256'=statement_original->>'sourceSha256'
          AND p.source_binding->'byteLength'=statement_original->'sourceByteLength'
          AND COALESCE(to_jsonb(a)->>'candidate_schema_version','wiselink.document.activity-candidate.v1')=
            a.result_json->>'schemaVersion'
          AND (a.result_json->>'schemaVersion'='wiselink.document.activity-candidate.v1' OR
            (a.result_json->>'schemaVersion'='wiselink.document.activity-candidate.v2'
              AND jsonb_typeof(to_jsonb(a)->'production_contract_json')='object'
              AND (to_jsonb(a)->'production_contract_json') -
                ARRAY['promptVersion','toolSchemaSha256','sourceContextVersion','quoteTransportVersion']::text[]='{}'::jsonb
              AND jsonb_typeof(to_jsonb(a)->'production_contract_json'->'promptVersion')='string'
              AND length(btrim(to_jsonb(a)->'production_contract_json'->>'promptVersion')) BETWEEN 1 AND 160
              AND jsonb_typeof(to_jsonb(a)->'production_contract_json'->'toolSchemaSha256')='string'
              AND to_jsonb(a)->'production_contract_json'->>'toolSchemaSha256' ~ '^[a-f0-9]{64}$'
              AND to_jsonb(a)->'production_contract_json'->>'sourceContextVersion'='wiselink.document.activity-source-context.v1'
              AND to_jsonb(a)->'production_contract_json'->>'quoteTransportVersion' IN
                ('wiselink.document.activity-quote-offsets.v1','wiselink.document.activity-quote-selection.v1')
              AND jsonb_typeof(a.result_json->'sourceContext')='object'
              AND a.result_json->'sourceContext'->>'schemaVersion'='wiselink.document.activity-source-context.v1'
              AND a.result_json->'sourceContext'->'sourceBinding'=statement_source->'sourceBinding'
              AND jsonb_typeof(a.result_json->'sourceContext'->'sections')='array'
              AND jsonb_typeof(a.result_json->'sourceContext'->'organizationWarnings')='array'
              AND jsonb_typeof(a.result_json->'sourceAnchors')='array'
              AND a.result_json->'readCoverage'->>'status'='DELIVERED_RANGES_ONLY'
              AND a.result_json->'readCoverage'->'selection'=a.selection_json
              AND a.result_json->'readCoverage'->'deliveredRanges'=a.delivered_json
              AND jsonb_typeof(a.result_json->'producer')='object'
              AND a.result_json->'producer'=to_jsonb(a)->'producer_json'))
          AND a.result_json->'candidateOnly'='true'::jsonb
          AND a.result_json->'sourceBinding'=statement_source->'sourceBinding'
          AND a.result_json->>'runRef'=a.run_ref
          AND a.result_json->'candidateRevision'=to_jsonb(a.candidate_revision)
          AND e->>'resultRef'=a.run_ref AND e->'resultRevision'=to_jsonb(a.candidate_revision)
          AND e->>'evidenceRef'='DOCUMENT_ACTIVITY:' || a.run_ref || ':' || a.candidate_revision::text || ':' ||
            (statement_reference->>'statementId')
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
            WHEN jsonb_typeof(a.result_json->'statements')='array' THEN a.result_json->'statements' ELSE '[]'::jsonb END) st
            WHERE st->>'statementId'=statement_reference->>'statementId' AND st->>'label'=e->>'excerpt'
              AND (a.result_json->>'schemaVersion'='wiselink.document.activity-candidate.v1' OR
                (st ?& ARRAY['statementId','statementKey','label','quotes','subject','action','modality','status',
                  'times','technicalIds','scope','limitations']::text[]
                  AND jsonb_typeof(st->'quotes')='array'
                  AND jsonb_array_length(CASE WHEN jsonb_typeof(st->'quotes')='array' THEN st->'quotes' ELSE '[]'::jsonb END)>0
                  AND jsonb_typeof(st->'times')='array' AND jsonb_typeof(st->'technicalIds')='array'
                  AND jsonb_typeof(st->'scope')='object' AND jsonb_typeof(st->'scope'->'conditions')='array'
                  AND jsonb_typeof(st->'scope'->'sectionIds')='array'
                  AND jsonb_typeof(st->'limitations')='array')));
      IF NOT FOUND OR document_translation_attempt_owned(t,actor,statement_saved.document_version_id,
        statement_saved.parse_run_id,statement_saved.parse_revision) IS NOT TRUE THEN RETURN false; END IF;
    END IF;
    IF e->>'kind' IN ('DOCUMENT_PASSAGE','ENGINEER_ATTACHMENT') AND
      NOT engineering_matter_document_owned_by_actor(t,(e->>'documentVersionId')::varchar) THEN RETURN false; END IF;
    IF e->>'workItemId' IS NOT NULL AND
      NOT engineering_matter_work_item_owned_by_actor(t,(e->>'workItemId')::varchar) THEN RETURN false; END IF;
    IF e->'sourceWork'->>'subjectKind'='ENGINEERING_MATTER' AND
      NOT engineering_matter_owned_by_actor(t,(e->'sourceWork'->>'subjectId')::varchar) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
COMMIT;
