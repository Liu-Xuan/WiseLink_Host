import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { workItem } from '../../server/database/schema';
import { MiaodaConfigurationEvidenceStore } from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence.repository';
import { preserveWorkItemModelConfigurationAudit } from '../../server/modules/work-item/model-configuration-audit';
jest.mock('../../server/modules/canonical-host/configuration-evidence/configuration-evidence-work-item.transition', () => ({ adoptConfigurationEvidenceIntoWorkItem: ({ current }: { current: Record<string, unknown> }) => ({ ...current, revision: Number(current.revision) + 1 }) }));
function storeClass() {
 if (process.env.WL_TEST_MODEL_AUDIT_BASELINE !== '1') return MiaodaConfigurationEvidenceStore;
 const path = 'server/modules/canonical-host/configuration-evidence/configuration-evidence.repository.ts';
 const code = execFileSync('git', ['show', `94e09bcc:${path}`], { encoding: 'utf8' });
 const ts = require('typescript');
 const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
 const module = { exports: {} as { MiaodaConfigurationEvidenceStore: typeof MiaodaConfigurationEvidenceStore } };
 new Function('require', 'module', 'exports', output)((id: string) => require(id.startsWith('.') ? resolve(process.cwd(), path, '..', id) : id), module, module.exports);
 return module.exports.MiaodaConfigurationEvidenceStore;
}
it('constructs the actual configuration-evidence UPDATE with a live audit merge after a stale projection read', async () => {
 const projection = { schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate', workItemId: 'WI-1', revision: 3 };
 const lateAudit = [{ configurationRequestId: 'late-applied-setting' }];
 const intercept = jest.fn();
 const tx = { select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === workItem ? [{ workItemId: 'WI-1', revision: 3, projectionJson: JSON.stringify(projection) }] : [] }) }) }), update: (table: unknown) => ({ set: (values: { projectionJson: string | SQL }) => { expect(table).toBe(workItem); intercept(values.projectionJson); return { where: () => ({ returning: async () => { throw new Error('UPDATE_SHAPE_CAPTURED'); } }) }; } }) };
 const Store = storeClass(); const store = new Store({ transaction: async (f: (db: typeof tx) => unknown) => f(tx) } as never);
 await expect(store.commit({ tenantId: 'tenant-1', actorId: 'actor-1', workItemId: 'WI-1', expectedWorkItemRevision: 3, request: { requestId: 'CFG-1' }, snapshot: { facts: [], coverage: { requestedTargetCount: 0 } }, recordedAt: '2026-10-10T00:00:00Z' } as never)).rejects.toThrow('UPDATE_SHAPE_CAPTURED');
 const value = intercept.mock.calls[0][0];
 // This is a statement-shape / interleaving simulation, not a live PostgreSQL transaction.
 let simulated;
 if (typeof value === 'string') simulated = JSON.parse(value);
 else { const query = new PgDialect().sqlToQuery(value); expect(query.sql).toContain('jsonb_build_object'); expect(query.sql).toContain('"work_item"."projection_json"'); simulated = { ...JSON.parse(query.params[0] as string), modelConfigurationApplications: lateAudit }; }
 expect(simulated.modelConfigurationApplications).toEqual(lateAudit);
 expect(simulated).toMatchObject({ workItemId: 'WI-1', revision: 4, schemaVersion: projection.schemaVersion });
});
it('uses the database audit even if a replacement DTO contains a different audit', () => {
 const query = new PgDialect().sqlToQuery(preserveWorkItemModelConfigurationAudit({ revision: 4, modelConfigurationApplications: ['stale'] }));
 expect(query.sql).toMatch(/jsonb_build_object\('modelConfigurationApplications', "work_item"\."projection_json"::jsonb->'modelConfigurationApplications'\)/u);
});
