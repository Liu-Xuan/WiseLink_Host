import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidMethodBinding } from '@shared/jobaid-problem-assessment.interface';

/** Validate a Host-persisted snapshot without substituting the running release's pack. */
export function isJobAidMethodBinding(value: unknown): value is JobAidMethodBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<JobAidMethodBinding>;
  const nonempty = (text: unknown): text is string => typeof text === 'string' && text.trim().length > 0;
  return nonempty(binding.packRef) && nonempty(binding.version) &&
    binding.attachment5 === 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED' &&
    Array.isArray(binding.sources) && binding.sources.length > 0 &&
    binding.sources.every(source => source && nonempty(source.sourceIdentity) &&
      nonempty(source.versionLabel) &&
      (source.documentVersionId === null || nonempty(source.documentVersionId)) &&
      (source.status === 'VERSION_UNCONFIRMED' ||
        (source.status === 'CONFIRMED' && nonempty(source.documentVersionId))));
}

/** Static method material, independent of the legacy 150-criterion activation. */
export const JOBAID_METHOD_BINDING: JobAidMethodBinding = {
  packRef: 'JA-PROBLEM-METHOD-20260909',
  version: '1.0',
  sources: [
    {
      sourceIdentity: 'JA-DS093',
      versionLabel: 'R01',
      documentVersionId: null,
      status: 'VERSION_UNCONFIRMED',
    },
    {
      sourceIdentity: 'JA-AC',
      versionLabel: 'R01',
      documentVersionId: null,
      status: 'VERSION_UNCONFIRMED',
    },
    {
      sourceIdentity: 'JA-DS093 Attachment 5',
      versionLabel: 'R00',
      documentVersionId: null,
      status: 'VERSION_UNCONFIRMED',
    },
  ],
  attachment5: 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED',
};

