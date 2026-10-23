"""Generate the existing offline verification HTML from canonical records/component."""
import argparse
from build_verification import validate
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build(snapshot_path, output_path, component_path):
    js=Path(component_path).read_text(encoding='utf-8')
    graph_path=ROOT.parents[1]/'client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-contract-graph.js'
    js=graph_path.read_text(encoding='utf-8')+'\n'+js
    verification=json.loads(Path(snapshot_path).read_text(encoding='utf-8'))
    validate(verification)
    for filename,is_verification in [(str(output_path),True)]:
        payload=json.dumps(verification,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
        controls=''
        setup="""const graph=document.querySelector('wiselink-contract-graph');
m.addEventListener('wiselink-verification-change',e=>{
  graph.verification=e.detail.error?null:e.detail.verification;
  document.querySelector('#notice').textContent=e.detail.error?'图已隐藏：新快照无效，请检查导入记录。':'';
});
graph.addEventListener('wiselink-contract-select',e=>m.focusVerification(e.detail.category,e.detail.id));
m.updateInputs({allowVerification:true,verification:data,view:'verification'});"""
        page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WiseLink · TITLE</title><style>
:root{--wl-bg:#dedede;--wl-sheet:#fff;--wl-sheet-muted:#f7f7f7;--wl-ink:#242424;--wl-muted:#666;--wl-border:rgba(0,0,0,.1);--wl-border-strong:rgba(0,0,0,.17);--wl-accent:#242424;--wl-selected:#e8e8e8;--wl-green:#25b86b;--wl-amber:#f2a23a;--wl-amber-ink:#a3620f;--wl-red:#e85a62;--wl-font-sans:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}html[data-wl-theme=dark]{--wl-bg:#101010;--wl-sheet:#252525;--wl-sheet-muted:#2b2b2b;--wl-ink:#ececec;--wl-muted:#aeaeae;--wl-border:rgba(255,255,255,.09);--wl-border-strong:rgba(255,255,255,.15);--wl-accent:#eee;--wl-selected:#393939;--wl-amber-ink:#f2a23a}*{box-sizing:border-box}body{margin:0;background:var(--wl-bg);color:var(--wl-ink);font:14px/1.6 var(--wl-font-sans)}main{max-width:1440px;margin:24px auto;padding:0 24px}.preview-tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;font-size:12px;color:var(--wl-muted)}button,select{font:inherit;padding:7px 10px;border:1px solid var(--wl-border);border-radius:8px;color:var(--wl-ink);background:var(--wl-sheet);cursor:pointer}.preview-label{letter-spacing:.1em}dialog{max-width:min(540px,90vw);border:1px solid var(--wl-border);border-radius:14px;background:var(--wl-sheet);color:var(--wl-ink);padding:24px}dialog::backdrop{background:#0005}dialog pre{white-space:pre-wrap;overflow-wrap:anywhere}#notice{font-size:12px;color:var(--wl-muted);min-height:24px}@media(max-width:600px){main{padding:0 12px;margin:16px auto}}
</style><main><div class="preview-tools"><span class="preview-label">WISELINK / 主线进展 · 本地快照</span><div>CONTROLS <button id="theme">切换明暗</button></div></div><div id="notice" role="status"></div><wiselink-contract-graph></wiselink-contract-graph><wiselink-monitor></wiselink-monitor></main><dialog id="info"><h3>本地记录详情</h3><p>只查看已导入的证据引用；页面不触发业务操作。</p><pre id="detail"></pre><button id="close">关闭</button></dialog><script>JS</script><script>const data=PAYLOAD;const m=document.querySelector('wiselink-monitor');SETUP
document.querySelector('#theme').onclick=()=>{document.documentElement.dataset.wlTheme=document.documentElement.dataset.wlTheme==='dark'?'light':'dark'};m.addEventListener('wiselink-refresh',()=>{document.querySelector('#notice').textContent='已发出只读刷新事件；此离线预览没有连接 Host，观察时间保持不变。'});m.addEventListener('wiselink-navigate',e=>{document.querySelector('#detail').textContent=JSON.stringify(e.detail,null,2);document.querySelector('#info').showModal()});document.querySelector('#close').onclick=()=>document.querySelector('#info').close();</script></html>'''
        # Replace template markers before inserting arbitrary record text or code.
        page=page.replace('TITLE','主线进展与开发指引',1).replace('CONTROLS',controls,1).replace('SETUP',setup,1).replace('PAYLOAD',payload,1).replace('<script>JS</script>','<script>'+js+'</script>',1)
        Path(filename).write_text(page,encoding='utf-8')
        print(filename)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--component', default=str(ROOT.parents[1]/'client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-monitor.js'))
    args=parser.parse_args()
    build(args.snapshot, args.output, args.component)

