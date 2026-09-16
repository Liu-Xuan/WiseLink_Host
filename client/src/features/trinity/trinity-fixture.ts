// 隔离 fixture：仅用于测试与预览，禁止在生产路由中导入。
// 数据来源：Trinity design 示例资料，与真实业务系统无连接。
import type { TrinitySituationData } from "./trinity-types";

export const TRINITY_SAMPLE_FIXTURE: TrinitySituationData = {
  "meta": {
    "name": "WiseLink 双环与三视图 · 构造示例",
    "asOf": "2026-09-16",
    "origin": "ISOLATED_EXAMPLE",
    "currentHostVerified": false
  },
  "stages": [
    {
      "id": "discover",
      "title": "发现与接收",
      "caption": "文件 · 故障 · 可靠性信号",
      "purpose": "识别新问题，登记原始来源和发生范围。",
      "output": "来源身份、版本和问题线索"
    },
    {
      "id": "track",
      "title": "跟踪与界定",
      "caption": "范围 · 进展 · 关注条件",
      "purpose": "连接调查背景与持续事项，保留真正需要复看的条件。",
      "output": "事项背景、版本发展与待核问题"
    },
    {
      "id": "assess",
      "title": "分析与评估",
      "caption": "理解 · 取证 · 交互复核",
      "purpose": "逐份文件按自身有效版理解要求，在事项内形成综合认识。",
      "output": "问题论点、实际依据与评估修订"
    },
    {
      "id": "issue",
      "title": "工程决策与颁发",
      "caption": "我方决定 · 工程文件",
      "purpose": "在授权业务入口记录决定和颁发的工程文件。",
      "output": "决定理由、措施范围与正式文件引用"
    },
    {
      "id": "prepare",
      "title": "计划与准备",
      "caption": "工卡 · 工作包 · 资源",
      "purpose": "按决定组织实施对象、工卡、窗口和实际资源条件。",
      "output": "准备条件、工卡依赖与计划变更"
    },
    {
      "id": "execute",
      "title": "实施与记录",
      "caption": "实际执行 · 偏差 · 构型",
      "purpose": "关联实际记录、对象范围与处理偏差。",
      "output": "完成记录、偏差与构型事实来源"
    },
    {
      "id": "verify",
      "title": "效果与验证",
      "caption": "观察窗口 · 效果 · 风险",
      "purpose": "结合有范围的运行和可靠性记录，核对措施是否达到目的。",
      "output": "验证结论、观察限制与反例"
    },
    {
      "id": "improve",
      "title": "改进与复看",
      "caption": "经验 · 修订 · 再评估",
      "purpose": "将验证和新材料带回调查、文件和工作方法。",
      "output": "经验修订、复看条件与新的问题"
    }
  ],
  "knowledgeStages": [
    {
      "id": "acquire",
      "title": "获取来源",
      "purpose": "外部系统、知识库、工程文档和原生记录，以实际授权及源身份取得。"
    },
    {
      "id": "organize",
      "title": "组织关联",
      "purpose": "按事项、技术对象和用途组织；相关不自动合并，同号不同来源不混。"
    },
    {
      "id": "understand",
      "title": "理解提炼",
      "purpose": "在正常工程分析中保存完整论点、条件、实际来源和重要未知。"
    },
    {
      "id": "persist",
      "title": "保存沉淀",
      "purpose": "完整工作与来源绑定持续保存，Wiki、索引和图谱直接复用。"
    },
    {
      "id": "govern",
      "title": "治理更新",
      "purpose": "版本、责任、适用范围、复用依据和撤回理由贯穿所有工作节点。"
    },
    {
      "id": "reuse",
      "title": "检索复用",
      "purpose": "先查已有工作，按确切版本复用；新信息再挑战和更新已有认识。"
    }
  ],
  "matters": [
    {
      "id": "m1",
      "code": "EM-26-001",
      "title": "显示系统间歇复位与验证资料跟踪",
      "fleet": "777",
      "ata": "31",
      "tag": "复看",
      "status": "复核后问题已保存，综合尚未纳入",
      "brief": "FTD将验证资料的预计发布时间改为待定。SB自身的工具条件按R02核对；两份文件的要求与事项认识分别保存。",
      "next": "核对工具实际可用性，继续等待有来源的资料进展。",
      "attention": true,
      "activeStages": [
        "track",
        "assess"
      ]
    },
    {
      "id": "m2",
      "code": "EM-26-002",
      "title": "飞行管理数据校验与软件子集核查",
      "fleet": "737NG",
      "ata": "34",
      "tag": "待核",
      "status": "对象范围待核",
      "brief": "软件标准已取得，但记录未区分文件要求的子集；不能仅凭“已更换设备”认定措施完成。",
      "next": "补充对应位置与时点的软件子集记录。",
      "attention": true,
      "activeStages": [
        "assess"
      ]
    },
    {
      "id": "m3",
      "code": "EM-26-003",
      "title": "电源转换告警与调查信息归集",
      "fleet": "787",
      "ata": "24",
      "tag": "关注",
      "status": "背景整理中",
      "brief": "已接收两份描述不同工况的记录，当前不足以合并为同一原因。",
      "next": "核对发生工况与记录标识。",
      "attention": false,
      "activeStages": [
        "discover",
        "track"
      ]
    },
    {
      "id": "m4",
      "code": "EM-26-004",
      "title": "显示软件标准与来源范围复核",
      "fleet": "747-8",
      "ata": "31",
      "tag": "关注",
      "status": "已有分析，待工程处理",
      "brief": "已完成文件自身范围比较，我方工程文件仍处于形成过程中。",
      "next": "核对工程文件草稿覆盖的对象。",
      "attention": false,
      "activeStages": [
        "assess",
        "issue"
      ]
    },
    {
      "id": "m5",
      "code": "EM-26-005",
      "title": "记录设备升级与后续运行观察",
      "fleet": "737NG",
      "ata": "31",
      "tag": "观察",
      "status": "局部执行后观察",
      "brief": "已取得样例目标组中部分对象的执行记录，观察时段尚未结束。",
      "next": "将实际观察记录与事先确定的目标对应。",
      "attention": false,
      "activeStages": [
        "execute",
        "verify"
      ]
    },
    {
      "id": "m6",
      "code": "EM-26-006",
      "title": "液压部件检查条件与工作包准备",
      "fleet": "777",
      "ata": "29",
      "tag": "协调",
      "status": "实施准备中",
      "brief": "工程文件已记录准备条件，航材与检验资源仍在协调。",
      "next": "核对资源到位与工卡版本。",
      "attention": false,
      "activeStages": [
        "prepare"
      ]
    },
    {
      "id": "m7",
      "code": "EM-26-007",
      "title": "机柜冷却改进经验与知识复看",
      "fleet": "787",
      "ata": "42",
      "tag": "复看",
      "status": "经验复看中",
      "brief": "既有措施验证已形成范围明确的经验，本轮复看新构型是否仍满足条件。",
      "next": "更新经验的适用范围，不泛化到全部构型。",
      "attention": true,
      "activeStages": [
        "verify",
        "improve"
      ]
    },
    {
      "id": "m8",
      "code": "EM-26-008",
      "title": "通讯中断记录与调查范围整理",
      "fleet": "737NG",
      "ata": "23",
      "tag": "待核",
      "status": "来源已登记",
      "brief": "已登记使用信息，需要区分单次事件和后续重复报道。",
      "next": "取得同一事件的准确时间和对象记录。",
      "attention": true,
      "activeStages": [
        "discover"
      ]
    },
    {
      "id": "m9",
      "code": "EM-26-009",
      "title": "空调控制器重复拆换调查",
      "fleet": "777",
      "ata": "21",
      "tag": "关注",
      "status": "调查与分析并行",
      "brief": "不同拆换记录的工况和部件状态尚未形成统一口径。",
      "next": "核对部件身份和拆换原因。",
      "attention": false,
      "activeStages": [
        "track",
        "assess"
      ]
    },
    {
      "id": "m10",
      "code": "EM-26-010",
      "title": "导航误差专题与工程文件形成",
      "fleet": "787",
      "ata": "34",
      "tag": "协调",
      "status": "工程文件形成中",
      "brief": "事项分析已有范围明确的认识；正式文件内容由授权工程流程处理。",
      "next": "将措施边界与文件对象清单核对。",
      "attention": false,
      "activeStages": [
        "issue"
      ]
    },
    {
      "id": "m11",
      "code": "EM-26-011",
      "title": "操纵系统检查任务与资源准备",
      "fleet": "747-8",
      "ata": "27",
      "tag": "协调",
      "status": "准备条件待核",
      "brief": "已登记工作准备需求，计划时间仍以当前内部记录为准。",
      "next": "确认工装与执行窗口。",
      "attention": false,
      "activeStages": [
        "prepare"
      ]
    },
    {
      "id": "m12",
      "code": "EM-26-012",
      "title": "起落架指示处理后的效果观察",
      "fleet": "737NG",
      "ata": "32",
      "tag": "观察",
      "status": "观察中",
      "brief": "已取得执行记录，但暂未取得完整观察期数据，不能先下效果结论。",
      "next": "到观察节点核对趋势和异常记录。",
      "attention": false,
      "activeStages": [
        "verify"
      ]
    },
    {
      "id": "m13",
      "code": "EM-26-013",
      "title": "引气事件经验与文件修订建议",
      "fleet": "777",
      "ata": "36",
      "tag": "复看",
      "status": "经验已保存",
      "brief": "事件回顾形成了资料表述上的改进建议，尚不修改受控文件。",
      "next": "与文件责任人核对建议。",
      "attention": true,
      "activeStages": [
        "improve"
      ]
    },
    {
      "id": "m14",
      "code": "EM-26-014",
      "title": "客舱设备技术资料接收",
      "fleet": "787",
      "ata": "25",
      "tag": "关注",
      "status": "新资料待理解",
      "brief": "新技术资料已登记，尚未形成当前对象的工程分析。",
      "next": "先明确问题和目标范围。",
      "attention": false,
      "activeStages": [
        "discover"
      ]
    },
    {
      "id": "m15",
      "code": "EM-26-015",
      "title": "辅助动力装置措施实施记录归集",
      "fleet": "737NG",
      "ata": "49",
      "tag": "待核",
      "status": "执行记录归集中",
      "brief": "目前取得部分单机记录，整项范围的完整性仍需核对。",
      "next": "区分单机完成与整项措施完成。",
      "attention": true,
      "activeStages": [
        "execute"
      ]
    },
    {
      "id": "m16",
      "code": "EM-26-016",
      "title": "自动飞行系统长期关注事项",
      "fleet": "777",
      "ata": "22",
      "tag": "关注",
      "status": "持续跟踪",
      "brief": "当前保存意见为继续观察，尚未形成实施决定，不代表分析任务长期运行。",
      "next": "在明确的新信息或复看条件下接续。",
      "attention": false,
      "activeStages": [
        "track"
      ]
    }
  ],
  "events": [
    {
      "id": "e1",
      "matter": "m1",
      "date": "2026-03-18",
      "title": "首次取得条件X事件记录",
      "kind": "event"
    },
    {
      "id": "e2",
      "matter": "m1",
      "date": "2026-04-14",
      "title": "FTD R01给出调查背景",
      "kind": "published"
    },
    {
      "id": "e3",
      "matter": "m1",
      "date": "2026-05-12",
      "title": "SB R01提出措施及其条件",
      "kind": "published"
    },
    {
      "id": "e4",
      "matter": "m1",
      "date": "2026-05-28",
      "title": "形成初始问题分析",
      "kind": "assessment"
    },
    {
      "id": "e5",
      "matter": "m1",
      "date": "2026-07-02",
      "title": "FTD R02调整资料预期",
      "kind": "revision"
    },
    {
      "id": "e6",
      "matter": "m1",
      "date": "2026-08-20",
      "title": "SB R02更新工具条件",
      "kind": "revision"
    },
    {
      "id": "e7",
      "matter": "m1",
      "date": "2026-09-08",
      "title": "FTD R03将资料日期改为待定",
      "kind": "revision"
    },
    {
      "id": "e8",
      "matter": "m1",
      "date": "2026-09-12",
      "title": "工程师纠正跨文件影响表述",
      "kind": "review"
    },
    {
      "id": "e9",
      "matter": "m1",
      "date": "2026-09-14",
      "title": "问题工作已更新，综合待接续",
      "kind": "assessment"
    },
    {
      "id": "e10",
      "matter": "m1",
      "date": null,
      "title": "补充验证资料发布",
      "kind": "expected"
    },
    {
      "id": "e11",
      "matter": "m5",
      "date": "2026-06-11",
      "title": "我方工程文件已颁发",
      "kind": "issued"
    },
    {
      "id": "e12",
      "matter": "m5",
      "date": "2026-07-16",
      "title": "取得部分目标的实施记录",
      "kind": "actual"
    },
    {
      "id": "e13",
      "matter": "m5",
      "date": "2026-08-22",
      "title": "进入约定的效果观察区间",
      "kind": "observation"
    },
    {
      "id": "e14",
      "matter": "m5",
      "date": "2026-10-22",
      "title": "计划核对观察期结果",
      "kind": "planned"
    },
    {
      "id": "e15",
      "matter": "m7",
      "date": "2026-09-02",
      "title": "冷却改进经验更新适用范围",
      "kind": "knowledge"
    }
  ],
  "knowledge": [
    {
      "id": "k1",
      "matter": "m1",
      "phase": "assess",
      "title": "资料发布预期与措施实施要求如何分别理解",
      "version": "工作修订 4",
      "status": "待更新综合",
      "reuse": [
        "m1",
        "m4",
        "m10"
      ]
    },
    {
      "id": "k2",
      "matter": "m1",
      "phase": "assess",
      "title": "单次检查正常的解释范围",
      "version": "工作修订 1",
      "status": "可复用工作",
      "reuse": [
        "m1",
        "m9"
      ]
    },
    {
      "id": "k3",
      "matter": "m2",
      "phase": "assess",
      "title": "软件标准与子集身份应分别核对",
      "version": "工作修订 1",
      "status": "可复用工作",
      "reuse": [
        "m2"
      ]
    },
    {
      "id": "k4",
      "matter": "m5",
      "phase": "verify",
      "title": "执行记录不等于效果已验证",
      "version": "工作修订 1",
      "status": "观察中",
      "reuse": [
        "m5",
        "m12"
      ]
    },
    {
      "id": "k5",
      "matter": "m7",
      "phase": "improve",
      "title": "新构型如何触发经验复看",
      "version": "工作修订 1",
      "status": "复看已保存",
      "reuse": [
        "m7"
      ]
    },
    {
      "id": "k6",
      "matter": "m8",
      "phase": "discover",
      "title": "重复报道与独立事件如何区分",
      "version": "工作修订 1",
      "status": "可复用工作",
      "reuse": [
        "m3",
        "m8"
      ]
    }
  ]
};
