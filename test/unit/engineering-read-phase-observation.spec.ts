import { EngineeringReadPhaseObservation } from '../../server/modules/canonical-host/engineering-read-phase-observation';

describe('request-scoped read timing', () => {
  it('keeps concurrent scopes and execution relationships stable when completions reverse', async () => {
    const root = new EngineeringReadPhaseObservation({ timeline: true });
    const first = root.scope({ windowIndex: 0, rootSlot: 0, readInstance: root.nextReadInstance() });
    const second = root.scope({ windowIndex: 0, rootSlot: 1, readInstance: root.nextReadInstance() });
    let release!: () => void;
    const pending = first.measure('member_identity', () => new Promise<void>(resolve => { release = resolve; }));
    await second.measure('member_identity', async () => 2);
    release();
    await pending;
    const timeline = root.timelineSnapshot()!;
    const scopes = timeline.events.map(event => timeline.scopes[event[1]]);
    expect(scopes).toEqual([second.context, first.context]);
    expect(timeline.events[0][3]).toBeLessThanOrEqual(timeline.events[1][3]);
    expect(first.context).not.toBe(second.context);
    expect(root.context).toEqual({});
    expect(root.snapshot().member_identity.count).toBe(2);
    const recursive = first.scope({ parentReadInstance: first.context.readInstance,
      readInstance: root.nextReadInstance(), attempt: 1, depth: 1 });
    expect(recursive.context).toMatchObject({ readInstance: 2, parentReadInstance: 0, attempt: 1, depth: 1 });
    expect(first.context).not.toHaveProperty('depth');
  });

  it('preserves the exact thrown object and records both synchronous and asynchronous failure', async () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true });
    const failure = new Error('private payload must not be logged');
    await expect(observation.measure('grant', async () => { throw failure; })).rejects.toBe(failure);
    try { observation.measureSync('projection', () => { throw failure; }); }
    catch (error) { expect(error).toBe(failure); }
    expect(observation.timelineSnapshot()!.events.map(event => event[4])).toEqual(['error', 'error']);
    expect(JSON.stringify(observation.timelineSnapshot())).not.toContain(failure.message);
  });

  it('limits events and bytes without dropping aggregate measurements', () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true, maxEvents: 2 });
    for (let i = 0; i < 10; i++) observation.measureSync('parse', () => i);
    expect(observation.timelineSnapshot()).toMatchObject({ truncated: true, droppedEvents: 8 });
    expect(observation.timelineSnapshot()!.events).toHaveLength(2);
    expect(observation.snapshot().parse.count).toBe(10);
    const bytes = new EngineeringReadPhaseObservation({ timeline: true, maxEvents: 2048 });
    for (let i = 0; i < 2048; i++) bytes.scope({ readInstance: i, rootSlot: i }).mark('arrive');
    expect(bytes.timelineSnapshot()!.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bytes.timelineSnapshot()))).toBeLessThanOrEqual(48000);
  });

  it('retains request and window duration after timeline exhaustion', async () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true, maxEvents: 1 });
    observation.mark('start');
    await observation.scope({ windowIndex: 0 }).measure('read_group_wait', async () => 1);
    observation.mark('end');
    expect(observation.timelineSnapshot()).toMatchObject({ truncated: true, droppedEvents: 2 });
    const window = observation.windowSnapshot().timings[0];
    expect(window[0]).toBe(0);
    expect(window[2]).toBeGreaterThanOrEqual(window[1]);
    expect(observation.elapsedMs()).toBeGreaterThanOrEqual(window[2]);
  });

  it('fits a representative 21-root page while preserving the disabled aggregate-only path', () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true });
    for (let slot = 0; slot < 21; slot++) {
      const root = observation.scope({ windowIndex: Math.floor(slot / 4), rootSlot: slot % 4,
        readInstance: observation.nextReadInstance(), depth: 0, attempt: 0 });
      for (let stage = 0; stage < 22; stage++) root.measureSync(`phase_${stage}`, () => 1);
      for (let stage = 0; stage < 6; stage++) root.mark(`batch_${stage}`, 'ok', { participants: 4, skipped: 0 });
    }
    expect(observation.timelineSnapshot()!.truncated).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(observation.timelineSnapshot()))).toBeLessThan(48000);
    const disabled = new EngineeringReadPhaseObservation();
    disabled.measureSync('parse', () => 1);
    expect(disabled.timelineSnapshot()).toBeUndefined();
    expect(disabled.snapshot().parse.count).toBe(1);
  });
});
