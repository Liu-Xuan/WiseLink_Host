import { drizzle } from 'drizzle-orm/postgres-js';
import { listOwnedLibraryFamilies } from '@server/modules/document-management/src/hosted/nest/miaoda-hosted-library-query';

it('compiles the tenant library query with verified source selection and tenant-bound visibility', () => {
  const query = listOwnedLibraryFamilies(drizzle.mock() as never, {
    tenantId: 'tenant-test', actorUserId: "actor'quoted", search: '', cursor: null, limit: 20,
  }).toSQL();
  expect(query.sql).not.toContain("actor'quoted");
  expect(query.params).not.toContain("actor'quoted");
  expect(query.sql).not.toContain('"work_item"."requested_by_user_id" = $');
  expect(query.sql).toContain('"work_item"."tenant_id" = $');
  expect(query.params).toContain('tenant:tenant-test:family:');
  expect(query.params).toContain('tenant:tenant-test:request:');
  const readingSelection = query.sql.slice(query.sql.indexOf('left join lateral (select r.run_ref'),
    query.sql.indexOf('left join dm_document_reading_retraction'));
  expect(readingSelection).toContain('p.parse_run_id=r.parse_run_id');
  expect(readingSelection).toContain('s.semantic_revision=r.semantic_revision');
  expect(readingSelection).toContain("p.source_binding->>'pdfSha256'");
  expect(readingSelection).toContain("r.result_json->'sourceBinding'->'original'=jsonb_build_object");
  expect(readingSelection).not.toContain('order by p.parse_revision');
  expect(query.sql).not.toContain('SOURCE_CHANGED');
  expect(query.sql).toContain("when x.run_ref is not null then 'RETRACTED'");
});
