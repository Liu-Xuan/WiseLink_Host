/* Offline contract graph: definitions and recorded wiring, never live execution status. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const nonempty = value => typeof value === 'string' && !!value.trim();
  const names = {
    'source.register':'来源登记', 'source.original':'准确原文',
    'document.reading':'文档解读', 'document.translation':'翻译',
    'assessment.applicability':'适用性', 'assessment.research':'工程调查',
    'assessment.overall':'综合建议', 'business.company_records':'公司意见与措施',
    'business.aeo_execution':'单机落实', 'business.software_configuration':'LCM 构型事实',
    'knowledge.wiki':'Wiki 知识', 'business.adoption':'正式采用', 'surface.reading':'阅读与进度显示',
  };
  const groups = [
    ['来源', ['source.register','source.original']],
    ['文档阅读', ['document.reading','document.translation']],
    ['工程工作', ['assessment.applicability','assessment.research','assessment.overall']],
    ['公司与机队事实', ['business.company_records','business.aeo_execution','business.software_configuration']],
    ['成果使用', ['knowledge.wiki','business.adoption','surface.reading']],
  ];
  const css = `
:host{display:block;color:var(--wl-ink,#242424);font:14px/1.6 var(--wl-font-sans,sans-serif);margin-bottom:20px}
*{box-sizing:border-box}h2{font-size:23px;margin:0}h3{font-size:16px;margin:0 0 8px}p{margin:6px 0}
button,select{font:inherit;color:inherit;background:var(--wl-sheet,#fff);border:1px solid var(--wl-border,#ddd);border-radius:8px;padding:7px 10px;cursor:pointer;text-align:left}
button:focus-visible,summary:focus-visible,select:focus-visible{outline:2px solid #47768f;outline-offset:3px}
button:hover{background:var(--wl-sheet-muted,#f7f7f7)}.panel{background:var(--wl-sheet,#fff);border:1px solid var(--wl-border,#ddd);border-radius:14px;padding:18px}
.muted{color:var(--wl-muted,#666);font-size:12px}.mono{font-family:monospace;font-size:11px;overflow-wrap:anywhere}
.toolbar,.legend{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:12px 0}.legend{font-size:12px;color:var(--wl-muted,#666)}
.legend i{display:inline-block;width:24px;border-top:2px solid #47768f;vertical-align:middle;margin-right:4px}.legend i.unmapped{border-top:2px dashed #969696}
.scroll{overflow:auto;padding:12px 0}.graph{position:relative;display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:30px;min-width:940px;padding:20px 8px}
.group{z-index:1;pointer-events:none}.group h3{font-size:12px;color:var(--wl-muted,#666);font-weight:500}.node{display:block;pointer-events:auto;width:100%;min-height:108px;margin:0 0 25px;padding:12px;border-left:3px solid #aaa}
.node strong,.node span{display:block}.node.mapped{border-left-color:#47768f}.node.planned{border-left-color:#b77c25}.node[aria-pressed=true]{outline:2px solid #47768f;outline-offset:3px}
.node small{display:block;font-size:11px;color:var(--wl-muted,#666);margin-top:5px}.node .state{font-size:12px;margin-top:5px}.graph svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;border-top:1px solid var(--wl-border,#ddd);padding-top:18px;overflow-wrap:anywhere}
.detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:8px;margin:12px 0}.detail dt{font-size:12px;color:var(--wl-muted,#666)}.detail dd{margin:0}.detail button{margin:5px 5px 0 0}
summary{cursor:pointer}.package{border-top:1px solid var(--wl-border,#ddd);padding:9px 0}.edge-list{display:grid;gap:7px;margin-top:12px}.edge-list button{width:100%;font-size:12px;display:grid;grid-template-columns:190px minmax(0,1fr) 180px;gap:12px}.edge-list button[aria-pressed=true]{outline:2px solid #47768f}
.alert{border-left:3px solid #b77c25;padding-left:12px}.notice{border-left:3px solid #aaa;padding-left:12px;margin-top:12px}
@media(max-width:760px){.detail{grid-template-columns:1fr}.panel{padding:12px}.edge-list button{grid-template-columns:1fr;gap:2px}}
`;
  class WiseLinkContractGraph extends HTMLElement {
    constructor() {
      super(); this.attachShadow({mode:'open'}); this._data = null;
      this._node = null; this._edge = null; this._all = false; this._directoryOpen = false;
      this._raf = null; this._observer = new ResizeObserver(() => this.draw());
    }
    connectedCallback() { this.render(); this._observer.observe(this); }
    disconnectedCallback() { this._observer.disconnect(); if (this._raf !== null) cancelAnimationFrame(this._raf); }
    set verification(value) {
      this._data = value;
      if (!value?.catalog.nodes.some(node => node.id === this._node)) {
        this._node = value?.catalog.nodes.find(node => node.id === 'assessment.research')?.id
          ?? value?.catalog.nodes[0]?.id ?? null;
      }
      if (!value?.catalog.edges.some(edge => edge.id === this._edge)) this._edge = null;
      this.render();
    }
    get verification() { return this._data; }
    label(node) { return node.label ?? node.title ?? names[node.id] ?? node.id; }
    bindings(item, kind) {
      return this._data.bindings.filter(binding => (binding[kind === 'node' ? 'nodeIds' : 'edgeIds'] ?? []).includes(item.id));
    }
    state(bindings) {
      const mapped = bindings.filter(binding => nonempty(binding.consumer) && nonempty(binding.sourceRevision)).length;
      const planned = bindings.length - mapped;
      return {mapped, planned, tone:mapped ? 'mapped' : planned ? 'planned' : 'unmapped',
        label:mapped ? '已有实现映射' : planned ? '计划待接入' : '接线待登记'};
    }
    // Only exact, named node endpoints become lines. Ports and wildcard phrases remain in the directory.
    segments(edge) {
      const ids = new Set(this._data.catalog.nodes.map(node => node.id));
      const steps = String(edge.endpointTemplate ?? '').split('→').map(step =>
        step.split('/').map(id => id.trim()).filter(id => ids.has(id)));
      return steps.slice(1).flatMap((targets,index) => steps[index].flatMap(from =>
        targets.map(to => ({from,to,edgeId:edge.id}))));
    }
    relatedEdges(node) {
      const bindingEdges = new Set(this.bindings(node,'node').flatMap(binding => binding.edgeIds ?? []));
      return this._data.catalog.edges.filter(edge => bindingEdges.has(edge.id)
        || (String(edge.endpointTemplate ?? '').match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g) ?? []).includes(node.id));
    }
    records(bindings, item, kind) {
      const ids = new Set(bindings.map(binding => binding.id));
      return this._data.evidence.filter(record => (record.bindingIds ?? []).some(id => ids.has(id))
        || (record[kind === 'node' ? 'nodeIds' : 'edgeIds'] ?? []).includes(item.id));
    }
    auditButton(kind, id, label) {
      return `<button data-audit-kind="${esc(kind)}" data-audit-id="${esc(id)}">${esc(label)}</button>`;
    }
    detail(item, kind) {
      const bindings = this.bindings(item,kind), state = this.state(bindings);
      const records = this.records(bindings,item,kind);
      const issues = records.filter(record => ['failed','inconclusive'].includes(record.status));
      const packages = (this._data.snapshot.workPackages ?? []).filter(pkg =>
        bindings.some(binding => (pkg.bindingIds ?? []).includes(binding.id) || (binding.workPackageIds ?? []).includes(pkg.id)));
      const fields = kind === 'node'
        ? [['scope','节点范围'],['inputOutput','输入 → 输出'],['successCriterion','节点完成条件']]
        : [['endpointTemplate','契约方向'],['kind','关系类型'],['activation','激活条件'],['readback','验收读回'],['artifactBinding','绑定内容'],['changeImpact','变化处理']];
      return `<section class="detail"><div><h3>${kind === 'node' ? esc(this.label(item)) : '关系 · '+esc(item.id)}</h3>
        <p class="mono">${esc(item.id)}</p><p><strong>${state.label}</strong> · ${state.mapped} 条实现映射 / ${state.planned} 条待接入映射</p>
        <dl>${fields.filter(([key]) => item[key]).map(([key,label]) => `<dt>${label}</dt><dd>${esc(item[key])}</dd>`).join('')}</dl>
        <p class="muted">这是开发接线状态，不是当前业务对象的运行状态，也不代表整个节点或关系验收通过。</p>
        <p>关联记录：${records.length} 条；通过 ${records.filter(record => record.status === 'passed').length}，失败 / 未定论 ${issues.length}，未执行 ${records.filter(record => record.status === 'not_run').length}。</p>
        ${issues.length ? '<p class="alert muted">关联范围仍有失败 / 未定论记录；旧失败与后继修复均保留，请按版本和报告核对。</p>' : ''}
        ${this.auditButton(kind,item.id,'查看严格验证与原始定义')}
        <h3 style="margin-top:16px">实际接线</h3>${bindings.length ? bindings.map(binding =>
          this.auditButton('binding',binding.id,`${binding.title ?? binding.label ?? binding.id} · ${this.state([binding]).label}`)).join('')
          : '<p class="notice">契约已定义，但当前接线表没有精确映射。下一步先定位现有生产者、消费者和读回入口并登记，不据此判断没有实现或重写模块。</p>'}
        ${item.id === 'business.adoption' ? '<p class="notice">正式采用是显式业务动作。先核对当前交付范围；模型候选或技术发布不能代替原系统提交与批准回执。</p>' : ''}
        </div><div><h3>关联工作包：缺口与下一步</h3><p class="muted">沿用同一份 P0–P6 记录，适用范围是工作包，不重复推导节点进度。</p>
        ${packages.length ? packages.map(pkg => `<details class="package"><summary>${esc(pkg.label)}</summary>
          <p><strong>已交付：</strong>${esc(pkg.progress?.delivered ?? '见接线记录')}</p>
          <p><strong>缺口：</strong>${esc(pkg.progress?.remaining ?? '尚未整理')}</p>
          <p><strong>下一步：</strong>${esc(pkg.nextAction ?? '待登记')}</p>
          <p><strong>完成条件：</strong>${esc(pkg.progress?.acceptance ?? '见节点契约')}</p></details>`).join('')
          : '<p>尚未映射到工作包。核对范围后补接线与负责范围，再登记局部验证和真实读回。</p>'}</div></section>`;
    }
    render() {
      if (!this.shadowRoot) return;
      const root = this.shadowRoot, data = this._data;
      if (!data) { root.innerHTML = ''; return; }
      const nodes = data.catalog.nodes, edges = data.catalog.edges;
      const known = new Set(groups.flatMap(([,ids]) => ids));
      const displayGroups = [...groups, ['其他契约节点',nodes.filter(node => !known.has(node.id)).map(node => node.id)]];
      const selectedNode = nodes.find(node => node.id === this._node) ?? nodes[0];
      const selectedEdge = edges.find(edge => edge.id === this._edge);
      const selected = selectedEdge ?? selectedNode;
      const shownEdges = this._all ? edges : selectedEdge ? [selectedEdge] : this.relatedEdges(selectedNode);
      const mappedNodes = nodes.filter(node => this.state(this.bindings(node,'node')).mapped).length;
      const mappedEdges = edges.filter(edge => this.state(this.bindings(edge,'edge')).mapped).length;
      const drawable = edges.filter(edge => this.segments(edge).length).length;
      root.innerHTML = `<style>${css}</style><section class="panel"><h2>图契约与整体接线</h2>
        <p>${nodes.length} 个节点 · ${edges.length} 类关系已定义；其中 ${mappedNodes} 个节点、${mappedEdges} 类关系有明确实现映射。其余需要登记或接入，不等于尚未开发。</p>
        <p class="muted">与进度图相同，按来源、阅读、工程、事实和成果分组；点击节点看接线与下一步。本地静态快照 · ${esc(data.snapshot.generatedAt)}</p>
        ${data.snapshot.dataMode === 'demo' || data.snapshot.mode === 'demo' ? '<p class="alert">设计样例，不代表实际项目进展。</p>' : ''}
        <div class="toolbar"><label>连线范围 <select id="line-scope"><option value="selected" ${!this._all ? 'selected' : ''}>所选节点 / 关系</option><option value="all" ${this._all ? 'selected' : ''}>全部明确节点关系</option></select></label>
        <span class="muted">连线依据契约方向，不表示正在执行。</span></div>
        <div class="legend"><span><i></i>关系已有实现映射</span><span><i class="unmapped"></i>关系待接入 / 待登记</span><span>节点：蓝边已有映射 · 黄边计划接入 · 灰边待登记</span></div>
        <div class="scroll"><div class="graph"><svg aria-hidden="true"></svg>${displayGroups.filter(([,ids]) => nodes.some(node => ids.includes(node.id))).map(([label,ids]) =>
          `<section class="group"><h3>${esc(label)}</h3>${ids.map(id => nodes.find(node => node.id === id)).filter(Boolean).map(node => {
            const bindings = this.bindings(node,'node'), state = this.state(bindings);
            return `<button class="node ${state.tone}" data-node="${esc(node.id)}" aria-pressed="${node.id === this._node && !selectedEdge}">
            <strong>${esc(this.label(node))}</strong><span class="state">${state.label}</span>
            <small>${state.mapped} 条实现映射 · ${state.planned} 条待接入</small>
            ${bindings.some(binding => binding.gaps?.length) ? '<small>关联范围仍有待收口项</small>' : ''}
            <span class="mono">${esc(node.id)}</span></button>`;
          }).join('')}</section>`).join('')}</div></div>
        <p class="muted">${drawable} 类关系可画出明确节点之间的连线。外部输入、通配读取与变化触发保留在完整清单中，不猜测它们的目标节点。</p>
        ${selected ? this.detail(selected,selectedEdge ? 'edge' : 'node') : ''}
        <details id="edge-directory" ${this._directoryOpen ? 'open' : ''} style="margin-top:18px"><summary>关系清单 · 当前关联 ${shownEdges.length} / 全部 ${edges.length}（切换上方范围查看全部）</summary>
        <div class="edge-list">${shownEdges.map(edge => `<button data-edge="${esc(edge.id)}" aria-pressed="${edge.id === this._edge}"><strong>${esc(edge.id)}</strong>
        <span>${esc(edge.endpointTemplate)}</span><span>${this.state(this.bindings(edge,'edge')).label}</span></button>`).join('')}</div></details></section>`;
      root.querySelectorAll('[data-node]').forEach(button => button.onclick = () => {
        this._node = button.dataset.node; this._edge = null; this.render();
      });
      root.querySelectorAll('[data-edge]').forEach(button => button.onclick = () => {
        this._edge = button.dataset.edge; this.render();
      });
      root.querySelector('#line-scope').onchange = event => { this._all = event.target.value === 'all'; this.render(); };
      root.querySelector('#edge-directory').ontoggle = event => { this._directoryOpen = event.target.open; };
      root.querySelectorAll('[data-audit-kind]').forEach(button => button.onclick = () => {
        this.dispatchEvent(new CustomEvent('wiselink-contract-select', {bubbles:true,composed:true,
          detail:{category:button.dataset.auditKind,id:button.dataset.auditId}}));
      });
      if (this._raf !== null) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => { if (this.isConnected) this.draw(); });
    }
    draw() {
      if (!this._data) return;
      const graph = this.shadowRoot.querySelector('.graph'), svg = graph?.querySelector('svg');
      if (!svg) return;
      const box = graph.getBoundingClientRect();
      if (!box.width || !box.height) return;
      svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
      const buttons = new Map([...graph.querySelectorAll('[data-node]')].map(button =>
        [button.dataset.node,button.getBoundingClientRect()]));
      const edges = this._data.catalog.edges.filter(edge => this._all || (this._edge ? edge.id === this._edge
        : this.segments(edge).some(segment => segment.from === this._node || segment.to === this._node)));
      const lines = edges.flatMap(edge => this.segments(edge).filter(segment => this._all || this._edge
        || segment.from === this._node || segment.to === this._node).map(segment => ({...segment,edge})));
      svg.innerHTML = '<defs><marker id="contract-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>'
        + lines.map(({from,to,edge},index) => {
          const a = buttons.get(from), b = buttons.get(to);
          if (!a || !b) return '';
          const sameColumn = Math.abs(a.left-b.left) < 2;
          let x1, y1, x2, y2, path;
          if (sameColumn) {
            x1 = a.right-box.left; y1 = a.top+a.height/2-box.top;
            x2 = b.right-box.left; y2 = b.top+b.height/2-box.top;
            const bend = x1+12+(index%3)*5;
            path = from === to ? `M ${x1} ${y1-12} C ${bend+15} ${y1-30}, ${bend+15} ${y1+30}, ${x2} ${y2+12}`
              : `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
          } else {
            const forward = b.left>a.left;
            x1 = (forward ? a.right : a.left)-box.left; y1 = a.top+a.height/2-box.top;
            x2 = (forward ? b.left : b.right)-box.left; y2 = b.top+b.height/2-box.top;
            const bend = (x1+x2)/2;
            path = `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
          }
          const mapped = this.state(this.bindings(edge,'edge')).mapped;
          return `<path data-edge-line="${esc(edge.id)}" d="${path}" fill="none" stroke="${mapped ? '#47768f' : '#969696'}" stroke-width="1.5" ${mapped ? '' : 'stroke-dasharray="5 4"'} marker-end="url(#contract-arrow)"><title>${esc(edge.id+' · '+edge.endpointTemplate)}</title></path>`;
        }).join('');
    }
  }
  if (!customElements.get('wiselink-contract-graph')) customElements.define('wiselink-contract-graph',WiseLinkContractGraph);
})();
