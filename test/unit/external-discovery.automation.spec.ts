import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ExternalDiscoveryAutomation,
  type OpenClawOemDiscoveryPort,
} from '../../server/modules/external-discovery/external-discovery.automation';
import type {
  FeishuNativeOemSearchRun,
  FeishuNativeOemServerContext,
} from '../../server/modules/external-discovery/feishu-native-oem-monitoring-ingress';
import { ExternalDiscoveryService } from '../../server/modules/external-discovery/external-discovery.service';

const AUTOMATION_CONTEXT: FeishuNativeOemServerContext = {
  actorUserId: 'miaoda-automation:oem-discovery',
  tenantId: 'tenant-local-phase6e',
  roles: ['automation'],
};

class MemoryCandidateStore {
  readonly runs = new Map<string, FeishuNativeOemSearchRun>();

  async recordSearchRun(run: FeishuNativeOemSearchRun) {
    this.runs.set(run.searchRunRef, structuredClone(run));
    return { disposition: 'RECORDED', searchRun: structuredClone(run) };
  }

  async readSearchRun(searchRunRef: string) {
    return structuredClone(this.runs.get(searchRunRef) ?? null);
  }

  async listSearchRuns() {
    return [...this.runs.values()].map((searchRun) => ({
      searchRun: structuredClone(searchRun),
      reviews: new Map(),
    }));
  }
}

describe('ExternalDiscoveryAutomation native binding', () => {
  it('fails before candidate-store I/O when the host port is unconfigured', async () => {
    const store = new MemoryCandidateStore();
    const documentManagement = { ingestFileServiceSelection: jest.fn() };
    const service = new ExternalDiscoveryService(
      store as never,
      documentManagement as never,
    );
    const automation = new ExternalDiscoveryAutomation(service);

    await expect(automation.runOnce()).rejects.toMatchObject({
      code: 'OPENCLAW_OEM_DISCOVERY_PORT_UNCONFIGURED',
    });
    expect(store.runs.size).toBe(0);
    expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });

  it('records the saved real zero-result as one run and zero candidates', async () => {
    const fixture = readJson('openclaw-first-oem-discovery-only.json');
    const run: FeishuNativeOemSearchRun = {
      searchRunRef: 'openclaw-real-zero-20260815-001',
      sourceSystem: `OPENCLAW_HOSTED_DISCOVERY:${String(fixture.hostedAppId)}`,
      query: String(fixture.query),
      resultStatus: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
      observedAt: '2026-08-15T08:00:00.000Z',
      accessRestricted: fixture.accessRestricted === true,
      truncated: fixture.truncated === true,
      partialOnly: fixture.partialOnly === true,
      candidates: [],
    };
    const result = await runWithPort(run);

    expect(result.output).toMatchObject({
      resultStatus: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
      candidateCount: 0,
    });
    expect(result.store.runs.get(run.searchRunRef)?.candidates).toHaveLength(0);
    expect(result.documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });

  it('records a local complete direct match and leaves it pending human review', async () => {
    const run = readJson(
      'local-complete-oem-direct-match.discovery.json',
    ) as unknown as FeishuNativeOemSearchRun;
    const result = await runWithPort(run);
    const page = await result.service.list(AUTOMATION_CONTEXT);

    expect(result.output).toMatchObject({
      resultStatus: 'CANDIDATES_FOUND',
      candidateCount: 1,
    });
    expect(page.searchRuns[0]?.candidates[0]).toMatchObject({
      reviewStatus: 'PENDING',
      eligibleForHumanSelection: true,
    });
    expect(result.documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });
});

async function runWithPort(run: FeishuNativeOemSearchRun) {
  const store = new MemoryCandidateStore();
  const documentManagement = { ingestFileServiceSelection: jest.fn() };
  const service = new ExternalDiscoveryService(
    store as never,
    documentManagement as never,
  );
  const port: OpenClawOemDiscoveryPort = {
    discoverOnce: async () => ({
      searchRun: structuredClone(run),
      serverContext: AUTOMATION_CONTEXT,
    }),
  };
  const automation = new ExternalDiscoveryAutomation(service, port);
  const output = await automation.runOnce();
  return { documentManagement, output, service, store };
}

function readJson(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'test/fixtures', fileName), 'utf8'),
  ) as Record<string, unknown>;
}
