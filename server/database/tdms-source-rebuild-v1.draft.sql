-- REBUILD v1, NEW DRAFT ONLY. NOT EXECUTED.
-- Default-deny RLS: no roles or broad policies are granted here.
-- Deployment needs verified SDK actor/tenant and native scope policy binding, physical PG acceptance.
BEGIN;
CREATE TABLE tdms_capture (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  capture_ref TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,source_key,source_instance_id,scope_id,package_id)
 );
ALTER TABLE tdms_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_capture FORCE ROW LEVEL SECURITY;
CREATE TABLE tdms_record (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  source_revision_ref TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,source_key,source_instance_id,scope_id,record_kind,source_record_id)
 );
ALTER TABLE tdms_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_record FORCE ROW LEVEL SECURITY;
CREATE TABLE tdms_record_revision (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  source_revision_ref TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,source_revision_ref)
 );
ALTER TABLE tdms_record_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_record_revision FORCE ROW LEVEL SECURITY;
CREATE TABLE tdms_relation (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  source_relation_id TEXT NOT NULL,
  relation_ref TEXT NOT NULL,
  assertion_ref TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,source_key,source_instance_id,scope_id,source_relation_id)
 );
ALTER TABLE tdms_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_relation FORCE ROW LEVEL SECURITY;
CREATE TABLE tdms_relation_assertion (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  assertion_ref TEXT NOT NULL,
  relation_ref TEXT NOT NULL,
  from_revision_ref TEXT,
  to_revision_ref TEXT,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,assertion_ref)
 );
ALTER TABLE tdms_relation_assertion ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_relation_assertion FORCE ROW LEVEL SECURITY;
CREATE TABLE tdms_read_receipt (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  receipt_ref TEXT NOT NULL,
  source_revision_ref TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (tenant_id,receipt_ref)
 );
ALTER TABLE tdms_read_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_read_receipt FORCE ROW LEVEL SECURITY;
CREATE INDEX tdms_relation_assertion_from ON tdms_relation_assertion (tenant_id,from_revision_ref);
CREATE INDEX tdms_relation_assertion_to ON tdms_relation_assertion (tenant_id,to_revision_ref);
COMMIT;
