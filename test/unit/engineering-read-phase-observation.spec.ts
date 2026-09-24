import { createHash } from 'node:crypto';
import { EngineeringReadPhaseObservation, engineeringReadTimelineLogParts,
  engineeringReadWindowLogParts } from
  '../../server/modules/canonical-host/engineering-read-phase-observation';

function reassembleTimeline(parts: { manifest: { segmentCount: number; byteLength: number; sha256: string };
  segments: Array<{ segmentIndex: number; segmentCount: number; sha256: string; payloadBase64: string }> }) {
  if (parts.segments.length !== parts.manifest.segmentCount) throw new Error('MISSING_SEGMENT');
  const ordered = [...parts.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (ordered.some((segment, index) => segment.segmentIndex !== index ||
    segment.segmentCount !== parts.manifest.segmentCount ||
    segment.sha256 !== parts.manifest.sha256)) throw new Error('MISSING_OR_MIXED_SEGMENT');
  const bytes = Buffer.concat(ordered.map(segment => Buffer.from(segment.payloadBase64, 'base64')));
  if (bytes.length !== parts.manifest.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== parts.manifest.sha256)
    throw new Error('CORRUPT_SEGMENT');
  return JSON.parse(bytes.toString('utf8'));
}

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

  it('splits a full 21-root timeline below the hosted log limit and detects lost segments', () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true, maxEvents: 2048 });
    const rootPhases = [
      'current_snapshot_read', 'current_member_grant', 'current_member_identity',
      'current_snapshot_confirm', 'matter_authorize_current', 'saved_row_await',
      'saved_state_parse', 'saved_sources_await', 'overview_origin_await',
      'notice_attempts_query', 'notice_saves_query', 'notice_projection',
      'matter_read_saved', 'saved_member_grant', 'saved_member_identity',
      'matter_recheck_saved_members', 'matter_exact_read',
    ];
    for (let slot = 0; slot < 21; slot++) {
      const root = observation.scope({ windowIndex: Math.floor(slot / 4), rootSlot: slot % 4,
        readInstance: observation.nextReadInstance(), depth: 0, attempt: 0 });
      for (const phase of rootPhases) root.measureSync(phase, () => 1);
      if (slot === 13 || slot === 17) {
        const recursive = root.scope({ depth: 1, readInstance: observation.nextReadInstance(),
          parentReadInstance: root.context.readInstance });
        for (const phase of ['prior_current_matter_await', 'prior_current_links_await',
          'prior_saved_row_await', 'prior_saved_links_await', 'prior_recursive_read',
          'prior_verify_reference_js']) recursive.measureSync(phase, () => 1);
      }
    }
    const timeline = observation.timelineSnapshot()!;
    const parts = engineeringReadTimelineLogParts(timeline);
    expect(parts.segments.length).toBeGreaterThan(1);
    expect(parts.manifest.truncated).toBe(timeline.truncated);
    expect(timeline.truncated).toBe(false);
    expect(reassembleTimeline({ ...parts, segments: [...parts.segments].reverse() })).toEqual(timeline);
    for (const segment of parts.segments) {
      const hostedBody = JSON.stringify({ 0: segment, 1: 'EngineeringIssueSearchService' });
      expect(Buffer.byteLength(hostedBody, 'utf8')).toBeLessThan(8192);
      expect(hostedBody).not.toContain('subjectId');
    }
    expect(() => reassembleTimeline({ ...parts, segments: parts.segments.slice(1) }))
      .toThrow('MISSING_SEGMENT');
    const damaged = [...parts.segments];
    damaged[0] = { ...damaged[0], payloadBase64: Buffer.from('damaged').toString('base64') };
    expect(() => reassembleTimeline({ ...parts, segments: damaged })).toThrow('CORRUPT_SEGMENT');
  });

  it('keeps a conservatively sized 200-window aggregate recoverable below the log limit', async () => {
    const observation = new EngineeringReadPhaseObservation({ timeline: true });
    for (let window = 0; window < 200; window++)
      await observation.scope({ windowIndex: window }).measure('read_group_wait', async () => 1);
    for (const phase of [
      'candidate_query', 'current_snapshot_read', 'current_member_grant',
      'current_member_identity', 'current_snapshot_confirm', 'matter_authorize_current',
      'saved_row_batch_query', 'saved_row_batch_distribution', 'saved_row_await',
      'saved_state_parse', 'saved_sources_batch_query', 'saved_sources_batch_distribution',
      'saved_sources_await', 'overview_origin_batch_query', 'overview_origin_batch_distribution',
      'overview_origin_await', 'notice_attempts_query', 'notice_saves_query',
      'notice_projection', 'matter_read_saved', 'saved_member_grant',
      'saved_member_identity', 'matter_recheck_saved_members', 'matter_exact_read',
      'prior_current_matter_await', 'prior_current_links_await', 'prior_saved_row_await',
      'prior_saved_links_await', 'prior_recursive_read', 'prior_verify_reference_js',
    ]) observation.measureSync(phase, () => 1);
    const windows = observation.windowSnapshot();
    // Use six-digit request-relative times so the test does not rely on the
    // very short intervals of a unit test process.
    windows.timings = windows.timings.map(([index]) =>
      [index, 99999.12 + index, 100000.45 + index, 'ok']);
    const windowParts = engineeringReadWindowLogParts(windows);
    expect(reassembleTimeline(windowParts)).toEqual(windows);
    for (const segment of windowParts.segments)
      expect(Buffer.byteLength(JSON.stringify({ 0: segment, 1: 'EngineeringIssueSearchService' })))
        .toBeLessThan(8192);
    const summary = {
      event: 'ENGINEERING_KNOWLEDGE_CATALOGUE_PHASES', scope: 'ALL', status: 'ok',
      candidateBatches: 5, visibleEntries: 20, durationMs: observation.elapsedMs(),
      windowManifest: windowParts.manifest, phases: observation.snapshot(),
      timelineManifest: engineeringReadTimelineLogParts(observation.timelineSnapshot()!).manifest,
    };
    const hostedBody = JSON.stringify({ 0: summary, 1: 'EngineeringIssueSearchService' });
    expect(Buffer.byteLength(hostedBody, 'utf8')).toBeLessThan(8192);
  });
});