const clauses = [
  [
    'scope',
    '指南边界与连贯评估意见',
    'JA-DS093 / JA-AC',
    'DS §1、§5.1—5.3.1，PDF 5、7—9；R §1—2，PDF 4—6',
    '两份指南不创设超出相关程序的新程序，冲突时以现行有效程序为准。一般一份源文件对应一个处理单，同一文件可有多位工程师的多份评估意见；事项聚合不抹掉各文件、版本、专业意见身份。评估意见解释背景、措施和真正相关的适航、安全、法规、可靠性、维修方案、放行、世界机队、航材及成本因素，说明执行或不执行的原因；按需提供工时与估价，未知不填零。AD 专用评估另需实际适用指南。候选完成不代表正式义务、签署、采用、实施或放行完成。',
  ],
  [
    'applicability',
    '对象条件与原文必选情形',
    'JA-DS093',
    '§6.2—6.2.2，PDF 16—19',
    '分别保留文件声明范围、对象已知事实和 Host 受控匹配。机体/系统、关联部件、LRU、非 LRU 的核对路径不同，非 LRU 依所属 LRU 有效性；无记录或接口未通不等于不适用。确认不适用只关闭相应文件—对象—条件分支，不能关闭整个异常事项。重要系统 SB/SL 有需检查、填写并挂接检查单的要求，同时原文说明其建议性防遗漏作用；保留两者，不普遍化、不豁免。适用且必须执行的语境下，涉及适航性的紧急类 SB/SL 应全部选取，颁发原因涉及空停原则上一律执行。突出要求与触发依据，不因候选身份改成普通可选建议；标题或关键词不能独立触发正式处置。',
  ],
  [
    'risk',
    'JA-AC 情景与原矩阵',
    'JA-AC',
    '§3.1—3.4，PDF 6—9',
    '先说明失效机制、功能、条件、对象暴露、实际后果及控制局限。严重性：轻微3、重要5、严重7、灾难10。可能性：可能10、不大可能7、不可能（极少）5、极不可能（极端少）3，分别对应单机寿命预期/机队持续发生、单机不太可能但机队可多次、单机预期不发生但机队可有限次、机队范围预期不会发生。定量或定性均须说明为何对应定义；未知不算0，不凭模型置信度补可能性。Host 按乘积定一级0—19、二级20—29、三级30—39、四级40—59、五级60—100。四位ATA近三年情况仅为参考，例如，不是无条件映射。空停、重力放起落架、爆胎/脱胎、空中释压、通讯中断、客货舱火警/烟雾六类重要事件严重性为严重并提级管控，但须核对实际情景；严重性7不自动等于四级。提级管控不等于数字加一。多条分析路径保留方法、情景、依据，按适用风险比较，不能对不同分类编号取最大值。',
  ],
  [
    'controls',
    '措施价值、紧迫性与处置含义',
    'JA-AC',
    '§3.3—5.3，PDF 8—14',
    '五级不可接受，原文要求立即限制或停止运行并落实控制；四级要求立即临时应急及长期控制；三级分析和改善控制；二级在监控下可接受；一级无进一步行动要求。清楚呈现条件性要求及依据，不自动下发限制或放行。五级工程措施时限指导的14天/12周不能作为允许等待安全窗口，仍有尽早及必要时立即限制/停止要求；四级相对厂家符合性时限至少留25%提前量，三级可用源期限，二级结合便利维修折算明确时限。起点/单位/更严要求或现行程序未给定就不虚构日期。提议措施不等于已实施控制，实施记录不自动证明有效，不凭建议给剩余风险降级。EO重要/紧急、LE11源文件级别与JA五级分别表达。',
  ],
  [
    'revision',
    '新修订、年度回顾与两年上限',
    'JA-DS093',
    '§5.3.1(6)(9)、§6.2.2(4)(5)，PDF 9、18—19',
    '源文件改版须覆盖此前所有版本的评估意见并关联此前所有工程文件，即使本次不执行。先清点全部历史目录和已知限制，再只重做受影响理解；不能只看当前引用。事件触发再分析、特定观察/结构适用不执行/部分执行情形距初评不超过两年的再评上限、适用不执行的年度回顾是不同机制，不设统一两年宽限。年度回顾列有ATA21/22/24/26/27/28/29/30/32/34/36/51/52/53/54/55/56/57及发动机；原文另有无需再年度回顾选项但停止条件不足，不能自动终止已触发义务。注册号注销前的销售或退租飞机仍按正常流程。',
  ],
  [
    'delivery',
    '表单与后续工程管理',
    'JA-DS093',
    '§5.4—5.5、§6.3、附件1—4，PDF 10—13、20—27',
    'AEO/PEO-L、CR/IR、EB、PEO-S、CEO、MRO、MT/OT、MON、MEL申请各有用途。初评识别措施/工程文件/手册 PRE-POST、软件负载、MEL、运行及航材协调依赖，不宣称已完成。飞行运行手册、维护手册、AFM/MMEL/MEL特例路径不同，连同流程图和正文使用。HDR/AID/SBI、MCI、拆装件、发动机/APU条件字段属于真实实施与上报，由程序检查格式。指南确认及培训记录不是每份SB模型必答。正式表单从已有分析投影，签署与采用来自业务动作，不自动填写N/A或已符合。',
  ],
  [
    'attachment5',
    '附件5内容提示与配套版本限制',
    'JA-DS093 Attachment 5',
    '设计资料附录 B 转述 Sheet1!B2:B29；R00 与 R01 配套待核',
    '本轮开发未取得可读独立工作簿，以下是用户设计报告转述，不能冒称已读Excel或已确认现行。原表C2:C29为空且选项N/A、已符合、未符合；空白不是不符合，也不是全部N/A。按条件核对自身风险及全球/日常信息、串件/装机/交付有效性、成本和时效、完成方式/工艺资质、手册/软件/重量、重要器材工具与MON。B19前置/同时SB及执行文件状态；B20特定递进版本旧版再评/反馈不能泛化所有旧版执行；B23 MEL与M/O匹配；B25—26 EDTO间接影响与特定干扰条件下首飞非ETOPS要求，正式处理前须核对版本和程序；B27安全影响且需追踪件号序号时通知可靠性，B28 NO-GO/飞行安全相关部件的APCM关注，B29信息类材料按后果风险传递。',
  ],
  [
    'examples',
    '案例与 SAE 方法边界',
    'JA-AC',
    '§6及附件1—3，PDF 14—47',
    'V2500历史案例：趋势异常、单次规定检查正常、随后空停说明检查未见异常不能排除可能机理；7×7=49是该案例判断，不能套给所有告警。A350 EDP：缺陷、受影响序号、在翼/车间措施、防问题件重新装机或入库是同一问题；两年索赔不是两年允许等待。PW1100G为2023年10月会议/11月报告，十二与十三问题材料时点不同。N2瞬时与非瞬时机理不同，孔探不可达、无有效监控、N/A、研究中、缓解、终止、普查完成与有效控制分开；2024—2026计划不是当前完成事实。SAE事件Category1—4、失效条件严重性与JA-AC五级不可互换；A.4示例非检查单，A.5交叉表不替代特定机型构型。烟雾Category3概括与Table A3 Category2差异保留具体条目及条件，不静默修正，也不削弱本JA六类事件要求。',
  ],
] as const;

export const JOBAID_METHOD_EVIDENCE: AssessmentEvidence[] = clauses.map(
  ([key, title, sourceIdentity, locator, excerpt]) => ({
    evidenceRef: `method:${key}`,
    kind: 'METHOD_CLAUSE',
    packRef: JOBAID_METHOD_BINDING.packRef,
    methodRef: `method:${key}`,
    title,
    versionLabel:
      key === 'attachment5'
        ? 'R00 配套待核；设计资料转述'
        : 'R01；受控版本身份待确认',
    sourceIdentity,
    locator,
    excerpt,
    sourceVersionStatus: 'VERSION_UNCONFIRMED',
  }),
);

export const JOBAID_CORE_METHOD_REFS = [
  'method:scope',
  'method:applicability',
  'method:risk',
  'method:revision',
];
