/* ============================================================
 * WiseLink 3.1 · Aily 卡片模板共享类型（Spec：卡片设计系统）
 * 飞书卡片 JSON 2.0 结构；模板变量使用 ${var} 占位。
 * ============================================================ */

export type WlCardTemplateId =
  | 'WL-CARD-01'
  | 'WL-CARD-02'
  | 'WL-CARD-03'
  | 'WL-CARD-04'
  | 'WL-CARD-05'
  | 'WL-CARD-06'
  | 'WL-CARD-07';

export type WlCardBusinessName =
  | '当前焦点'
  | '综合评估'
  | '任务运行'
  | '等待输入'
  | '复核建议'
  | 'STALE / 冲突'
  | '失败 / 权限';

/** 卡片适用状态（状态演进链上的锚点） */
export type WlCardStage =
  | 'received'
  | 'queued'
  | 'parsing'
  | 'assessing'
  | 'waiting_materials'
  | 'candidate_ready'
  | 'awaiting_review';

/** 卡片按钮表达的最小业务动作；不构成飞书事件或回调协议。 */
export type WlCardAction =
  | 'OPEN_OVERVIEW'
  | 'OPEN_SOURCE'
  | 'REQUEST_RESYNTHESIS'
  | 'SUPPLY_MATERIALS'
  | 'ACKNOWLEDGE_REVIEW'
  | 'RETRY_TASK'
  | 'OPEN_TASK'
  | 'VIEW_LATEST';

/**
 * 卡片按钮携带的最小业务意图，不是飞书身份、签名、事件或传输协议。
 * Host 只有在校验官方 CardKit/消息/事件载荷后才能消费它。
 */
export interface WlCardBusinessCommand {
  action: WlCardAction;
  workItemId: string;
  expectedRevision: number;
}

/** 模板支持渠道 */
export type WlCardChannel = 'feishu_chat' | 'aily_web';

export interface WlCardTemplateVariable {
  name: string;
  description: string;
  required: boolean;
}

export interface WlCardTemplate {
  id: WlCardTemplateId;
  businessName: WlCardBusinessName;
  /** 飞书卡片搭建工具中的模板 ID；null 表示尚未托管配置。 */
  feishuTemplateKey: string | null;
  version: string;
  /** 适用状态 */
  stages: WlCardStage[];
  variables: WlCardTemplateVariable[];
  channels: WlCardChannel[];
  /** 模板内按钮表达的业务动作 */
  actions: WlCardAction[];
  /** 飞书卡片 JSON 2.0 结构（变量占位 ${var}） */
  json: WlCardJson;
}

/* ---------- 飞书卡片 JSON 2.0 结构类型（本仓库用到的子集） ---------- */

export interface WlCardHeader {
  title: { tag: 'plain_text'; content: string };
  subtitle?: { tag: 'plain_text'; content: string };
  /** 飞书卡片头部底色模板 */
  template?:
    | 'blue'
    | 'turquoise'
    | 'green'
    | 'orange'
    | 'red'
    | 'grey'
    | 'violet';
}

export interface WlCardColumn {
  tag: 'column';
  width?: 'weighted';
  weight?: number;
  vertical_align?: 'top' | 'center';
  background_style?: 'default' | 'grey';
  elements: WlCardBodyElement[];
}

export interface WlCardColumnSet {
  tag: 'column_set';
  flex_mode?: 'bisect' | 'trisect' | 'custom';
  background_style?: 'default' | 'grey';
  columns: WlCardColumn[];
}

export interface WlCardButton {
  tag: 'button';
  text: { tag: 'plain_text'; content: string };
  type?: 'primary' | 'default' | 'danger' | 'text';
  size?: 'medium' | 'small';
  behaviors: Array<{
    /** JSON 2.0 行为类型；出现 callback 不代表 Host 已接入官方事件。 */
    type: 'callback' | 'open_url';
    value?: Record<string, unknown>;
    default?: false;
    pc?: false;
    ios?: false;
    android?: false;
    url?: string;
  }>;
}

/** 按钮容器：JSON 2.0 中按钮必须包在 action 元素里 */
export interface WlCardActionElement {
  tag: 'action';
  actions: WlCardButton[];
}

export type WlCardBodyElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | {
      tag: 'note';
      elements: Array<{ tag: 'plain_text' | 'lark_md'; content: string }>;
    }
  | WlCardColumnSet
  | WlCardActionElement;

export interface WlCardJson {
  schema: '2.0';
  /** 允许服务端后续更新同一张卡（状态演进：更新而非重发） */
  config?: {
    update_multi?: boolean;
    style?: { text_size?: 'normal' | 'heading' };
  };
  header?: WlCardHeader;
  body: { elements: WlCardBodyElement[] };
}
