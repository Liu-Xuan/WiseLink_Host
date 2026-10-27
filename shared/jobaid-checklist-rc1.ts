/** RC1 authored definition projection. Item/rule text is unchanged; source registry is not business evidence. */
export const JOBAID_CHECKLIST_RC1 = {
  "definitionId": "wiselink.engineering-assessment",
  "definitionVersion": "0.1.0-rc1",
  "contractVersion": "0.1.0-rc1",
  "items": [
    {
      "itemId": "ENG-SCOPE-01",
      "categoryId": "P1",
      "title": "说清本轮要解决的问题",
      "question": "本轮针对什么对象、文件变化或工程疑问；需要支持什么决定；哪些决定和对象不在本轮范围？",
      "trigger": {
        "appliesWhen": [
          "所有合法工程分析任务，itemApplicability=APPLICABLE。"
        ],
        "notApplicableWhen": [
          "本RC1无此分支",
          "若并非工程分析任务，应在任务入口重新界定，不能靠跳过本项获得完整评估。"
        ],
        "unknownHandling": "本项本身始终适用；对象或目标信息不足属于回答OPEN，不将本项改成UNDETERMINED或不适用。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "INCLUDE",
        "optionalBoundary": "核心必需；不得普通排除或DEFERRED。并非所有任务都必须作适航决定；范围可明确为信息整理、方法讨论或辅助建议。"
      },
      "necessaryInvestigations": [
        "读取封存任务目的、对象/版本、允许范围",
        "读取足以识别本次变化/疑问的源文",
        "修订任务核对指定历史范围。"
      ],
      "evidenceRequirements": [
        "任务自身作为目标和授权范围依据",
        "涉及文件事实时引用准确文件版本及位置",
        "纯方法讨论不要求机队或实施记录。"
      ],
      "minimumCompletion": [
        "[ENG-SCOPE-01-C01] 明确问题、对象/版本、预期交付和决定边界",
        "[ENG-SCOPE-01-C02] 不能只复制文件标题。业务主张与来源能够对应",
        "[ENG-SCOPE-01-C03] 内容是否切中任务仍需语义复核。"
      ],
      "allowedOpen": [
        "源文缺页、对象标识不清、任务目标冲突时，列出具体缺失/冲突、影响和需要补齐的内容，outcome=OPEN/CONFLICT。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "结构/绑定错误按原合同修正或停止；无法界定目标时保留有价值内容并标OPEN，不自行选择更容易通过的新目标；Host不得因有文本而判定必需决定已完成。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P1",
        "ENG-SCOPE-01"
      ],
      "ruleRefs": [
        "WLCHK.BINDING.MATCH",
        "WLCHK.SCOPE.COVERAGE",
        "WLCHK.ANALYSIS.SUFFICIENT"
      ]
    },
    {
      "itemId": "ENG-SCOPE-02",
      "categoryId": "P1",
      "title": "说明对象和适用条件",
      "question": "当前判断适用于哪些对象、构型、条件和时间；哪些适用条件已满足、不满足或仍未知？",
      "trigger": {
        "appliesWhen": [
          "封存目标要求判断对象适用性，或候选拟对具体对象/构型/范围作应用性结论",
          "有效来源义务要求本轮判断适用性。"
        ],
        "notApplicableWhen": [
          "任务仅整理信息或讨论方法，且不作具体对象适用性结论",
          "可忠实转述文件范围，但不得将其外推为本机队已适用/不适用。"
        ],
        "unknownHandling": "源文或任务资料不足以判断是否需要对象适用性分析。保持WHEN_TRIGGERED并调查；无法解决则OPEN/CONFLICT。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "WHEN_TRIGGERED",
        "optionalBoundary": "触发成立或有效义务适用后不可普通排除。可选扩展对象的排除须在封存范围中明确；不能排除已在本轮必须判断的对象。"
      },
      "necessaryInvestigations": [
        "识别影响决定的适用条件",
        "读取对应对象、构型或时间记录",
        "逐条件对照",
        "检查记录覆盖范围和时间",
        "出现不一致时保留冲突。"
      ],
      "evidenceRequirements": [
        "条件来自准确源文",
        "对象事实来自与对象、版本、时点相符的记录或明确注明性质的输入",
        "未核实输入不得默认为已确认事实。"
      ],
      "minimumCompletion": [
        "[ENG-SCOPE-02-C01] 给出决定所需条件及对象对照，说明结论覆盖范围",
        "[ENG-SCOPE-02-C02] 有据排除必须指出具体不满足的条件。检查项触发判定与对象业务适用结论分别表达。"
      ],
      "allowedOpen": [
        "缺少装机件号、配置时间点、对象清单或条件原文时，说明缺哪项、影响哪些对象及需要什么记录",
        "不得因接口未连接或查询无结果输出不适用。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "引用错对象/错版本则拒绝相应结论并修正；缺证则OPEN；相反证据无法解释则CONFLICT。需要当前确定适用性的任务不能通过DEFERRED结束。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P1",
        "ENG-SCOPE-02"
      ],
      "ruleRefs": [
        "WLCHK.SOURCE.EXACT_BINDING",
        "WLCHK.EVIDENCE.SUPPORTS_CLAIM",
        "WLCHK.METHOD.APPLICABILITY"
      ]
    },
    {
      "itemId": "ENG-EVIDENCE-01",
      "categoryId": "P2",
      "title": "区分事实、意见和未知",
      "question": "各关键结论分别依据什么；来源陈述、已核业务事实、历史意见、分析推断和未知是否分清；证据限制和相互冲突是什么？",
      "trigger": {
        "appliesWhen": [
          "所有工程分析任务，itemApplicability=APPLICABLE。"
        ],
        "notApplicableWhen": [
          "本RC1无此分支。"
        ],
        "unknownHandling": "本项始终适用；证据类别、可靠性或支持程度未知属于OPEN/CONFLICT。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "INCLUDE",
        "optionalBoundary": "核心必需；不能通过取消本项让无依据确定性声明成为完整结果；不要求每个句子重复登记证据。"
      },
      "necessaryInvestigations": [
        "识别影响决定的关键主张",
        "读取对应原文和必要上下文",
        "检查对象/时间/条件是否一致",
        "检查重要反向证据及转引来源",
        "说明无法取得的材料。",
        "可经受控工具动态发现新的当前授权来源，将工具返回的真实身份、版本和读取回执纳入本轮证据；初始材料清单不是永久材料白名单。"
      ],
      "evidenceRequirements": [
        "沿现有evidence/sourceOrigins/readSourceRefs/basisRefs关联准确版本和位置",
        "支持说明只是分析解释，不作为新增证据。推断须说明所依据事实与推断边界。"
      ],
      "minimumCompletion": [
        "[ENG-EVIDENCE-01-C01] 关键结论能够追溯到实际读取来源或明确标为推断/未知",
        "[ENG-EVIDENCE-01-C02] 不把方法说明当作实施证明，不把合法但无关的来源当作支持。程序只能验证可确定部分，不能把本项机器通过等同于全部语义已证实。"
      ],
      "allowedOpen": [
        "证据不足时指出受影响结论、缺失材料与影响",
        "证据冲突时列出冲突双方和无法消解原因。可合法OPEN/CONFLICT，但不能同时给出超出证据的确定结论。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "不存在/未授权/错版本引用按原机制处理；未经依据的确定性结论需降为有边界的候选或补证；无法判断相关性时留待语义复核，不能伪称确定性校验已识别全部问题。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P2",
        "ENG-EVIDENCE-01"
      ],
      "ruleRefs": [
        "WLCHK.SOURCE.REGISTERED_REFERENCE",
        "WLCHK.SOURCE.EXACT_BINDING",
        "WLCHK.EVIDENCE.SUPPORTS_CLAIM"
      ]
    },
    {
      "itemId": "ENG-METHOD-01",
      "categoryId": "P2",
      "title": "说明方法的用途及适用依据",
      "question": "本轮讨论或使用了什么方法；是仅参考还是实际采用；适用理由、准确版本、输入和限制是什么？",
      "trigger": {
        "appliesWhen": [
          "任务直接讨论/比较方法，或候选实际用具体方法、分类、矩阵或判断标准形成结论。仅参考和实际采用是本项内不同分支。"
        ],
        "notApplicableWhen": [
          "没有方法分析或方法应用主张",
          "材料中偶然出现方法名称/参考文献，不单独触发实际采用规则。"
        ],
        "unknownHandling": "无法确定候选是否实际采用某方法，或适用条件未明；先澄清使用语义，无法确定则OPEN/CONFLICT。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "WHEN_TRIGGERED",
        "optionalBoundary": "实际采用后不能取消用于维护准确性的方法要求；纯方法讨论可完成本项，不能被迫虚构业务履行或改为后续阶段。"
      },
      "necessaryInvestigations": [
        "读取相应方法定义和版本状态",
        "说明用途与适用条件",
        "实际采用时识别业务输入、单位、规则与未知值",
        "纯参考时只需完成本轮讨论问题。",
        "在不擅换已绑定正式标准版本的边界内，CLI可自主选择合适的分析方法；正常方法选择和计划调整不逐次要求人工批准。"
      ],
      "evidenceRequirements": [
        "准确方法原文/封存定义",
        "实际采用时另有与应用有关的业务输入依据",
        "仅参考分支允许只使用方法来源。"
      ],
      "minimumCompletion": [
        "[ENG-METHOD-01-C01] 用途清楚、方法引用和版本状态准确",
        "[ENG-METHOD-01-C02] 已知计算/映射按封存规则完成",
        "[ENG-METHOD-01-C03] 未知不填0。程序可查表/取定义/计算，但不能静默替模型更改方法选择或工程结论。"
      ],
      "allowedOpen": [
        "方法版本未确认、适用条件或必需输入未知时说明影响。明确试算或方法说明可在标注VERSION_UNCONFIRMED后回答",
        "需要证明符合正式有效方法的目标则必须OPEN。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "误引用精确定义、标签或计算可作有界修正；语义使用不明则澄清；纯讨论不得以LATER_BUSINESS_STAGE或DEFERRED绕行；方法效力未核定不得由项目版本号代替。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-JOBAID-PENDING",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P2",
        "ENG-METHOD-01"
      ],
      "ruleRefs": [
        "WLCHK.METHOD.KNOWN_RULE",
        "WLCHK.METHOD.SOURCE_STATUS",
        "WLCHK.METHOD.APPLICABILITY"
      ]
    },
    {
      "itemId": "ENG-RISK-01",
      "categoryId": "P2",
      "title": "在需要时分析情景与控制局限",
      "question": "在本轮需要风险分析时，具体情景、对象暴露、后果、现有控制和局限是什么；结论或分级依据是什么？",
      "trigger": {
        "appliesWhen": [
          "封存任务明确要求风险分析",
          "已确认适用来源要求本轮分析",
          "或已识别情景使风险判断成为本轮决定的必要前提。"
        ],
        "notApplicableWhen": [
          "信息整理、方法介绍等任务不要求风险决定，也无已确认适用义务或必要情景",
          "不能仅按AD/SB/FTD标题或出现“安全”一词自动强开矩阵。"
        ],
        "unknownHandling": "资料不足以判断风险分析是否为当前决定必要条件，或外部程序适用性尚未确认；保持调查，无法消解则OPEN/CONFLICT。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "WHEN_TRIGGERED",
        "optionalBoundary": "触发后与本轮必需决定相关的风险分析不可普通排除。定性情景分析不自动意味着必须做某一特定数值评级。"
      },
      "necessaryInvestigations": [
        "界定情景与适用对象",
        "区分源文后果和本轮推断",
        "读取暴露、发生可能性、控制现状等所选方法实际所需材料",
        "说明数据覆盖和缺失。"
      ],
      "evidenceRequirements": [
        "情景/后果/暴露/控制分别关联相应来源",
        "采用方法按METHOD-01绑定",
        "候选控制的预期效果可以分析，不能据此认定现有剩余风险已经降低。"
      ],
      "minimumCompletion": [
        "[ENG-RISK-01-C01] 情景明确，已知维度有依据，未知与限制清楚",
        "[ENG-RISK-01-C02] 有完整输入时确定性计算正确",
        "[ENG-RISK-01-C03] 输入不足时保留未决而不虚填低风险。对自然语言因果和相关性的解释仍需语义复核。"
      ],
      "allowedOpen": [
        "某个评级维度或控制事实未知时，保留已知分析并标明不能计算/不能确定的结论",
        "如明确任务只需情景识别，可按该目标回答，不冒称已完成定量评级。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "未知填0、缺输入却给确定低风险、未经确认控制被计入现状，应拒绝该结论并修订；缺证OPEN、冲突CONFLICT；不能把当前必要分析改DEFERRED取得完成。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-JOBAID-PENDING",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P2",
        "ENG-RISK-01"
      ],
      "ruleRefs": [
        "WLCHK.METHOD.KNOWN_RULE",
        "WLCHK.METHOD.APPLICABILITY",
        "WLCHK.EVIDENCE.SUPPORTS_CLAIM"
      ]
    },
    {
      "itemId": "ENG-ACTION-01",
      "categoryId": "P3",
      "title": "比较处理选择并说明理由",
      "question": "本轮需要比较或决定哪些处置选择；建议与理由是什么；有哪些必要义务、条件、限制、期限和后续安排？",
      "trigger": {
        "appliesWhen": [
          "封存目标要求处置建议/比较/决定，或适用来源带来当前需要分析的行动义务",
          "本轮结论包含执行、暂缓、不执行或替代建议。"
        ],
        "notApplicableWhen": [
          "任务仅传递信息且没有当前处置判断",
          "不为填满检查单虚构措施。"
        ],
        "unknownHandling": "尚不能判断源要求是否对当前对象成立或是否属于本轮阶段；先分析适用条件，不能默认为无须处置。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "WHEN_TRIGGERED",
        "optionalBoundary": "有效且当前适用的强制要求不可取消。项目自选优化方案可按封存范围排除；来源义务争议须保留，不以删除条目解决。"
      },
      "necessaryInvestigations": [
        "读取源要求及条件",
        "识别实际可考虑的选择",
        "分析与问题的关系、条件和局限",
        "核对期限的原始单位/起算条件",
        "区分推荐理由与已实施效果。"
      ],
      "evidenceRequirements": [
        "方案依据、约束和期限分别引用准确来源",
        "候选措施评价允许用技术说明、问题事实和方法分析，不要求实施记录",
        "实施主张交STATUS-01处理。"
      ],
      "minimumCompletion": [
        "[ENG-ACTION-01-C01] 给出与任务相称的处置建议或选择分析，解释主要理由和限制",
        "[ENG-ACTION-01-C02] 有明确义务时保留其条件与期限",
        "[ENG-ACTION-01-C03] 后续安排可执行且不替代当前必须作出的判断。"
      ],
      "allowedOpen": [
        "适用性、技术参数、资源条件或期限起算事实缺失，说明它影响哪个选择",
        "允许给条件性建议并标OPEN，不虚构日期或保证效果。",
        "本轮已经完成措施建议、措施计划在未来实施时，应按分析内容使用ANSWERED或OPEN，不因措施尚未执行就把整项分析改成DEFERRED。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "必要处置被改DEFERRED/后续阶段、义务消失、期限无起算依据，应修订；仅在封存allowedDeferredItemIds及既有后继阶段允许且不影响当前必需决定时使用DEFERRED。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P3",
        "ENG-ACTION-01"
      ],
      "ruleRefs": [
        "WLCHK.SCOPE.COVERAGE",
        "WLCHK.MEASURE.CLAIM_BOUNDARY",
        "WLCHK.ANALYSIS.SUFFICIENT"
      ]
    },
    {
      "itemId": "ENG-STATUS-01",
      "categoryId": "P3",
      "title": "分清建议、实施与有效性",
      "question": "文中措施目前属于候选建议、已决定采用、已实施，还是效果已验证；声称的对象、时间、条件与证据范围是什么？",
      "trigger": {
        "appliesWhen": [
          "候选提及措施或控制状态，包括候选措施",
          "涉及措施状态时本项适用，状态未知并不使本项变成不适用。"
        ],
        "notApplicableWhen": [
          "任务及结果完全不涉及措施/控制及其状态。"
        ],
        "unknownHandling": "材料不足以判断是否有相关措施主张时调查；一旦存在主张，按APPLICABLE分析，缺状态依据则OPEN。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "WHEN_TRIGGERED",
        "optionalBoundary": "候选措施也需要清楚标为候选，但不能因此强制要求实施记录。模型不能填写工程师确认或推进真实业务事实状态。"
      },
      "necessaryInvestigations": [
        "识别每个影响结论的措施主张及其层级",
        "候选只分析建议内容与预期作用",
        "已采用/已实施/已验证主张分别查对应记录及对象、时间、条件",
        "检查范围外推。"
      ],
      "evidenceRequirements": [
        "候选建议不需采用/实施/效果记录",
        "实际采用需决定记录，实际实施需与该对象相符的实施依据，有效性主张需验证依据和适用边界。仅未取得记录不能断言未实施。"
      ],
      "minimumCompletion": [
        "[ENG-STATUS-01-C01] 措辞、状态和所引依据相称",
        "[ENG-STATUS-01-C02] 厂家预期效果与本机实际效果分开",
        "[ENG-STATUS-01-C03] 实施事实与有效性分开",
        "[ENG-STATUS-01-C04] 工程师确认独立于所有模型候选字段。对材料含义的复杂解释仍属语义复核，不能宣称关键词规则穷尽识别。"
      ],
      "allowedOpen": [
        "缺少真实状态记录时，写“尚未取得/尚不能确认”的具体事实缺口",
        "可以完成候选评价，但不能输出确定已实施或已验证。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "候选被提升成事实状态、无相应依据声称已验证、验证范围被扩大等需要修订或OPEN；Host不接受由模型候选直接签署工程师确认或实施状态变更。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P3",
        "ENG-STATUS-01"
      ],
      "ruleRefs": [
        "WLCHK.AUTHORITY.NO_PROMOTION",
        "WLCHK.MEASURE.CLAIM_BOUNDARY",
        "WLCHK.SOURCE.EXACT_BINDING"
      ]
    },
    {
      "itemId": "ENG-CLOSE-01",
      "categoryId": "P3",
      "title": "列明未决问题与下一步",
      "question": "本轮已经回答什么，还缺什么；每个未决影响哪个决定；下一步需要什么材料或处理，哪些决定现在能够作出？",
      "trigger": {
        "appliesWhen": [
          "所有工程分析任务，itemApplicability=APPLICABLE。"
        ],
        "notApplicableWhen": [
          "本RC1无此分支。"
        ],
        "unknownHandling": "本项始终适用；无法确定结束条件应OPEN，而非跳过本项。",
        "decisionOwner": "Codex CLI结合任务、证据与授权工具能力自主分析并提出itemApplicability及依据；Host仅校验可确定约束，不执行通用自然语言触发判断；必要正式工程判断由工程师确认。"
      },
      "selection": {
        "defaultMode": "INCLUDE",
        "optionalBoundary": "核心必需；不可普通排除或DEFERRED。条目已回答不等于Host应结束本轮，不等于工程义务履行、措施实施或效果验证。"
      },
      "necessaryInvestigations": [
        "对照封存目标及已选/条件性条目",
        "核对重要结论与未决、措施状态是否矛盾",
        "检查局部修订范围",
        "确认后续阶段安排是否确实存在并被允许。"
      ],
      "evidenceRequirements": [
        "引用本轮各项结论及其现有证据/问题标识，不要求把全部正文再次抄写",
        "后续去向使用已有工作位置/责任类别，不虚构人员已接受任务。"
      ],
      "minimumCompletion": [
        "[ENG-CLOSE-01-C01] 总结回答与决定边界",
        "[ENG-CLOSE-01-C02] 对每个重要未决给出具体缺口、影响和所需下一步",
        "[ENG-CLOSE-01-C03] 无未决时可明确声明",
        "[ENG-CLOSE-01-C04] 摘要不得把正文的未知、冲突或候选写成确定事实。"
      ],
      "allowedOpen": [
        "诚实OPEN/CONFLICT可以是有效交付",
        "CLI应说明带未决结束与封存目标的关系，Host仅核已明确的可确定结束约束，实质判断仍属智能体分析及必要工程复核。全部填“未知”或空泛“进一步研究”不自动满足本轮目标。"
      ],
      "failureHandling": [
        "Host独立处理可确定的结构、身份、权限、准确版本及事务约束；自然语言相关性、因果、充分性、义务适用和目标实质完成的不足，由CLI自查或必要工程复核识别并提出修订，不宣称Host能够通用自动识别。",
        "漏掉必要项、把必须解决问题转为DEFERRED、汇总与正文冲突，应修订；缺少结束条件则不由模型擅自宣布完成；保存/读回/队列结果不明走既有恢复机制，不重生成或换键掩盖。"
      ],
      "sourceRefs": [
        "SRC-PROJECT-RC1",
        "SRC-DESIGN-BASE"
      ],
      "pyramidPath": [
        "ENG-REVIEW",
        "P3",
        "ENG-CLOSE-01"
      ],
      "ruleRefs": [
        "WLCHK.SCOPE.COVERAGE",
        "WLCHK.HISTORY.SCOPE_PRESERVED",
        "WLCHK.ANALYSIS.SUFFICIENT"
      ]
    }
  ],
  "commonPolicy": {
    "goalOwner": "目标来自用户任务或业务触发说明；Host原样承载并附权威上下文，不用自然语言规则代替LLM预先推导全部问题。CLI在原目标内自主细化。",
    "autonomy": [
      "Host给目标、已知上下文、可用能力、权威约束和验收要求；不预先写完问题拆解或研究计划。",
      "Codex可自主识别子问题、判断语义触发、选择方法、改变调查顺序、合并资料读取、追查反例、调整假设和修订结论。",
      "必要调查描述最低信息覆盖；相同信息已经合法获得时可复用，不要求固定工具、逐项调用或每步人工批准。",
      "初始材料是起点。权限范围内可发现并读取新来源，通过受控工具登记真实身份/版本；发现材料不等于证明结论。",
      "只固定本轮明确指定或确已适用的正式方法版本；未预选的方法可自主发现、比较和选择，结果绑定实际读取版本。",
      "新的有价值发现可在既有正文/问题结构中继续分析并关联现有itemId，不因不在初始问题清单而丢弃。",
      "改变原授权目标、修改受控验收标准、越出写入范围或静默替换必用正式方法版本，应走既有合法变更路径。"
    ],
    "selectionModes": {
      "INCLUDE": "本轮明确纳入，必须回答；核心项不能自判跳过。",
      "WHEN_TRIGGERED": "由智能体判断是否触发并给依据；不是Host自然语言条件引擎。",
      "EXCLUDE_OPTIONAL": "有权用户排除纯可选范围，保留理由；不等同有据不适用。"
    },
    "selectionConflict": "若发现独立的适用来源要求使原可选排除理由不再成立，记录该发现及依据，在既有授权目标内进行必要分析；不得把排除当作免除义务，不得自行扩大正式写权。需要改变用户明确目标时走既有合法变更，不要求普通补查逐步审批。",
    "itemApplicability": [
      "APPLICABLE",
      "NOT_APPLICABLE",
      "UNDETERMINED"
    ],
    "outcome": [
      "ANSWERED",
      "OPEN",
      "CONFLICT",
      "DEFERRED"
    ],
    "methodUsage": [
      "REFERENCE_ONLY",
      "APPLIED",
      "UNDETERMINED"
    ],
    "stateMeaning": [
      "itemApplicability指该检查项是否需要分析；飞机/件号的业务适用性是该项回答中的结论。",
      "条件未明必须保留UNDETERMINED并交付OPEN或CONFLICT，不把未知当false。",
      "核心项ENG-SCOPE-01/ENG-EVIDENCE-01/ENG-CLOSE-01本身始终APPLICABLE；回答未知可OPEN。",
      "候选已完成分析、措施尚待未来实施，可为ANSWERED或OPEN；不能仅因尚未实施而写DEFERRED。",
      "DEFERRED仅用于已允许延后的分析工作，注明承接安排；不能替代当前必需处置或分析。",
      "分析结果可保存、是否达到本轮目标、业务义务履行、工程师确认分别表达；不新增生产roundCompletion枚举。"
    ],
    "semanticBoundary": "Host只核明确结构、引用身份/版本/权限/可核原文、对象时间的明确结构化约束、权威记录冲突及事务。相关性、因果、充分性、方法适用及候选措施效能由智能体分析/自查和必要工程复核；支持说明不是事实证明。",
    "systemInvariants": [
      "身份/租户",
      "当前来源权限",
      "准确对象和版本",
      "历史修改范围",
      "租约与取消",
      "原绝对期限",
      "CAS",
      "请求幂等及保存一致性"
    ],
    "noUniformSourceCount": "不规定每个结论必须两份来源；源文与其转抄件不自动构成独立证据。",
    "publicationBoundary": "模型不得产生正式确认人/时间、批准、业务实施或效果确认事件，也不得写保存成功回执。"
  },
  "ruleCatalog": [
    {
      "ruleId": "WLCHK.BINDING.MATCH",
      "nature": "DETERMINISTIC",
      "meaning": "本轮定义版本/内容摘要、任务和候选绑定一致；新授权证据追加不被当作更换任务基线。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.ITEM.STRUCTURE",
      "nature": "DETERMINISTIC",
      "meaning": "稳定itemId、枚举、引用结构、重复项及基础组合合法。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.SCOPE.COVERAGE",
      "nature": "DETERMINISTIC",
      "meaning": "核明确的必答项/排除权限/允许延期边界；不从自然语言自动证明目标充分完成。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.SOURCE.REGISTERED_REFERENCE",
      "nature": "DETERMINISTIC",
      "meaning": "引用能解析到真实登记/读取的来源和准确版本，当前仍获授权；不以初始包是否包含作唯一判断。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.SOURCE.EXACT_BINDING",
      "nature": "DETERMINISTIC",
      "meaning": "可核引文和位置、明确结构化对象/时间及已登记权威事实冲突；不把散文含义当确定事实。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.METHOD.KNOWN_RULE",
      "nature": "DETERMINISTIC",
      "meaning": "本轮必用方法版本、已明确编码定义/枚举/公式及未知处理；仅参考不触发业务履行要求。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.METHOD.SOURCE_STATUS",
      "nature": "DETERMINISTIC",
      "meaning": "来源确认状态由有权来源决定，模型不可将VERSION_UNCONFIRMED伪造为已批准。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.HISTORY.SCOPE_PRESERVED",
      "nature": "DETERMINISTIC",
      "meaning": "局部更新保留未授权修改的旧问题及版本；准确适配全量或patch现行协议。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.AUTHORITY.NO_PROMOTION",
      "nature": "DETERMINISTIC",
      "meaning": "模型不能修改人工确认或正式业务事实；候选评价不因缺实施记录被拒绝。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.RUNTIME.WRITE_AUTHORITY",
      "nature": "DETERMINISTIC",
      "meaning": "正式SAVE重新检查当前身份/权限/租约/取消/绝对期限。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.SAVE.CAS_IDEMPOTENCY",
      "nature": "DETERMINISTIC",
      "meaning": "原请求及保存键内容一致、CAS合法；不换键掩盖冲突或未知。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.PRECHECK.NO_WRITE",
      "nature": "DETERMINISTIC",
      "meaning": "预检不写工作revision、不试提交或试写后回滚、不做Overall/ACK；正常访问审计不充当业务保存。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.SAVE.RECONCILE_ORIGINAL",
      "nature": "DETERMINISTIC",
      "meaning": "UNKNOWN/COMMITTING查原request/key；HTTP错误不证明零写；确认保存后只恢复READ/投影/收尾阶段。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.EVIDENCE.SUPPORTS_CLAIM",
      "nature": "SEMANTIC_RUBRIC",
      "meaning": "证据是否相关、充分、独立，结论强度是否适当；Host标NOT_MACHINE_ASSESSED。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.MEASURE.CLAIM_BOUNDARY",
      "nature": "SEMANTIC_RUBRIC",
      "meaning": "候选预期、采用、实施、效果验证分开；记录的对象/时间/条件不被外推。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.ANALYSIS.SUFFICIENT",
      "nature": "SEMANTIC_RUBRIC",
      "meaning": "是否完成任务要求的实质分析，未决是否具体、必要调查是否到位。",
      "implementationStatus": "DESIGN_ONLY"
    },
    {
      "ruleId": "WLCHK.METHOD.APPLICABILITY",
      "nature": "SEMANTIC_RUBRIC",
      "meaning": "检查项触发、方法使用及适用理由由智能体提出判断；Host不充当通用自然语言裁判。",
      "implementationStatus": "DESIGN_ONLY"
    }
  ]
} as const;

export const JOBAID_CHECKLIST_RC1_CONTENT_HASH =
  'sha256:c5fc3dacfb8195ff16f29180332805a64263849a45c28203e67c1ea19f92d479' as const;
