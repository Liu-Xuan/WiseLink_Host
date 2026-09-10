import AtlasExampleAssessment from './AtlasExampleAssessment';
import ReviewConversationTurn from '@client/src/features/review/ReviewConversationTurn';
import '@client/src/features/review/continuous-review-panel.css';
import {
  exampleReviewTurn,
  exampleReviewConversation,
} from './example-assessment';
import AtlasRuntime from './AtlasRuntime';
import type { AtlasView } from './atlas-model';
import { atlasTitle } from './guide-content';
export default function AtlasExampleReading({
  view,
  draft,
  onDraft,
  selectedClaim,
  onSelectClaim,
  runtimeIndex,
  onRuntimeChange,
}: {
  view: AtlasView;
  draft: string;
  selectedClaim: string;
  onSelectClaim: (claim: string) => void;
  runtimeIndex: number;
  onRuntimeChange: (index: number) => void;
  onDraft: (value: string) => void;
}) {
  return (
    <section className="atlas-reading" data-atlas-target="reading">
      <span className="atlas-eyebrow">构造样例 · 工程认识工作线</span>
      {view === 'anchors' ? (
        <>
          <h2>一层分类框架，多种有来源的锚点</h2>
          <p className="atlas-lead">
            章节帮助专业定位。技术对象、功能问题与业务依据继续通过各自有含义的关系相连。
          </p>
          <div className="atlas-anchor-grid">
            {[
              ['分类锚点', 'ATA / JASC 原始章、四位节与范围定义'],
              ['技术对象', '系统、组件族、产品与软件标准'],
              ['功能与问题', '现象、机理候选、措施与历史案例'],
              ['业务与依据', '文档族、确切版本、工程事项与原文片段'],
            ].map(([title, text]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <h3>关系保留各自含义</h3>
          <p>
            分类隶属、技术组成与接口、支持或限制认识，是不同的关系。同章节不自动归入同一事项；相似文字不自动证明相同原因。一份资料可以跨章节，尚未对齐四位代码的知识也可保留来源继续分析。
          </p>
        </>
      ) : null}
      {view === 'materials' ? (
        <>
          <h2>本次评估资料</h2>
          <p>
            这些材料共同说明：条件 X 与条件 Y
            有共同技术背景，但问题机理与措施范围不能混同。对象记录只覆盖部分前提。
          </p>
          <table>
            <thead>
              <tr>
                <th>材料与贡献</th>
                <th>正文 / 使用情况</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>SB R1：问题及主要措施</td>
                <td>样例正文已提供 · 初评依据</td>
              </tr>
              <tr>
                <td>明确引用的 FTD R3：调查背景</td>
                <td>样例片段已提供 · 不以 R4 替换</td>
              </tr>
              <tr>
                <td>工程师纠正与记录 P1：软件标准</td>
                <td>本轮示例输入 · 仅支持标准字段</td>
              </tr>
              <tr>
                <td>WDM 引用：补充线索</td>
                <td>仅登记引用 · 目标正文未取得</td>
              </tr>
              <tr>
                <td>子集识别、措施执行记录</td>
                <td>未取得 · 影响对象状态判断</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
      {view === 'initial' ? (
        <>
          <h2>初始综合评估</h2>
          <AtlasExampleAssessment
            revised={false}
            selected={selectedClaim}
            onSelect={onSelectClaim}
          />
          <h3>措施与适用前提</h3>
          <p>
            资料提出的措施具有明确针对范围。当前候选并未证明任何实际飞机已经满足条件或完成实施。
          </p>
          <h3>决定性未知</h3>
          <p>具体子集、对象构型与执行记录尚待取得，未知保留在意见正文中。</p>
        </>
      ) : null}
      {view === 'review' ? (
        <>
          <h2>工程师交互复核</h2>
          <p>预先准备的示例对话 · 没有在此发起运行或采用工程结论。</p>
          <ReviewConversationTurn
            readOnly
            turn={exampleReviewTurn}
            conversation={exampleReviewConversation}
            currentRevision={1}
            isCurrent
          />
          <h3>本轮认识整理</h3>
          <ul>
            <li>已经有依据：记录反映标准 A。</li>
            <li>范围修正：软件标准与措施完成分开。</li>
            <li>仍待核：子集、实施记录及保留意见。</li>
          </ul>
          <label>
            探索笔记（仅留在本次面板，不发送）
            <textarea
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              placeholder="写下需要核对的问题"
            />
          </label>
          <p>
            普通解释仅新增回答；重要反证出现时，旧意见应立即标注需复看，显式更新再综合受影响内容。
          </p>
        </>
      ) : null}
      {view === 'synthesis' ? (
        <>
          <h2>复核后综合评估</h2>
          <AtlasExampleAssessment
            revised
            selected={selectedClaim}
            onSelect={onSelectClaim}
          />
          <h3>改变、不变与仍待核</h3>
          <p>
            改变：不再把标准记录解释成改进完成。仍成立：条件 X 与 Y
            分析分开。待核：子集与执行证据。分歧无需人为清零。
          </p>
          <p>这是预先准备的示例快照，未在此执行模型重综合或保存工程结论。</p>
        </>
      ) : null}
      {view === 'library' ? (
        <>
          <h2>机队技术事项速览</h2>
          <p>{atlasTitle}</p>
          <article>
            <h3>FMC-01 · 条件 X 与措施边界</h3>
            <AtlasExampleAssessment
              revised
              selected={selectedClaim}
              onSelect={onSelectClaim}
              depth="list"
            />
            <dl>
              <dt>资料提出的措施</dt>
              <dd>针对条件 X，受子集和构型前提限制。</dd>
              <dt>我方评估意见</dt>
              <dd>示例复核后候选；未正式采用。</dd>
              <dt>实际实施情况</dt>
              <dd>未核实；未取得执行记录。</dd>
            </dl>
          </article>
          <article>
            <h3>DSP-01 · 显示相关独立现象</h3>
            <p>
              共享部分调查背景，不代表相同机理。当前资料不足以判断实际机队故障率。
            </p>
          </article>
        </>
      ) : null}
      {view === 'runtime' ? (
        <AtlasRuntime index={runtimeIndex} onChange={onRuntimeChange} />
      ) : null}
    </section>
  );
}
