import { wlCardTemplates } from '../templates';

const WL_CARD_OFFICIAL_WIRING_STATUS = 'UNCONFIGURED' as const;

/* ============================================================
 * WiseLink 3.1 · Card Template Registry
 * 模板业务名 / 飞书模板 ID / 当前版本 / 适用状态 / 变量 Schema /
 * 支持渠道 / 业务动作。模板托管与官方事件接线均显式 fail closed。
 * ============================================================ */

export interface RegisteredCardTemplate {
  id: string;
  businessName: string;
  feishuTemplateKey: string | null;
  hostingStatus: 'CONFIGURED' | 'UNCONFIGURED';
  officialWiringStatus: typeof WL_CARD_OFFICIAL_WIRING_STATUS;
  version: string;
  stages: readonly string[];
  variables: readonly {
    name: string;
    description: string;
    required: boolean;
  }[];
  channels: readonly string[];
  actions: readonly string[];
  targetAgentId: typeof WISELINK_TEAM_AGENT_ID;
}

/** R08 rev293: the only current team-partner entry point. */
export const WISELINK_TEAM_AGENT_ID = 'agent_4km47c77ujwqphg' as const;

export const cardTemplateRegistry: readonly RegisteredCardTemplate[] =
  wlCardTemplates.map((template) => ({
    id: template.id,
    businessName: template.businessName,
    feishuTemplateKey: template.feishuTemplateKey,
    hostingStatus: template.feishuTemplateKey ? 'CONFIGURED' : 'UNCONFIGURED',
    officialWiringStatus: WL_CARD_OFFICIAL_WIRING_STATUS,
    version: template.version,
    stages: template.stages,
    variables: template.variables,
    channels: template.channels,
    actions: template.actions,
    targetAgentId: WISELINK_TEAM_AGENT_ID,
  }));

export function findRegisteredTemplate(
  id: string,
): RegisteredCardTemplate | undefined {
  return cardTemplateRegistry.find((entry) => entry.id === id);
}
