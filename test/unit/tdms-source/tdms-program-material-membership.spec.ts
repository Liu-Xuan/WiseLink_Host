import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { tdmsRuntimeFixture } from '../fixtures/tdms-runtime.fixture';
import * as stored from '../../../server/modules/tdms-source/tdms-stored-runtime-context';
import { tdmsSavedNativeContext } from '../../../server/modules/tdms-source/tdms-native-saved-work';

describe('program input native evidence membership', () => {
  it.each(['authorized','mode-mismatch','source-not-retained','object-revoked'] as const)('%s keeps exact program membership separate from current object rights', async scenario => {
    const f=tdmsRuntimeFixture();
    const context=await f.adapter.discover(f.principal,f.binding);
    const result=await f.adapter.read(f.principal,{context,evidenceRefs:[context.projection.selectedSetApprovedRefs[0]!],
      purpose:'JOB_AID_NATIVE_RECORD',taskContextRef:f.binding.taskContextRef});
    const evidence=result.evidence[0]!;
    const saved=jest.spyOn(stored,'storedTdmsRuntimeContext').mockResolvedValue({id:'row-1',attemptId:'attempt-1',
      actionType:'OPENCLAW_DYNAMIC_EVALUATION',owner:f.binding.actorUserId,context});
    const queries:Array<{sql:string;params:unknown[]}>=[];
    const database={execute:jest.fn(async (query:SQL) => {
      const rendered=new PgDialect().sqlToQuery(query);queries.push(rendered);
      if(rendered.sql.includes('AS "documentVersionId"')) return [{documentVersionId:f.binding.documentVersionId,owner:f.binding.actorUserId,revision:3}];
      if(rendered.sql.includes('AS retained')) return [{retained:!['mode-mismatch','source-not-retained'].includes(scenario)}];
      return [];
    })};
    const objectAccess={freshRead:jest.fn(async()=>({allowed:scenario!=='object-revoked',action:'READ_WORK_ITEM',
      actorUserId:f.actor.canonicalSubject.id,tenantId:f.actor.tenantId,applicationScopeId:f.actor.applicationScopeId,
      workItemId:f.binding.workItemId,documentVersionId:f.binding.documentVersionId,workItemRevision:3}))};
    try {
      const operation=tdmsSavedNativeContext({database:database as never,evidence,actor:f.actor,objectAccess:objectAccess as never,
        caller:{browserCaller:{actor:f.actor,action:'READ_WORK_ITEM',workItemId:f.binding.workItemId,
          documentVersionId:f.binding.documentVersionId,workItemRevision:3,programAttemptId:'program-exact-1'}}});
      if(scenario==='authorized') expect(await operation).toEqual(context);
      else await expect(operation).rejects.toThrow(scenario==='object-revoked'?'TDMS_NATIVE_CURRENT_OBJECT_DENIED':'TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH');
      const membership=queries.find(query=>query.sql.includes('AS retained'));
      if(scenario==='object-revoked') expect(membership).toBeUndefined();
      else {
        expect(membership?.params).toContain('program-exact-1');
        expect(membership?.sql).toContain("a.actor_user_id='service:openclaw-main'");
        const modeSql: string=membership!.sql.replace(/\s+/gu,' ');
        const outerModePath: string="a.task_envelope_json::jsonb#>>'{modelInput,executionMode}'";
        const innerModePath: string="a.task_envelope_json::jsonb#>>'{modelInput,modelInput,executionMode}'";
        expect(modeSql).toContain(`${outerModePath} IN ('PROGRAM_CONTROLLED_V1','PROGRAM_AGENT_V1')`);
        expect(modeSql).toContain(`${innerModePath} =${outerModePath}`);
        expect(membership?.params).toEqual(expect.arrayContaining([
          f.actor.tenantId,f.binding.workItemId,f.binding.documentVersionId,f.binding.actorUserId,
        ]));
        expect(membership?.sql).toContain("a.task_input_hash=a.task_envelope_json::jsonb->>'inputHash'");
        expect(membership?.sql).toContain('ASSESSMENT_SOURCES_READ');
        expect(membership?.sql).not.toContain('assessment_work_revision');
      }
      expect(objectAccess.freshRead).toHaveBeenCalledTimes(1);
    } finally {saved.mockRestore();}
  });
});
