import 'reflect-metadata';
import postgres from 'postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DialogueRepository } from '../../server/modules/canonical-host/dialogue.repository';

// Opt-in, disposable local PostgreSQL only. Never reads a configured application DB.
const socket = process.env.WL_TEST_POSTGRES_SOCKET;
(socket ? describe : describe.skip)(
  'dialogue consumption PostgreSQL joins',
  () => {
    it('requires exact contribution revision, completed turn, saved working and actual collection read', async () => {
      if (!socket?.startsWith('/private/tmp/'))
        throw new Error('LOCAL_TEST_SOCKET_REQUIRED');
      const client = postgres({
        host: socket,
        port: 55439,
        database: 'postgres',
        max: 1,
      });
      try {
        await client.unsafe(`
        CREATE TEMP TABLE discussion_contribution (contribution_ref uuid, tenant_id text, actor_id text, work_item_id text, revision int, status text, _created_at timestamptz DEFAULT now());
        CREATE TEMP TABLE dialogue_assessment_request (request_ref uuid, tenant_id text, actor_id text, work_item_id text, review_turn_id text, review_conversation_id text, request_json text, input_json text);
        CREATE TEMP TABLE review_turn (review_turn_id text, tenant_id text, actor_id text, work_item_id text, review_conversation_id text, request_id text, action_attempt_id text, assistant_completed_at timestamptz, assistant_response text);
        CREATE TEMP TABLE assessment_work_revision (assessment_work_revision_id text, action_attempt_id text, tenant_id text, work_item_id text, created_by_user_id text, content_json text, work_revision int);
      `);
        for (let index = 1; index <= 7; index++) {
          const ref = `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
          const actor = index === 7 ? 'other' : 'actor';
          await client`INSERT INTO discussion_contribution VALUES (${ref},'tenant',${actor},'WI-A',1,'ACTIVE',now())`;
          await client`INSERT INTO dialogue_assessment_request VALUES (${ref},'tenant',${actor},'WI-A',${`RT-${index}`},'RC-1',${JSON.stringify(index >= 5 ? { collectionMode: 'ALL_PENDING' } : {})},${JSON.stringify({ contributions: [{ contributionRef: ref, revision: index === 4 ? 2 : 1 }] })})`;
          await client`INSERT INTO review_turn VALUES (${`RT-${index}`},'tenant',${actor},'WI-A','RC-1',${`dialogue-${ref}`},${`AQ-${index}`},${index === 2 ? null : new Date()},${index === 2 ? null : 'saved candidate'})`;
          if (index !== 3)
            await client`INSERT INTO assessment_work_revision VALUES (${`JAWR-${index}`},${`AQ-${index}`},'tenant','WI-A',${actor},${JSON.stringify({ readSourceRefs: index === 6 ? [`dialogue-contribution:${ref}:${ref}:1`] : [] })},1)`;
        }
        const repository = new DialogueRepository({
          withActorTransaction: async (
            _actor: string,
            run: (value: unknown) => unknown,
          ) =>
            run({
              database: {
                execute: async (
                  query: Parameters<PgDialect['sqlToQuery']>[0],
                ) => {
                  const compiled = new PgDialect().sqlToQuery(query);
                  return client.unsafe(
                    compiled.sql,
                    compiled.params as never[],
                  );
                },
              },
            }),
        } as never);
        const rows = await repository.relevantContributions(
          { actorId: 'actor', tenantId: 'tenant' },
          ['WI-A'],
        );
        expect(rows.map((row) => row.consumed_working_ref)).toEqual([
          'JAWR-1',
          null,
          null,
          null,
          null,
          'JAWR-6',
        ]);
      } finally {
        await client.end();
      }
    });
  },
);
