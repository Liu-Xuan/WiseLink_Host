import { Inject, Logger, Optional } from '@nestjs/common';
import {
  Automation,
  BindTrigger,
} from '@lark-apaas/fullstack-nestjs-core';

import type {
  FeishuNativeOemSearchRun,
  FeishuNativeOemServerContext,
} from './feishu-native-oem-monitoring-ingress';
import { ExternalDiscoveryService } from './external-discovery.service';

export const OPENCLAW_OEM_DISCOVERY_PORT = Symbol(
  'OPENCLAW_OEM_DISCOVERY_PORT',
);

export const EXTERNAL_DISCOVERY_AUTOMATION_NAME =
  'wiselink-oem-discovery-monitor';

export interface OpenClawOemDiscoveryResult {
  searchRun: FeishuNativeOemSearchRun;
  serverContext: FeishuNativeOemServerContext;
}

export interface OpenClawOemDiscoveryPort {
  discoverOnce(): Promise<OpenClawOemDiscoveryResult>;
}

export interface ExternalDiscoveryAutomationResult {
  status: 'SEARCH_RUN_RECORDED';
  searchRunRef: string;
  resultStatus: FeishuNativeOemSearchRun['resultStatus'];
  candidateCount: number;
}

@Automation()
export class ExternalDiscoveryAutomation {
  private readonly logger = new Logger(ExternalDiscoveryAutomation.name);

  constructor(
    private readonly externalDiscovery: ExternalDiscoveryService,
    @Optional()
    @Inject(OPENCLAW_OEM_DISCOVERY_PORT)
    private readonly discoveryPort?: OpenClawOemDiscoveryPort,
  ) {}

  @BindTrigger(EXTERNAL_DISCOVERY_AUTOMATION_NAME)
  async runOnce(): Promise<ExternalDiscoveryAutomationResult> {
    if (!this.discoveryPort) {
      throw Object.assign(
        new Error('OpenClaw OEM discovery port is not configured.'),
        { code: 'OPENCLAW_OEM_DISCOVERY_PORT_UNCONFIGURED' },
      );
    }
    const result = await this.discoveryPort.discoverOnce();
    await this.externalDiscovery.recordSearchRun(
      result.searchRun,
      result.serverContext,
    );
    this.logger.log(
      `Recorded OEM discovery run ${result.searchRun.searchRunRef}`,
    );
    return {
      status: 'SEARCH_RUN_RECORDED',
      searchRunRef: result.searchRun.searchRunRef,
      resultStatus: result.searchRun.resultStatus,
      candidateCount: result.searchRun.candidates.length,
    };
  }
}
