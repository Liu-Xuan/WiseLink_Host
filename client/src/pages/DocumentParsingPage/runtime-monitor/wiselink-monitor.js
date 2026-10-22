/* WiseLink read-only monitor. No transport or authority decisions. */
(()=>{
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>typeof v==='string'?v:v?.label??v?.status??'未记录';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=v=>typeof v==='string'&&!!v.trim();
const isoTime=v=>{
  if (typeof v !== 'string') return false;
  const match=v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match || !Number.isFinite(Date.parse(v))) return false;
  const [year,month,day,hour,minute,second]=match.slice(1).map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<24&&minute<60&&second<60;
};
const style=`
:host{display:block;min-width:0;color:var(--wl-ink,#242424);font:14px/1.6 var(--wl-font-sans,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif);--m-surface:var(--wl-sheet,#fff);--m-soft:var(--wl-sheet-muted,#f7f7f7);--m-border:var(--wl-border,rgba(0,0,0,.1));--m-muted:var(--wl-muted,#666)}*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button,select{background:var(--m-surface);border:1px solid var(--m-border);border-radius:8px;padding:7px 11px;cursor:pointer}button:hover{background:var(--wl-selected,#e8e8e8)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--wl-accent,#242424);outline-offset:3px}button[aria-pressed=true]{background:var(--wl-accent,#242424);color:var(--wl-sheet,#fff)}header{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;margin-bottom:18px}h2{font-size:23px;line-height:1.35;margin:0 0 5px;font-weight:650}h3{font-size:15px;margin:0 0 10px}p{margin:5px 0}small,.muted{color:var(--m-muted);font-size:12px}.tools,.tabs,.chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.tabs{border-bottom:1px solid var(--m-border);padding-bottom:12px;margin-bottom:18px}.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--m-border);border-radius:6px;padding:2px 7px;font-size:12px;background:var(--m-soft)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start}.main{min-width:0}.panel{background:var(--m-surface);border:1px solid var(--m-border);border-radius:14px;padding:18px;min-width:0}.detail{position:sticky;top:12px;overflow-wrap:anywhere}.detail section{border-top:1px solid var(--m-border);margin-top:16px;padding-top:14px}.detail button{margin:5px 4px 0 0;text-align:left}.axes{display:grid;grid-template-columns:74px minmax(0,1fr);gap:7px;font-size:12px;margin:14px 0}.axes dt{color:var(--m-muted)}.axes dd{margin:0}.graph{position:relative;display:grid;gap:24px;padding:22px 18px;isolation:isolate}.group{position:relative;z-index:1}.group-label{font-size:12px;color:var(--m-muted);margin-bottom:9px}.nodes{display:flex;gap:12px;flex-wrap:wrap}.node{flex:1 1 145px;max-width:260px;min-width:0;text-align:left;padding:12px;background:var(--m-surface);border-radius:11px;border:1px solid var(--m-border);box-shadow:0 3px 9px #00000004}.node.selected{outline:2px solid var(--wl-accent,#242424);outline-offset:2px}.node strong{display:block;font-size:13px;margin-bottom:6px}.node .muted{display:block}.node .badge{margin-top:7px}.dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--wl-faint,#8a8a8a);flex-shrink:0}.dot.good{background:var(--wl-green,#25b86b)}.dot.wait{background:var(--wl-amber,#f2a23a)}.dot.error{background:var(--wl-red,#e85a62)}svg.links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible}.legend{display:flex;gap:15px;flex-wrap:wrap;font-size:12px;color:var(--m-muted);margin-bottom:10px}.legend i{display:inline-block;width:22px;border-top:1px solid var(--m-muted);margin-right:5px;vertical-align:middle}.legend .dash{border-top-style:dashed}.edge-list{display:grid;gap:8px;margin-top:15px}.edge{padding:9px 11px;border-left:2px solid var(--m-border);background:var(--m-soft);font-size:12px;overflow-wrap:anywhere}.edge.active{border-left-color:var(--wl-amber,#f2a23a)}.empty{padding:40px 22px;text-align:center;background:var(--m-soft);border:1px dashed var(--m-border);border-radius:14px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}th{font-weight:500;color:var(--m-muted);white-space:nowrap}th,td{padding:12px 9px;border-bottom:1px solid var(--m-border);vertical-align:top}td button{padding:3px 6px;text-align:left}tr.selected td{background:var(--m-soft)}.filter{width:100%;padding:9px 12px;background:var(--m-surface);border:1px solid var(--m-border);border-radius:9px;margin-bottom:12px}.resources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.metric strong{font-size:25px;display:block;margin:10px 0}.metric p{font-size:12px;color:var(--m-muted)}.error-message{color:var(--wl-red,#e85a62);font-size:12px}.file{font-size:12px;max-width:250px}.mono{font-family:var(--wl-mono,monospace);font-size:11px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:var(--m-soft);padding:10px;border-radius:8px;max-height:350px;overflow:auto}.hint{margin:12px 0;color:var(--m-muted);font-size:12px}@media(max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.detail{position:static}.node{max-width:none}}@media(max-width:560px){.tablewrap table{min-width:620px}header{flex-direction:column}.graph{padding:16px 12px}.nodes{flex-direction:column}.node{flex:auto;width:100%}.resources{grid-template-columns:1fr}.panel{padding:14px}.tabs button{padding:7px 8px}h2{font-size:21px}svg.links{opacity:.4}}
`;
class WiseLinkMonitor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._runtime = null;
    this._verification = null;
    this._view = 'requests';
    this._allowVerification = false;
    this._allowRefresh = true;
    this._selected = null;
    this._request = null;
    this._binding = null;
    this._category = 'binding';
    this._filter = '';
    this._verificationFilter = '';
    this._workPackage = ''; this._chain = ''; this._scenario = ''; this._gap = '';
    this._error = '';
    this._runtimeError = '';
    this._composing = false;
    this._renderKey = null;
    this._importGeneration = 0;
    this._raf = null;
    this._observer = new ResizeObserver(() => this.drawEdges());
  }

  connectedCallback() { this.render(); this._observer.observe(this); }
  disconnectedCallback() {
    this._observer.disconnect();
    this._composing = false;
    if (this._raf !== null) cancelAnimationFrame(this._raf);
  }
  set runtime(value) { this.updateInputs({runtime:value}); }
  get runtime() { return this._runtime; }
  set verification(value) { this.updateInputs({verification:value}); }
  get verification() { return this._verification; }
  set view(value) { this.updateInputs({view:value}); }
  get view() { return this._view; }
  set allowVerification(value) { this.updateInputs({allowVerification:value}); }
  get allowVerification() { return this._allowVerification; }
  runtimeKey(data) { return data ? JSON.stringify([data.meta?.scopeKey,data.scope?.id,data.scope?.kind,data.meta?.environment,data.meta?.mode === 'demo' ? 'demo' : 'actual']) : 'empty'; }
  verificationKey(data) { return data ? JSON.stringify([data.snapshot?.contract?.sourceRevision,data.snapshot?.target?.sourceRevision,data.snapshot?.target?.environmentId,data.snapshot?.dataMode]) : 'empty'; }
  updateInputs(inputs) {
    if (Object.hasOwn(inputs,'runtime')) {
      const previous = this.runtimeKey(this._runtime);
      try {
        this._runtime = inputs.runtime == null ? null : this.validateRuntime(inputs.runtime);
        this._runtimeError = '';
      } catch (error) {
        // A malformed new scope must never leave the previous object's body visible.
        this._runtime = null; this._runtimeError = error.message ?? '运行投影无效';
      }
      if (previous !== this.runtimeKey(this._runtime)) {
        this._selected = null; this._request = null; this._filter = ''; this._composing = false;
      }
      if (!(this._runtime?.nodes ?? []).some(n => n.id === this._selected)) {
        this._selected = this._runtime?.nodes?.find(n => n.id === 'assessment.overall')?.id
          ?? this._runtime?.nodes?.find(n => n.requests?.length)?.id ?? this._runtime?.nodes?.[0]?.id ?? null;
      }
      const selected = this._runtime?.nodes.find(n => n.id === this._selected);
      if (!(selected?.requests ?? []).some(r => r.id === this._request)) this._request = null;
    }
    if (Object.hasOwn(inputs,'verification')) {
      ++this._importGeneration;
      try {
        const next = inputs.verification == null ? null : this.validateVerification(inputs.verification);
        if (this.verificationKey(next) !== this.verificationKey(this._verification)) {
          this._binding = null; this._verificationFilter = ''; this._composing = false;
          this._workPackage = ''; this._chain = ''; this._scenario = ''; this._gap = '';
        }
        this._verification = next; this._error = '';
        if (next) {
          if (!(next.snapshot.workPackages ?? []).some(pkg => pkg.id === this._workPackage)) this._workPackage = '';
          if (!next.catalog.scenarios.some(row => row.id === this._scenario)) this._scenario = '';
          if (this._chain && !(this._chain.startsWith('binding:') ? next.bindings.some(row => row.id === this._chain.slice(8)) : next.catalog.edges.some(row => row.id === this._chain.slice(5)))) this._chain = '';
        }
      } catch (error) { this._error = error.message ?? '验证快照无效'; }
    }
    if (Object.hasOwn(inputs,'view')) this._view = ['flow','requests','resources','verification'].includes(inputs.view) ? inputs.view : 'requests';
    if (Object.hasOwn(inputs,'allowVerification')) this._allowVerification = !!inputs.allowVerification;
    if (Object.hasOwn(inputs,'allowRefresh')) this._allowRefresh = !!inputs.allowRefresh;
    this.render();
  }
  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  focusKey(element) {
    if (!element) return null;
    if (element.id) return `id:${element.id}`;
    const attrs = ['data-view','data-node','data-request','data-owner','data-nav','data-record-kind','data-ref','data-item','data-category']
      .filter(key => element.hasAttribute(key)).map(key => [key,element.getAttribute(key)]);
    return attrs.length ? JSON.stringify([element.tagName,attrs]) : null;
  }
  captureReading() {
    const active = this.shadowRoot.activeElement;
    return {focus:this.focusKey(active),start:active?.selectionStart,end:active?.selectionEnd,direction:active?.selectionDirection,
      scroll:[...this.shadowRoot.querySelectorAll('.tablewrap,.detail,.detail pre')].map(el => [el.scrollLeft,el.scrollTop]),
      x:window.scrollX,y:window.scrollY};
  }
  restoreReading(saved) {
    if (!saved) return;
    const active = saved.focus && [...this.shadowRoot.querySelectorAll('button,input,select')].find(el => this.focusKey(el) === saved.focus);
    if (active) {
      active.focus({preventScroll:true});
      if (typeof saved.start === 'number' && typeof active.setSelectionRange === 'function') active.setSelectionRange(saved.start,saved.end,saved.direction);
    }
    [...this.shadowRoot.querySelectorAll('.tablewrap,.detail,.detail pre')].forEach((el,i) => {
      if (saved.scroll[i]) { el.scrollLeft = saved.scroll[i][0]; el.scrollTop = saved.scroll[i][1]; }
    });
    window.scrollTo(saved.x,saved.y);
  }
  readLabel(meta) {
    if (meta?.mode === 'demo' || meta?.dataMode === 'demo') return '设计样例 · 非线上状态';
    if (meta?.readState === 'refreshing') return '刷新中 · 显示上次读回';
    if (meta?.readState === 'failed') return '读取失败 · 显示上次读回';
    if (meta?.readState === 'stale') return '保留旧快照';
    return meta?.mode === 'live' ? '已读回' : '只读快照';
  }

  status(value) {
    const label = text(value);
    const tones = { SUCCEEDED:'good', SAVED:'good', CURRENT:'good', COMPLETED:'good',
      QUEUED:'wait', RUNNING:'wait', RETRY_SCHEDULED:'wait', COMMITTING:'wait', UNKNOWN:'wait', STALE:'wait',
      FAILED:'error', TIMED_OUT:'error', CONFLICT:'error' };
    const tone = ['good','wait','error'].includes(value?.tone) ? value.tone : tones[value?.status ?? label] ?? '';
    return `<span class="badge"><i class="dot ${tone}"></i>${esc(label)}</span>`;
  }
  execution(node) { return node.kind === 'fact' ? '来源事实' : node.execution; }
  render() {
    if (!this.shadowRoot) return;
    const view = this._view === 'verification' && !this._allowVerification ? 'requests' : this._view;
    const data = view === 'verification' ? this._verification : this._runtime;
    const meta = view === 'verification' ? data?.snapshot : data?.meta;
    const key = `${view}:${view === 'verification' ? this.verificationKey(data) : this.runtimeKey(data)}`;
    // Preserve an in-progress IME composition across same-scope polling updates.
    // Changing authorized scope or view still replaces the body immediately.
    if (this._composing && this._renderKey === key) return;
    const saved = this._renderKey === key ? this.captureReading() : null;
    this._composing = false; this._renderKey = key;
    const stamp = view === 'verification' ? `生成于 ${meta?.generatedAt ?? '未提供'}` : `读取于 ${meta?.observedAt ?? '未提供'}`;
    this.shadowRoot.innerHTML = `<style>${style}</style>
      <header><div><h2>${view === 'verification' ? '接线与验证' : '事项运行诊断'}</h2>
      <div class="muted">${esc(view === 'verification' ? '主线契约 · 实施证据' : this._runtime?.scope?.label ?? '尚未选择观察对象')}</div></div>
      <div class="tools">${data ? `<span class="badge">${esc(this.readLabel(meta))}</span>` : ''}
      ${this._allowRefresh ? '<button id="refresh" type="button">重新读取</button>' : ''}</div></header>
      <nav class="tabs" aria-label="监控视图">${[...(this._runtime || !this._allowVerification ? [['requests','任务记录'],['flow','流程'],['resources','资源']] : []),...(this._allowVerification ? [['verification','接线与验证']] : [])].map(([key,label]) => `<button data-view="${key}" aria-pressed="${view === key}">${label}</button>`).join('')}</nav>
      ${data ? `<div class="muted" style="margin-bottom:12px">${esc(meta?.environment ?? meta?.target?.environmentId ?? '环境未指定')} · ${esc(stamp)}</div>` : ''}
      ${view !== 'verification' && (this._runtimeError || meta?.readState === 'failed' && meta?.readError) ? `<p class="error-message" role="alert">${esc(this._runtimeError || meta.readError)}</p>` : ''}
      ${view === 'verification' ? this.verificationView() : !data ? '<div class="empty"><h3>尚未接入运行数据</h3><p class="muted">由宿主传入准确对象的只读投影。</p></div>' : `<div class="layout"><div class="main">${view === 'flow' ? this.flow() : view === 'requests' ? this.requests() : this.resources()}</div>${this.detail()}</div>`}`;
    const root = this.shadowRoot;
    const refresh = root.querySelector('#refresh');
    if (refresh) refresh.onclick = () => { if (this._allowRefresh) this.emit('wiselink-refresh', { view }); };
    root.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { this._view = button.dataset.view; this.render(); });
    root.querySelectorAll('[data-node]').forEach(button => button.onclick = () => { this._selected = button.dataset.node; this._request = null; this.render(); });
    root.querySelectorAll('[data-request]').forEach(button => button.onclick = () => { this._selected = button.dataset.owner; this._request = button.dataset.request; this.render(); });
    const navigationScope = this.runtimeKey(this._runtime), navigationNode = this._selected;
    root.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => {
      if (navigationScope !== this.runtimeKey(this._runtime) || navigationNode !== this._selected) return;
      const node = this._runtime?.nodes.find(n => n.id === navigationNode);
      if (!node) return;
      const detail = {kind:button.dataset.nav,nodeId:node.id,ref:button.dataset.ref,
        scopeKey:this._runtime.meta.scopeKey,subjectRef:this._runtime.scope.id};
      if (detail.kind === 'request') {
        const record = node.requests.find(r => r.id === button.dataset.ref);
        if (!record) return;
        detail.recordKind = record.recordKind ?? 'request';
        if (detail.recordKind === 'attempt') detail.attemptId = record.id;
        else detail.requestId = record.id;
      }
      this.emit('wiselink-navigate',detail);
    });
    this.bindFilter('#filter', '_filter');
    this.bindFilter('#verification-filter', '_verificationFilter');
    for (const [id,field] of [['work-package-filter','_workPackage'],['chain-filter','_chain'],['scenario-filter','_scenario'],['gap-filter','_gap']]) {
      const select = root.querySelector(`#${id}`);
      if (select) select.onchange = () => { this[field] = select.value; this._binding = null; this.render(); };
    }
    root.querySelectorAll('[data-binding-detail]').forEach(button => button.onclick = () => {
      this._category = 'binding'; this._binding = `binding:${button.dataset.bindingDetail}`;
      this._verificationFilter = ''; this._workPackage = ''; this._chain = ''; this._scenario = ''; this._gap = '';
      this.render();
    });
    root.querySelectorAll('[data-item]').forEach(button => button.onclick = () => { this._binding = button.dataset.item; this.render(); });
    root.querySelectorAll('[data-category]').forEach(button => button.onclick = () => { this._category = button.dataset.category; this._binding = null; this._verificationFilter = ''; this.render(); });
    const input = root.querySelector('#import');
    if (input) input.onchange = () => this.importFile(input.files?.[0]);
    this.restoreReading(saved);
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => { if (this.isConnected) this.drawEdges(); });
  }
  bindFilter(selector, field) {
    const input = this.shadowRoot.querySelector(selector);
    if (!input) return;
    input.addEventListener('compositionstart', () => { this._composing = true; });
    input.addEventListener('compositionend', () => { this._composing = false; this[field] = input.value; this.render(); });
    input.oninput = event => {
      this[field] = input.value;
      if (this._composing || event.isComposing) return;
      this.render();
    };
  }
  flow() {
    const groups = ['来源','阅读交付','工程工作','公司与机队事实','知识积累'];
    return `<div class="legend"><span><i></i>已消费</span><span><i class="dash"></i>待纳入 / 关系未知</span><span>显示选中节点的关系</span></div>
      <div class="panel graph"><svg class="links" aria-hidden="true"></svg>${groups.filter(group => this._runtime.nodes.some(n => n.group === group)).map(group => `<section class="group"><div class="group-label">${group}</div><div class="nodes">${this._runtime.nodes.filter(n => n.group === group).map(node => `<button class="node ${this._selected === node.id ? 'selected' : ''}" data-node="${esc(node.id)}">
        <strong>${esc(node.label)}</strong><span class="muted">${esc(node.summary)}</span>
        <div class="chips">${this.status(this.execution(node))}${node.coverage?.tone === 'wait' || node.coverage?.tone === 'error' ? this.status(node.coverage) : ''}</div>
        <span class="muted" style="margin-top:5px">${esc(text(node.artifact))}${node.requests?.length ? ` · ${node.requests.length} 条观察记录` : ''}</span></button>`).join('')}</div></section>`).join('')}</div>`;
  }
  requests() {
    const rows = this._runtime.nodes.flatMap(node => (node.requests ?? []).map(request => ({...request,node})))
      .filter(({node,...request}) => JSON.stringify({...request,nodeId:node.id,nodeLabel:node.label}).toLowerCase().includes(this._filter.toLowerCase()));
    return `<div class="panel"><input id="filter" class="filter" aria-label="筛选请求" placeholder="筛选对象、请求或状态" value="${esc(this._filter)}">
      <div class="tablewrap"><table><thead><tr><th>请求 / 尝试观察</th><th>执行 / 等待</th><th>已有成果</th><th>有效进展 / 下一步</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.node.id === this._selected && row.id === this._request ? 'selected' : ''}">
        <td><button data-request="${esc(row.id)}" data-owner="${esc(row.node.id)}">${esc(row.node.label)}<br><span class="mono">${row.recordKind === 'attempt' ? '尝试 · ' : ''}${esc(row.id)}</span></button>${row.subjectLabel || row.subjectRef || row.targetLabel ? `<p class="muted">${esc([row.subjectLabel ?? row.subjectRef,row.targetLabel].filter(Boolean).join(' · '))}</p>` : ''}${row.node.requestCoverage ? `<p class="muted">${esc(row.node.requestCoverage)}</p>` : ''}</td>
        <td>${this.status(row.status)}${row.waitingReason ? `<p class="muted">${esc(row.waitingReason)}</p>` : ''}</td><td>${esc(row.artifact ?? '未取得对应成果观察')}</td>
        <td>${row.lastProgressAt ? `<span class="mono">${esc(row.lastProgressAt)}</span><br>` : '<span class="muted">有效进展时间未取得</span><br>'}${esc(row.next ?? '—')}</td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<p class="hint">当前观察中没有匹配记录。</p>'}</div></div>`;
  }
  resources() {
    const resources = this._runtime.resources;
    if (!resources) return '<div class="empty">本视图未取得资源观察</div>';
    return `<div class="hint">环境范围：${esc(resources.scope ?? this._runtime.meta.environment)}。资源占用不代表业务完成。</div><div class="resources">${(resources.items ?? []).map(item => `<section class="panel metric"><h3>${esc(item.label)}</h3><strong>${esc(item.value ?? '未知')}</strong><p>${esc(item.detail)}</p></section>`).join('')}</div>`;
  }
  detail() {
    const node = this._runtime.nodes.find(n => n.id === this._selected);
    if (!node) return '<aside class="panel detail"><h3>查看节点与请求</h3><p class="muted">选择节点查看已有成果、准确输入和待处理变化。</p></aside>';
    const request = node.requests?.find(r => r.id === this._request);
    const waiting = !request && node.requests?.find(r => r.waitingReason);
    const axes = [['执行', this.execution(node)],['成果',node.artifact],['覆盖',node.coverage],['业务',node.business]];
    const references = (list, kind) => (list ?? []).map(item => `<button data-nav="${kind}" data-ref="${esc(item.ref)}">${esc(item.label)}<br><span class="mono">${esc(item.ref)}</span></button>`).join('') || '<p class="muted">未记录</p>';
    return `<aside class="panel detail"><h3>${esc(node.label)}</h3><p>${esc(node.summary)}</p><dl class="axes">${axes.map(([key,value]) => `<dt>${key}</dt><dd>${esc(text(value))}</dd>`).join('')}</dl>
      ${node.coverageScope ? `<p class="muted">覆盖范围：${esc(node.coverageScope)}</p>` : ''}${node.sourceObservedAt ? `<p class="muted">来源观察于 ${esc(node.sourceObservedAt)}</p>` : ''}
      ${waiting ? `<p class="hint">${esc(waiting.waitingReason)}${waiting.next ? `<br>下一步：${esc(waiting.next)}` : ''}</p>` : ''}
      ${request ? `<section><h3>${request.recordKind === 'attempt' ? '选定尝试观察' : '选定请求'}</h3><p class="mono">${esc(request.id)}</p><p>${esc(text(request.status))}</p>
      <dl class="axes">${[['对象',request.subjectLabel ?? request.subjectRef],['目标',request.targetLabel],['执行者',request.owner],['请求记录',request.createdAt],['入队',request.queuedAt],['执行开始',request.startedAt],['首次有效保存',request.firstSavedAt],['执行终态',request.completedAt],['有效进展',request.lastProgressAt],['等待',request.waitingReason]].filter(([,v]) => v).map(([k,v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">${esc(request.next ?? '')}</p>
      <button data-nav="request" data-record-kind="${esc(request.recordKind ?? 'request')}" data-ref="${esc(request.id)}">${esc(request.navigationLabel ?? `查看${request.recordKind === 'attempt' ? '尝试' : '请求'}记录`)}</button></section>` : ''}
      <section><h3>请求集合</h3>${node.requestCoverage ? `<p class="muted">${esc(node.requestCoverage)}</p>` : ''}${node.kind !== 'fact' ? `<p class="muted">${esc({complete:'已取得本次范围完整集合',latest_only:'仅最新尝试',partial:'仅部分记录',not_provided:'本读模型未提供集合'}[node.requestCompleteness] ?? '集合完整性未提供')}</p>` : ''}${node.requests?.length ? node.requests.map(r => `<button data-request="${esc(r.id)}" data-owner="${esc(node.id)}"><span class="mono">${r.recordKind === 'attempt' ? '尝试 · ' : ''}${esc(r.id)}</span><br>${esc(text(r.status))}</button>`).join('') : `<p class="muted">${node.kind === 'fact' ? '来源事实，不推导本地执行结果。' : node.requestCompleteness === 'complete' ? '本次读取范围没有请求记录。' : '未取得请求记录。'}</p>`}</section>
      <section><h3>已保存成果</h3>${references(node.outputs, 'artifact')}</section><section><h3>准确输入</h3>${references(node.inputRefs, 'source')}</section>
      <section><h3>实际消费与待纳入</h3><div class="edge-list">${this._runtime.edges.filter(e => e.from === node.id || e.to === node.id).map(edge => `<div class="edge ${edge.status === 'pending' ? 'active' : ''}">${esc(edge.label)} · ${esc({consumed:'已消费',pending:'待纳入',unknown:'关系未知'}[edge.status] ?? edge.status)}<div class="mono">${esc((edge.refs ?? []).join(' → '))}</div></div>`).join('') || '<p class="muted">没有已记录关系</p>'}</div></section></aside>`;
  }
  drawEdges() {
    const graph = this.shadowRoot.querySelector('.graph');
    const svg = this.shadowRoot.querySelector('svg.links');
    if (!graph || !svg) return;
    const box = graph.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const buttons = [...graph.querySelectorAll('[data-node]')];
    const edges = (this._runtime?.edges ?? []).filter(e => !this._selected || e.from === this._selected || e.to === this._selected);
    svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>' + edges.map((edge,index) => {
      const from = buttons.find(n => n.dataset.node === edge.from)?.getBoundingClientRect();
      const to = buttons.find(n => n.dataset.node === edge.to)?.getBoundingClientRect();
      if (!from || !to) return '';
      let path;
      const offset = (index % 3 - 1) * 9;
      if (Math.abs(from.top - to.top) < 30) {
        const x1 = from.left + from.width / 2 + offset - box.left;
        const x2 = to.left + to.width / 2 + offset - box.left;
        const top = Math.min(from.top, to.top) - box.top - 15 - index % 3 * 5;
        path = `M ${x1} ${from.top-box.top} C ${x1} ${top}, ${x2} ${top}, ${x2} ${to.top-box.top}`;
      } else {
        const down = to.top > from.top;
        const x1 = from.left + from.width / 2 + offset - box.left, y1 = (down ? from.bottom : from.top) - box.top;
        const x2 = to.left + to.width / 2 + offset - box.left, y2 = (down ? to.top : to.bottom) - box.top;
        path = `M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`;
      }
      return `<path d="${path}" fill="none" stroke="${edge.status === 'consumed' ? 'var(--wl-muted,#666)' : 'var(--wl-amber-ink,#a3620f)'}" stroke-width="1.7" marker-end="url(#arrow)" ${edge.status !== 'consumed' ? 'stroke-dasharray="4 4"' : ''}/>`;
    }).join('');
  }
  verificationView() {
    return `<div class="tools" style="margin-bottom:14px"><label>导入验证快照 <input id="import" class="file" type="file" accept="application/json,.json"></label><span class="muted">只在当前页面读取文件</span></div>${this._error ? `<p class="error-message" role="alert">${esc(this._error)}</p>` : ''}${this._verification ? this.verificationContent(this._verification) : '<div class="empty">尚未载入验证快照</div>'}`;
  }
  items(data, category) {
    const names = { binding:'bindings',node:'nodes',edge:'edges',scenario:'scenarios' };
    return (category === 'binding' ? data.bindings : data.catalog?.[names[category]] ?? []).map(item => ({...item,itemKind:category,key:`${category}:${item.id}`}));
  }
  evidenceFor(data, item) {
    const field = {binding:'bindingIds',node:'nodeIds',edge:'edgeIds',scenario:'scenarioIds'}[item.itemKind];
    return (data.evidence ?? []).filter(record => (record[field] ?? []).includes(item.id));
  }
  isDemo(record) {
    if (record.mode === 'demo' || record.dataMode === 'demo') return true;
    const refs = [record.id,record.subjectRef,record.requestRef,record.reportRef,record.readbackRef,record.sourceRevision,record.environmentId,record.deploymentRef,
      ...(Array.isArray(record.inputRefs) ? record.inputRefs : []),...(Array.isArray(record.outputRefs) ? record.outputRefs : [])];
    return refs.some(ref => typeof ref === 'string' && ref.startsWith('demo:'));
  }
  requiresEnvironment(record) {
    return record.kind !== 'source_review' && !(record.kind === 'test' && ['unit','contract'].includes(record.testLevel));
  }
  matches(data, record) {
    const target = data.snapshot.target;
    return nonempty(target?.sourceRevision) && nonempty(data.snapshot.contract.sourceRevision)
      && nonempty(record.contractRevision) && nonempty(record.sourceRevision)
      && !this.isDemo(data.snapshot) && !this.isDemo(record)
      && record.contractRevision === data.snapshot.contract.sourceRevision
      && record.sourceRevision === target.sourceRevision
      && (!this.requiresEnvironment(record) || nonempty(target.environmentId) && nonempty(record.environmentId) && record.environmentId === target.environmentId);
  }
  selectedScenarios(data, item) {
    const related = new Set(item.itemKind === 'scenario' ? [item.id] : item.consistencyScenarioIds ?? []);
    const field = {node:'nodeIds',edge:'edgeIds',binding:'bindingIds'}[item.itemKind];
    if (field) (data.catalog.scenarios ?? []).filter(s => (s[field] ?? []).includes(item.id)).forEach(s => related.add(s.id));
    this.evidenceFor(data,item).filter(e => e.kind === 'test').forEach(e => (e.scenarioIds ?? []).forEach(id => related.add(id)));
    return (data.selection?.scenarioIds ?? []).filter(id => related.has(id));
  }
  sufficient(record, kind, item) {
    if (!nonempty(record.reportRef) || !isoTime(record.observedAt)) return false;
    if (kind === 'runtime') return [record.subjectRef,record.requestRef,record.readbackRef].every(nonempty)
      && [record.inputRefs,record.outputRefs].every(refs => Array.isArray(refs) && refs.length > 0 && refs.every(nonempty));
    if (kind === 'deployment') return nonempty(record.deploymentRef);
    if (kind === 'source_review' && item.itemKind === 'binding') return [item.sourceRevision,item.consumer,item.executionOwner,item.decisionEntry,item.projectionEntry,item.readEntry,item.authority?.requestRecord,item.authority?.artifactRecord,item.authority?.consumedInputField].every(nonempty)
      && item.sourceRevision === record.sourceRevision;
    return true;
  }
  verificationStatus(data, item, column) {
    const kind = {wiring:'source_review',tests:'test',deployment:'deployment',runtime:'runtime'}[column];
    let records = this.evidenceFor(data,item).filter(record => record.kind === kind);
    const selection = column === 'tests' ? this.selectedScenarios(data,item) : [];
    if (column === 'tests') {
      if (!selection.length) return '未选定相关场景';
      records = records.filter(record => (record.scenarioIds ?? []).some(id => selection.includes(id)));
    }
    if (!records.length) return column === 'tests' ? '未验证' : '未记录';
    if (!nonempty(data.snapshot.target?.sourceRevision)) return '源码目标未定 · 有历史证据';
    const current = records.filter(record => this.matches(data,record));
    if (!current.length) {
      if (records.some(record => !nonempty(record.contractRevision))) return '适用契约未核定';
      if (!nonempty(data.snapshot.target?.environmentId) && records.every(record => this.requiresEnvironment(record))) return '环境目标未定 · 有历史证据';
      return '历史 / 示例证据';
    }
    if (current.every(record => record.status === 'not_run')) return {deployment:'尚未部署',runtime:'尚未核对真实运行'}[column] ?? '尚未执行';
    if (current.some(record => record.status === 'failed')) return current.some(record => record.status === 'passed') ? '失败 / 通过并存' : '存在失败';
    const passed = current.filter(record => record.status === 'passed');
    if (!passed.length) return '证据未定论';
    if (passed.some(record => !this.sufficient(record,kind,item))) return '通过记录缺证据';
    if (column === 'tests' && !selection.every(id => passed.some(record => (record.scenarioIds ?? []).includes(id)))) return '所选场景部分覆盖';
    if (column === 'wiring') return '源码范围匹配 · 通过记录';
    if (column === 'tests' && passed.every(record => !this.requiresEnvironment(record))) return '测试范围匹配 · 通过记录';
    return '目标匹配 · 通过记录';
  }
  relatedBindings(data, item) {
    if (item.itemKind === 'binding') return [item];
    const field = {node:'nodeIds',edge:'edgeIds',scenario:'consistencyScenarioIds'}[item.itemKind];
    return data.bindings.filter(binding => (binding[field] ?? []).includes(item.id)
      || item.itemKind === 'scenario' && (binding.scenarioIds ?? []).includes(item.id)
      || (item.bindingIds ?? []).includes(binding.id));
  }
  relatedScenarioIds(data, item) {
    const ids = new Set(item.itemKind === 'scenario' ? [item.id] : [...(item.consistencyScenarioIds ?? []),...(item.scenarioIds ?? [])]);
    const field = {node:'nodeIds',edge:'edgeIds',binding:'bindingIds'}[item.itemKind];
    if (field) data.catalog.scenarios.filter(row => (row[field] ?? []).includes(item.id)).forEach(row => ids.add(row.id));
    this.relatedBindings(data,item).forEach(binding => {
      [...(binding.consistencyScenarioIds ?? []),...(binding.scenarioIds ?? [])].forEach(id => ids.add(id));
      data.catalog.scenarios.filter(row => (row.bindingIds ?? []).includes(binding.id)).forEach(row => ids.add(row.id));
    });
    return [...ids];
  }
  itemWorkPackages(data, item) {
    const bindings = this.relatedBindings(data,item);
    return (data.snapshot.workPackages ?? []).filter(pkg => bindings.some(binding =>
      (pkg.bindingIds ?? []).includes(binding.id) || (binding.workPackageIds ?? []).includes(pkg.id))
      || item.itemKind === 'scenario' && (pkg.scenarioIds ?? []).includes(item.id));
  }
  matchesVerificationFilters(data, item) {
    const bindings = this.relatedBindings(data,item);
    if (this._workPackage && !this.itemWorkPackages(data,item).some(pkg => pkg.id === this._workPackage)) return false;
    if (this._chain.startsWith('binding:') && !bindings.some(binding => binding.id === this._chain.slice(8))) return false;
    if (this._chain.startsWith('edge:')) {
      const edgeId = this._chain.slice(5);
      if (!(item.itemKind === 'edge' && item.id === edgeId) && !bindings.some(binding => (binding.edgeIds ?? []).includes(edgeId))) return false;
    }
    if (this._scenario && !this.relatedScenarioIds(data,item).includes(this._scenario)) return false;
    if (this._gap && !bindings.some(binding => (binding.gaps ?? []).some(gap => this._gap === 'any' || gap.kind === this._gap))) return false;
    return JSON.stringify([item,bindings,this.itemWorkPackages(data,item)]).toLowerCase().includes(this._verificationFilter.toLowerCase());
  }
  verificationEvidenceDetail(data, records) {
    return records.length ? records.map(record => `<article><p><strong>${esc(record.kind)} · ${esc(record.status)}</strong> · ${this.matches(data,record) ? '范围匹配；结果仍见独立证据列' : '历史 / 范围未匹配；不证明当前候选通过'}</p>
      ${nonempty(record.summary) ? `<p class="evidence-summary">${esc(record.summary)}</p>` : ''}
      <dl class="axes"><dt>观察时间</dt><dd>${esc(record.observedAt || '未记录')}</dd><dt>源码</dt><dd class="mono">${esc(record.sourceRevision || '未核定')}</dd><dt>环境</dt><dd>${esc(record.environmentId || '未记录；仅明确单元/契约测试可不要求环境')}</dd><dt>报告引用</dt><dd class="mono">${esc(record.reportRef || '未记录')}</dd></dl>
      <details><summary>完整证据 ${esc(record.id)}</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`).join('') : '<p class="muted">没有已导入证据；不表示已通过。</p>';
  }
  verificationBindingDetail(data, binding) {
    const labels = [['consumer','实际消费者'],['executionOwner','执行入口 / owner'],['decisionEntry','判定入口'],['projectionEntry','写入 / 投影入口'],['readEntry','读取入口'],['sourceRevision','绑定源码']];
    const packages = this.itemWorkPackages(data,{...binding,itemKind:'binding'});
    return `<section><h3>实际接线 · ${esc(binding.title ?? binding.label ?? binding.id)}</h3>
      <dl class="axes">${labels.map(([field,label]) => `<dt>${label}</dt><dd class="mono">${esc(binding[field] || '未记录')}</dd>`).join('')}</dl>
      <h3>未完成原因与下一动作</h3>${(binding.gaps ?? []).length ? binding.gaps.map(gap => `<div class="edge"><strong>${esc(gap.kind)} · ${esc(gap.id)}</strong><p>${esc(gap.reason)}</p><p>下一动作：${esc(gap.nextAction)}</p></div>`).join('') : '<p class="muted">未记录缺口说明；不能据此判断完成。</p>'}
      ${packages.map(pkg => `<p>工作包 ${esc(pkg.label)} · 下一动作：${esc(pkg.nextAction || '未记录')}</p>`).join('')}
      </section>`;
  }
  verificationContent(data) {
    const catalog = data.catalog;
    const items = this.items(data,this._category).filter(item => this.matchesVerificationFilters(data,item));
    const selected = items.find(item => item.key === this._binding) ?? items[0];
    const evidence = selected ? this.evidenceFor(data,selected) : [];
    const bindings = selected ? this.relatedBindings(data,selected) : [];
    const title = item => item.title ?? item.label ?? item.scenario ?? item.scope ?? item.id;
    const select = (id,label,value,options) => `<label>${label} <select id="${id}" aria-label="${label}"><option value="">全部</option>${options.map(([key,name]) => `<option value="${esc(key)}" ${value === key ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
    return `<div class="layout"><div class="panel main"><p class="hint">${esc(data.snapshot.contract.version)} · ${catalog.nodes.length} 节点 / ${catalog.edges.length} 关系 / ${catalog.scenarios.length} 场景<br>目标代码：<span class="mono">${esc(data.snapshot.target?.sourceRevision ?? '未指定')}</span><br>目标环境：${esc(data.snapshot.target?.environmentId ?? '未指定')}<br>快照生成时间：${esc(data.snapshot.generatedAt)}（不代替各证据观察时间） · 所选测试：${data.selection?.scenarioIds?.length ?? 0} 项</p>
      <div class="tabs">${[['binding','关键接线'],['node','能力节点'],['edge','关系模板'],['scenario','验收场景']].map(([category,label]) => `<button data-category="${category}" aria-pressed="${this._category === category}">${label} ${this.items(data,category).length}</button>`).join('')}</div>
      <div class="tools">
      ${select('work-package-filter','工作包',this._workPackage,(data.snapshot.workPackages ?? []).map(pkg => [pkg.id,pkg.label]))}
      ${select('chain-filter','链路 / 关系',this._chain,[...data.bindings.map(binding => [`binding:${binding.id}`,`接线 · ${title(binding)}`]),...catalog.edges.map(edge => [`edge:${edge.id}`,`关系 · ${title(edge)}`])])}
      ${select('scenario-filter','场景',this._scenario,catalog.scenarios.map(item => [item.id,`${item.id} · ${title(item)}`]))}
      ${select('gap-filter','缺口',this._gap,[['any','有记录的缺口'],['source_review','源码接线'],['test','测试'],['deployment','部署'],['runtime','运行']])}
      </div><input id="verification-filter" class="filter" aria-label="筛选契约项目" placeholder="按编号、名称、接线或缺口内容筛选" value="${esc(this._verificationFilter)}">
      <div class="tablewrap"><table><thead><tr><th>契约项目</th><th>接线</th><th>测试</th><th>部署</th><th>运行</th></tr></thead><tbody>${items.map(item => `<tr class="${selected?.key === item.key ? 'selected' : ''}"><td><button data-item="${esc(item.key)}">${esc(title(item))}<br><span class="mono">${esc(item.id)}</span></button></td>${['wiring','tests','deployment','runtime'].map(column => `<td>${esc(this.verificationStatus(data,item,column))}</td>`).join('')}</tr>`).join('')}</tbody></table>${items.length ? '' : '<p class="hint">没有匹配项目。</p>'}</div>
      <p class="hint">四列分别读取证据；筛选只改变显示，不修改 selection 或测试分母。缺口来自已记录说明，不自动推断完成。</p></div>
      <aside class="panel detail"><h3>${selected ? esc(title(selected)) : '选择契约项目'}</h3>${selected ? `
      ${selected.itemKind === 'binding' ? this.verificationBindingDetail(data,selected) : `<section><h3>关联实际接线 · ${bindings.length} 项</h3>${bindings.length ? bindings.map(binding => `<button data-binding-detail="${esc(binding.id)}">查看接线 · ${esc(title(binding))}<br><span class="mono">${esc(binding.id)}</span></button>`).join('') : '<p class="muted">未记录精确 binding 关联，不推断接通。</p>'}</section>`}
      <section><h3>直接关联证据 · ${evidence.length} 项</h3>${this.verificationEvidenceDetail(data,evidence)}</section>
      <details><summary>契约 / 接线完整定义</summary><pre>${esc(JSON.stringify(selected,null,2))}</pre></details>` : ''}</aside></div>`;
  }
  validateRuntime(data) {
    if (!object(data) || data.schemaVersion !== 1 || !object(data.meta) || !object(data.scope)) throw Error('运行投影格式不匹配');
    const meta = data.meta;
    if (!['demo','snapshot','live'].includes(meta.mode) || !isoTime(meta.observedAt)
      || ![meta.environment,meta.scopeKey,data.scope.id,data.scope.label,data.scope.model].every(nonempty)) throw Error('运行投影缺少准确范围或读取时间');
    if (data.scope.kind !== undefined && !['work_item','matter','document'].includes(data.scope.kind)) throw Error('观察对象类型无效');
    if (meta.readState !== undefined && !['current','refreshing','failed','stale'].includes(meta.readState)) throw Error('读取状态无效');
    if (meta.readError != null && typeof meta.readError !== 'string') throw Error('读取错误说明必须为文本');
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw Error('运行节点与关系必须为数组');
    const ids = new Set(), references = [meta.scopeKey,data.scope.id];
    const axis = value => nonempty(value) || object(value) && [value.label,value.status].some(nonempty)
      && (value.tone === undefined || ['good','wait','error'].includes(value.tone));
    const refList = (values,name) => {
      if (!Array.isArray(values) || values.some(v => !object(v) || !nonempty(v.label) || !nonempty(v.ref))) throw Error(`${name} 必须为有效引用数组`);
      values.forEach(v => references.push(v.ref));
    };
    data.nodes.forEach(node => {
      if (!object(node) || !nonempty(node.id) || ids.has(node.id) || !nonempty(node.label)) throw Error('运行节点缺少唯一身份');
      ids.add(node.id); references.push(node.id);
      if (!['来源','阅读交付','工程工作','公司与机队事实','知识积累'].includes(node.group) || !['task','fact','view','action'].includes(node.kind)
        || ![node.execution,node.artifact,node.coverage,node.business].every(axis) || typeof node.summary !== 'string') throw Error(`节点 ${node.id} 的显示字段无效`);
      if (node.requestCompleteness !== undefined && !['complete','latest_only','partial','not_provided'].includes(node.requestCompleteness)) throw Error(`节点 ${node.id} 的集合完整性无效`);
      for (const field of ['coverageScope','requestCoverage']) if (node[field] !== undefined && typeof node[field] !== 'string') throw Error(`节点 ${node.id} 的 ${field} 必须为文本`);
      if (node.sourceObservedAt !== undefined && !isoTime(node.sourceObservedAt)) throw Error(`节点 ${node.id} 的来源时间无效`);
      refList(node.outputs,`${node.id}.outputs`); refList(node.inputRefs,`${node.id}.inputRefs`);
      if (!Array.isArray(node.requests)) throw Error(`节点 ${node.id} 缺少请求观察数组`);
      const requestIds = new Set();
      node.requests.forEach(record => {
        if (!object(record) || !nonempty(record.id) || requestIds.has(record.id) || !axis(record.status)) throw Error(`节点 ${node.id} 的请求观察无效`);
        requestIds.add(record.id); references.push(record.id);
        if (record.recordKind !== undefined && !['request','attempt'].includes(record.recordKind)) throw Error(`记录 ${record.id} 的身份类型无效`);
        for (const field of ['artifact','next','owner','waitingReason','subjectRef','subjectLabel','targetLabel']) {
          if (record[field] !== undefined && typeof record[field] !== 'string') throw Error(`记录 ${record.id} 的 ${field} 必须为文本`);
        }
        for (const field of ['createdAt','firstSavedAt','completedAt','queuedAt','startedAt','lastProgressAt']) if (record[field] !== undefined && !isoTime(record[field])) throw Error(`记录 ${record.id} 的 ${field} 无效`);
        if (record.subjectRef) references.push(record.subjectRef);
        if (record.owner) references.push(record.owner);
      });
    });
    const edgeIds = new Set();
    data.edges.forEach(edge => {
      if (!object(edge) || !nonempty(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to)
        || !['consumed','pending','unknown'].includes(edge.status) || !nonempty(edge.label)
        || !Array.isArray(edge.refs) || edge.refs.some(ref => !nonempty(ref))) throw Error('运行关系身份、端点或引用无效');
      edgeIds.add(edge.id); references.push(edge.id,...edge.refs);
    });
    if (data.resources !== undefined) {
      if (!object(data.resources) || !nonempty(data.resources.scope) || !Array.isArray(data.resources.items)
        || data.resources.items.some(item => !object(item) || !nonempty(item.label) || typeof item.detail !== 'string'
          || !(item.value === null || typeof item.value === 'string' || typeof item.value === 'number' && Number.isFinite(item.value)))) throw Error('环境资源观察无效');
      references.push(data.resources.scope);
    }
    if (meta.mode !== 'demo' && references.some(ref => ref.startsWith('demo:'))) throw Error('示例引用必须保持 demo 模式');
    return data;
  }
  validateVerification(data) {
    if (!object(data) || data.formatVersion !== 1 || !object(data.snapshot) || !object(data.snapshot.contract) || !object(data.snapshot.target) || !object(data.catalog) || !object(data.selection)) throw Error('快照格式不匹配');
    const snapshot = data.snapshot, contract = snapshot.contract;
    if (![contract.version,contract.source].every(nonempty) || contract.sourceRevisionType !== 'sha256'
      || typeof contract.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(contract.sourceRevision)) throw Error('快照缺少有效契约身份或 SHA256 指纹');
    if (!['snapshot','demo'].includes(snapshot.dataMode) || !isoTime(snapshot.generatedAt)
      || snapshot.mode !== undefined && !['snapshot','demo'].includes(snapshot.mode)) throw Error('验证快照模式或生成时间无效');
    for (const field of ['sourceRevision','environmentId']) if (snapshot.target[field] !== null && !nonempty(snapshot.target[field])) throw Error(`比较目标 ${field} 必须为非空字符串或 null`);
    for (const field of ['changedNodeIds','changedEdgeIds','scenarioIds']) if (!Array.isArray(data.selection[field])) throw Error(`selection.${field} 必须为数组`);
    if (typeof data.selection.reason !== 'string') throw Error('selection.reason 必须为文本');
    if (Object.keys(data.selection).some(key => !['changedNodeIds','changedEdgeIds','scenarioIds','reason'].includes(key))) throw Error('selection 包含未知字段');
    const indexes = {};
    for (const category of ['nodes','edges','scenarios','rules','bindings','evidence']) {
      const rows = ['bindings','evidence'].includes(category) ? data[category] : data.catalog[category];
      if (!Array.isArray(rows)) throw Error(`${category} 必须为数组`);
      if (!['bindings','evidence'].includes(category) && !rows.length) throw Error(`${category} 目录不能为空`);
      const set = new Set();
      for (const row of rows) {
        if (!object(row) || typeof row.id !== 'string' || !row.id.trim()) throw Error(`${category} 缺少有效 ID`);
        if (set.has(row.id)) throw Error(`${category} 存在重复 ID：${row.id}`);
        set.add(row.id);
      }
      indexes[category] = set;
    }
    const packages = snapshot.workPackages ?? [];
    if (!Array.isArray(packages)) throw Error('snapshot.workPackages 必须为数组');
    indexes.workPackages = new Set();
    packages.forEach(pkg => {
      if (!object(pkg) || !nonempty(pkg.id) || !nonempty(pkg.label) || indexes.workPackages.has(pkg.id)) throw Error('工作包缺少唯一 ID 或名称');
      indexes.workPackages.add(pkg.id);
      if (pkg.nextAction !== undefined && !nonempty(pkg.nextAction)) throw Error(`工作包 ${pkg.id} 的下一动作无效`);
    });
    data.bindings.forEach(binding => {
      if (binding.gaps === undefined) return;
      if (!Array.isArray(binding.gaps)) throw Error(`接线 ${binding.id} 的 gaps 必须为数组`);
      const ids = new Set();
      binding.gaps.forEach(gap => {
        if (!object(gap) || ![gap.id,gap.reason,gap.nextAction].every(nonempty) || ids.has(gap.id)
          || !['source_review','test','deployment','runtime'].includes(gap.kind)) throw Error(`接线 ${binding.id} 的缺口格式无效`);
        ids.add(gap.id);
      });
    });
    const fields = {workPackageIds:'workPackages',nodeIds:'nodes',changedNodeIds:'nodes',edgeIds:'edges',changedEdgeIds:'edges',scenarioIds:'scenarios',consistencyScenarioIds:'scenarios',ruleIds:'rules',bindingIds:'bindings'};
    const visit = value => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!object(value)) return;
      for (const [key,item] of Object.entries(value)) {
        if (fields[key]) {
          if (!Array.isArray(item) || item.some(id => typeof id !== 'string' || !indexes[fields[key]].has(id))) throw Error(`${key} 包含无效或悬空引用`);
        }
        if (key.endsWith('At') && item !== null && item !== '' && !isoTime(item)) throw Error(`${key} 需要含时区的有效时间`);
        visit(item);
      }
    };
    visit(data);
    const ports = new Set(['input.sources','input.tdms_documents','input.target_facts','input.references','input.engineer','input.business_records','input.lcm_configuration','input.policy','control.execution','control.authorization']);
    data.catalog.edges.forEach(edge => (String(edge.endpointTemplate ?? '').match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g) ?? []).forEach(ref => { if (!indexes.nodes.has(ref) && !ports.has(ref)) throw Error(`关系 ${edge.id} 存在悬空端点：${ref}`); }));
    data.evidence.forEach(record => {
      if (!['source_review','test','deployment','runtime'].includes(record.kind) || !['not_run','passed','failed','inconclusive','not_applicable'].includes(record.status)) throw Error(`证据 ${record.id} 类型或状态无效`);
      for (const field of ['summary','contractRevision','sourceRevision','environmentId','reportRef','deploymentRef','subjectRef','requestRef','readbackRef','observedAt']) {
        if (record[field] != null && typeof record[field] !== 'string') throw Error(`证据 ${record.id} 的 ${field} 必须为文本或空值`);
      }
      if (record.testLevel != null && record.testLevel !== '' && !['unit','contract','integration','e2e'].includes(record.testLevel)) throw Error(`证据 ${record.id} 的 testLevel 无效`);
      for (const field of ['inputRefs','outputRefs']) if (record[field] != null && (!Array.isArray(record[field]) || record[field].some(ref => !nonempty(ref)))) throw Error(`证据 ${record.id} 的 ${field} 必须为引用数组`);
    });
    return data;
  }
  async importFile(file) {
    if (!file) return;
    const generation = ++this._importGeneration;
    try {
      if (file.size > 5000000) throw Error('文件过大，请使用 5 MB 以内的快照');
      const data = JSON.parse(await file.text());
      if (generation !== this._importGeneration) return;
      if (object(data?.snapshot)) {
        const mode = this.isDemo(data.snapshot) ? 'demo' : 'snapshot';
        data.snapshot = {...data.snapshot,mode,dataMode:mode};
      }
      this.updateInputs({verification:data});
    } catch (error) {
      if (generation !== this._importGeneration) return;
      this._error = error.message ?? '无法读取快照'; this.render();
    }
  }
}
if (!customElements.get('wiselink-monitor')) customElements.define('wiselink-monitor', WiseLinkMonitor);
})();
