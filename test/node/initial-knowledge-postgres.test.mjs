import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

const url = process.env.INITIAL_KNOWLEDGE_TEST_DATABASE_URL;
test(
  'initial knowledge RLS preserves exact owner/session/agent/attempt and existing routes',
  { skip: !url },
  async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/wiselink_initial_knowledge_test');
    const pg = postgres(url, { max: 1, onnotice() {} });
    const session = '11111111-1111-1111-1111-111111111111';
    try {
      await pg.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE identity_subject_mapping(id uuid, miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);
      CREATE TABLE identity_session(id uuid PRIMARY KEY, subject_mapping_id uuid, revoked_at timestamptz, expires_at timestamptz);
      CREATE TABLE work_item(work_item_id text PRIMARY KEY,tenant_id text,requested_by_user_id text);
      CREATE TABLE action_attempt(attempt_id varchar(96) PRIMARY KEY, work_item_id text, tenant_id text, actor_user_id text, action_type text, status text,task_envelope_json text);
      CREATE TABLE dialogue_message(message_ref uuid PRIMARY KEY,tenant_id text,actor_id text,purpose text,executor text,request_key text);`);
      await pg.unsafe(
        await readFile(
          new URL(
            '../../migrations/0029_review_aily_user_delegation.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const catalog = await readFile(
        new URL(
          '../../migrations/0014_engineering_matter_catalog.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await pg.unsafe(
        catalog.match(
          /CREATE OR REPLACE FUNCTION engineering_matter_actor_has_tenant\([\s\S]+?\$\$;/u,
        )[0],
      );
      await pg`INSERT INTO identity_subject_mapping VALUES (${session},'actor-test','tenant-test','cli_aadde8b579f95bc9','ACTIVE')`;
      const dialogue = await readFile(
        new URL('../../migrations/0030_personal_dialogue.sql', import.meta.url),
        'utf8',
      );
      await pg.unsafe(
        dialogue.slice(
          dialogue.indexOf('ALTER TABLE review_aily_query'),
          dialogue.indexOf('COMMENT ON TABLE dialogue_thread'),
        ),
      );
      await pg.unsafe(
        await readFile(
          new URL(
            '../../migrations/0031_initial_assessment_knowledge.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await pg.unsafe(
        'GRANT USAGE ON SCHEMA public TO service_role; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;',
      );
      await pg`INSERT INTO identity_session(id) VALUES (${session})`;
      await pg`INSERT INTO work_item VALUES ('WI-test','tenant-test','actor-test',${session})`;
      const envelope = (overrides = {}) =>
        JSON.stringify({
          modelInput: {
            knowledgeBinding: { sessionId: session, agentId: 'agent-test' },
          },
          allowedConnectors: ['feishu-aily-user'],
          ...overrides,
        });
      await pg`INSERT INTO action_attempt VALUES ('ATT-test','WI-test','tenant-test','service-test','OPENCLAW_DYNAMIC_EVALUATION','RUNNING',${envelope()})`;
      const act = (actor, fn) =>
        pg.begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE service_role');
          await tx`SELECT set_config('app.user_id',${actor},true)`;
          return fn(tx);
        });
      const insert = (changes = {}, actor = 'actor-test') =>
        act(
          actor,
          (tx) =>
            tx`INSERT INTO review_aily_query ${tx({ query_ref: randomUUID(), attempt_ref: 'ATT-test', tenant_id: 'tenant-test', actor_id: 'actor-test', session_id: session, agent_id: 'agent-test', request_key: randomUUID(), query_text: 'query', status: 'RUNNING', ...changes })} RETURNING query_ref`,
        );
      const [created] = await insert();
      for (const changes of [
        { tenant_id: 'wrong' },
        { actor_id: 'wrong' },
        { session_id: randomUUID() },
        { agent_id: 'wrong' },
        { attempt_ref: 'missing' },
        { remote_session_id: 'unrequested' },
      ]) {
        await assert.rejects(insert(changes), /row-level security/u);
      }
      await assert.rejects(insert({}, 'wrong'), /row-level security/u);
      assert.equal(
        (await act('wrong', (tx) => tx`SELECT * FROM review_aily_query`))
          .length,
        0,
      );
      await pg`UPDATE action_attempt SET task_envelope_json=${envelope({ allowedConnectors: [] })} WHERE attempt_id='ATT-test'`;
      await assert.rejects(insert(), /row-level security/u);
      await pg`UPDATE action_attempt SET task_envelope_json=${envelope()}, status='CANCELLED' WHERE attempt_id='ATT-test'`;
      await assert.rejects(insert(), /row-level security/u);
      const saved = await act(
        'actor-test',
        (tx) =>
          tx`UPDATE review_aily_query SET status='UNKNOWN',answer_text='partial',remote_session_id='returned-session' WHERE query_ref=${created.query_ref} RETURNING status`,
      );
      assert.equal(saved[0].status, 'UNKNOWN');
      await pg`UPDATE action_attempt SET status='RUNNING',action_type='OPENCLAW_OVERALL_SYNTHESIS' WHERE attempt_id='ATT-test'`;
      assert.equal((await insert()).length, 1);
      await pg`UPDATE work_item SET initial_aily_session_id=NULL`;
      await assert.rejects(insert(), /row-level security/u);
      await pg`INSERT INTO action_attempt VALUES ('ATT-review','WI-test','tenant-test','actor-test','OPENCLAW_INTERACTIVE_REVIEW','RUNNING','{}')`;
      assert.equal((await insert({ attempt_ref: 'ATT-review' })).length, 1);
      const message = randomUUID();
      await pg`INSERT INTO dialogue_message VALUES (${message},'tenant-test','actor-test','CHAT','AILY','message-request')`;
      assert.equal(
        (
          await insert({
            attempt_ref: null,
            message_ref: message,
            request_key: 'message-request',
          })
        ).length,
        1,
      );
    } finally {
      await pg.end();
    }
  },
);
