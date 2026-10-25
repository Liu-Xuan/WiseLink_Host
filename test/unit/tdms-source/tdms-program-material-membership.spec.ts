import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { tdmsRuntimeFixture } from '../fixtures/tdms-runtime.fixture';
import * as stored from '../../../server/modules/tdms-source/tdms-stored-runtime-context';
import { tdmsSavedNativeContext } from '../../../server/modules/tdms-source/tdms-native-saved-work';

describe('program input native evidence membership', () => {
  it.each(['authorized','source-not-retained','object-revoked'] as const)('%s keeps exact program membership separate from current object rights', async scenario => {
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
      if(rendered.sql.includes('AS retained')) return [{retained:scenario!=='source-not-retained'}];
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
        expect(membership?.sql).toContain('PROGRAM_CONTROLLED_V1');
        expect(membership?.sql).toContain('ASSESSMENT_SOURCES_READ');
        expect(membership?.sql).not.toContain('assessment_work_revision');
      }
      expect(objectAccess.freshRead).toHaveBeenCalledTimes(1);
    } finally {saved.mockRestore();}
  });
});
