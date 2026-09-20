import cytoscape from 'cytoscape';
import htmlLabel from 'cytoscape-node-html-label';
import {WL_ASSETS} from './assets';
import {icon,esc} from './icons';
if (!cytoscape('core','nodeHtmlLabel')) htmlLabel(cytoscape);
const TONES={blue:'#6e9bdc',green:'#59b7a4',amber:'#d6ae65',rose:'#d99096',teal:'#64b6c0',purple:'#b39add'};
const KINDS={document:'file',record:'record',plane:'plane',chapter:'chapter',component:'component',topic:'topic',question:'question',work:'work',event:'activity',discussion:'discussion',configuration:'configuration'};
function nodeTemplate(d){
 const tone=Object.prototype.hasOwnProperty.call(TONES,d.color)?d.color:'blue';
 const attrs=`style="--w:${Number(d.w)}px;--h:${Number(d.h)}px" data-graph-id="${esc(d.id)}"`;
 const classes=`graph-node tone-${tone} ${d.selected?'selected':''} ${d.faded?'faded':''}`;
 if(d.viewKind==='halo')return `<div class="${classes} cluster-halo" ${attrs}><div class="cluster-heading">${esc(d.title)} <small>${d.count}</small></div></div>`;
 if(d.viewKind==='hub')return `<div class="${classes} matter-hub" ${attrs}><div class="hub-portrait">${d.picture?`<img alt="" src="${WL_ASSETS[d.picture]}">`:icon(d.icon||'graph')}</div><strong>${esc(d.title)}</strong><small>${esc(d.code)}</small><div class="hub-sub">工程事项 · 持续认识</div></div>`;
 if(d.viewKind==='more')return `<div class="${classes} node-card node-more" ${attrs}>${icon('more')} 另有 ${d.count} 项 · 展开全部</div>`;
 return `<div class="${classes} node-card ${d.compact?'compact':''} ${d.isNew?'node-new':''}" ${attrs}>${d.picture?`<img alt="" src="${WL_ASSETS[d.picture]}">`:`<span class="node-icon">${icon(KINDS[d.kind]||'file')}</span>`}<div class="node-copy"><strong>${esc(d.title)}</strong><small>${esc(d.subtitle)}</small></div></div>`;
}
function buildPresentation(matter,hidden=[],density=4){
 const groups=matter.groups.filter(g=>g.items.length&&!hidden.includes(g.key));
 if(groups.length>6)throw new Error('分组阅读图一次显示最多六组，请从分类列表选择范围');
 const layoutProfiles={
  1:[[702,326]],2:[[128,324],[702,324]],3:[[414,104],[128,465],[702,465]],
  4:[[128,168],[702,168],[128,486],[702,486]],
  5:[[128,176],[414,107],[702,176],[244,508],[626,508]],
  6:[[128,168],[414,108],[702,168],[128,464],[414,550],[702,477]]
 };
 const coords=layoutProfiles[groups.length]||layoutProfiles[6];
 const elements=[],items=[],views=[],businessEdges=[];let displayed=0;
 groups.slice(0,6).forEach((g,i)=>{
  const column=g.columns||1,w=column===2?258:236,cardW=column===2?118:216;
  const cap=column===2?6:density,shown=g.items.slice(0,cap),extra=g.items.length-shown.length;
  const cardH=column===2?57:(g.key==='objects'?60:54),gap=8;
  const rows=Math.ceil(shown.length/column),h=36+rows*cardH+Math.max(0,rows-1)*gap+(extra?38:0)+10;
  const [x,y]=coords[i],top=y-h/2;
  views.push({key:g.key,id:'@group/'+g.key,x,y,w,h,count:g.items.length,visible:shown.length,title:g.title,color:g.color});
  elements.push({group:'nodes',data:{id:'@group/'+g.key,viewKind:'halo',title:g.title,color:g.color,w,h,count:g.items.length,groupKey:g.key},position:{x,y},classes:'visual-group',grabbable:false,selectable:false});
  shown.forEach((n,index)=>{
   const cx=column===2?x+(index%2?64:-64):x,cy=top+36+cardH/2+Math.floor(index/column)*(cardH+gap);
   const data={...n,viewKind:'item',groupKey:g.key,color:g.color,w:cardW,h:cardH,compact:column===2};
   elements.push({group:'nodes',data,position:{x:cx,y:cy},classes:'business-node',grabbable:true});items.push(data);displayed++;
  });
  if(extra){elements.push({group:'nodes',data:{id:'@more/'+g.key,viewKind:'more',title:'展开全部',color:g.color,w:cardW,h:32,count:extra,groupKey:g.key},position:{x,y:top+h-27},classes:'visual-more',grabbable:false,selectable:false});}
 });
 elements.push({group:'nodes',data:{id:matter.id,viewKind:'hub',title:matter.title,code:matter.code,icon:matter.id==='gear'?'gear':'graph',picture:matter.picture,w:180,h:180,color:'blue'},position:{x:414,y:329},classes:'matter-root',grabbable:false});
 const shownIds=new Set([matter.id,...items.map(i=>i.id)]);
 for(const e of matter.relations){if(shownIds.has(e.source)&&shownIds.has(e.target)){
  businessEdges.push(e);elements.push({group:'edges',data:{...e,viewKind:'relationship',color:TONES[matter.groups.find(g=>g.key===e.group)?.color||'blue'],curvature:e.source===matter.id?0:33},classes:'business-edge'});
 }}
 for(const v of views){
  const g=groups.find(g=>g.key===v.key),ids=new Set(g.items.map(n=>n.id)),bundled=matter.relations.filter(e=>e.source===matter.id&&ids.has(e.target));
  if(!bundled.length)continue;
  elements.push({group:'edges',data:{id:'@bundle/'+v.key,source:matter.id,target:v.id,viewKind:'bundle',label:new Set(bundled.map(e=>e.kind)).size>1?'资料关联':g.relation,color:TONES[g.color],relationshipIds:bundled.map(e=>e.id),groupKey:g.key,curvature:v.x<414?-22:v.x>414?22:0},classes:'bundle-edge'});
 }
 return {elements,groups:views,visibleItems:items,businessEdges,counts:{objects:matter.groups.reduce((n,g)=>n+g.items.length,0),shown:displayed,groups:groups.length,relationships:matter.relations.length},bounds:{x1:-4,y1:0,x2:836,y2:650,w:840,h:650}};
}
function createMatterGraph(container,options={}){
 const cy=cytoscape({container,elements:[],pixelRatio:Math.min(window.devicePixelRatio||1,2),minZoom:.16,maxZoom:2.4,wheelSensitivity:.19,boxSelectionEnabled:false,selectionType:'single',layout:{name:'preset',fit:false},style:[
  {selector:'node',style:{'background-opacity':0,'border-width':0,'width':'data(w)','height':'data(h)','label':'','shape':'round-rectangle','overlay-opacity':0}},
  {selector:'.matter-root',style:{shape:'ellipse'}},
  {selector:'.visual-group',style:{shape:'ellipse','events':'yes','z-index':0}},
  {selector:'.business-node',style:{'z-index':10}},
  {selector:'edge',style:{width:1.25,'curve-style':'unbundled-bezier','control-point-distances':'data(curvature)','control-point-weights':.5,'line-color':'data(color)','target-arrow-color':'data(color)','target-arrow-shape':'triangle','arrow-scale':.65,opacity:.62,'font-size':12,'color':'#7b8fa3','font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif','text-background-color':'#ffffff','text-background-opacity':.88,'text-background-padding':3,'text-rotation':'none','text-margin-y':-5,label:'data(label)','overlay-opacity':0}},
  {selector:'.business-edge',style:{display:'none',width:1,opacity:.28,'font-size':10}},
  {selector:'.bundle-edge',style:{width:1.3,opacity:.68,'z-index':1}},
  {selector:'.focus-edge',style:{display:'element',width:2,opacity:.9,'z-index':20}},
  {selector:'.dimmed-edge',style:{opacity:.10}}
 ]});
 cy.nodeHtmlLabel([{query:'node',halign:'center',valign:'center',halignBox:'center',valignBox:'center',cssClass:'cy-label',tpl:nodeTemplate}],{enablePointerEvents:false});
 let presentation=null,matter=null,selectedId=null,allEdges=false,destroyed=false,initial=true,resizeFrame=0,perf={updates:0};
 function fit(){if(!presentation)return;const bb=presentation.bounds;cy.fit(bb,16);}
 function resize(){if(destroyed)return;cy.resize();if(initial)fit();options.onViewport?.(cy.zoom());}
 const ro=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize)});ro.observe(container);
 function setTheme(theme){cy.style().selector('edge').style({'text-background-color':theme==='dark'?'#22252a':'#ffffff','color':theme==='dark'?'#a9b6c8':'#7b8fa3'}).update();}
 function update(next,{hidden=[],density=4,animate=true}={}){
  const start=performance.now(),same=matter?.id===next.id;matter=next;const p=buildPresentation(next,hidden,density);presentation=p;
  const fresh=new Map(p.elements.map(e=>[e.data.id,e]));
  cy.batch(()=>{
   cy.elements().filter(e=>!fresh.has(e.id())).remove();
   for(const def of p.elements){const existing=cy.getElementById(def.data.id);
    if(existing.length){const oldSelected=existing.data('selected');existing.data({...def.data,selected:oldSelected});}
    else cy.add(def);
   }
  });
  const positions=Object.fromEntries(p.elements.filter(e=>e.group==='nodes').map(e=>[e.data.id,e.position]));
  const allow=animate&&!initial&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&container.closest('.wl-studio')?.dataset.motion!=='off'&&container.closest('.wl-studio')?.dataset.effects!=='compatible';
  cy.layout({name:'preset',positions,fit:false,animate:allow,animationDuration:400,animationEasing:'ease-in-out-cubic'}).run();
  if(!same){selectedId=null;fit();}else if(initial)fit();
  toggleEdges(allEdges);initial=false;perf.updates++;perf.lastUpdateMs=performance.now()-start;
  requestAnimationFrame(()=>{if(!destroyed){if(!same)fit();options.onReady?.(p);}});
  return p;
 }
 function select(id,{notify=true}={}){
  const n=cy.getElementById(id);if(!n.length)return false;
  if(n.isEdge()){options.onSelect?.(n.data(),true);return true;}
  if(n.data('viewKind')==='more'||n.data('viewKind')==='halo'){options.onGroup?.(n.data('groupKey'));return true;}
  selectedId=id;cy.batch(()=>{
   cy.nodes().forEach(x=>x.data('selected',x.id()===id));
   cy.edges().removeClass('focus-edge dimmed-edge');
   if(id!==matter.id){cy.edges('.bundle-edge').addClass('dimmed-edge');n.connectedEdges('.business-edge').addClass('focus-edge');}
  });if(notify)options.onSelect?.(n.data(),false);return true;
 }
 function selectFromOutside(id){
  const n=cy.getElementById(id);if(n.length){select(id);return;}
  const g=matter.groups.find(g=>g.items.some(n=>n.id===id));
  if(g)options.onHiddenSelect?.(g.key,id);
 }
 function toggleEdges(value){allEdges=Boolean(value);cy.style().selector('.business-edge').style('display',allEdges?'element':'none').selector('.bundle-edge').style('display',allEdges?'none':'element').update();if(selectedId)select(selectedId,{notify:false});}
 function setSearch(value){const q=value.trim().toLowerCase();cy.batch(()=>{cy.nodes().forEach(n=>{if(n.data('viewKind')!=='item')return;n.data('faded',Boolean(q&&!`${n.data('title')} ${n.data('subtitle')}`.toLowerCase().includes(q)));});});}
 function zoomBy(factor){cy.zoom({level:cy.zoom()*factor,renderedPosition:{x:container.clientWidth/2,y:container.clientHeight/2}});}
 function recalcGroup(g){
  const nodes=cy.nodes('.business-node').filter(n=>n.data('groupKey')===g),holder=cy.getElementById('@group/'+g);if(!nodes.length||!holder.length)return;
  const bb=nodes.boundingBox({includeLabels:false,includeOverlays:false}),extra=cy.getElementById('@more/'+g);if(extra.length)return; // a fixed overflow window remains fixed; reset restores manual exploration.
  holder.data({w:bb.w+30,h:bb.h+57});holder.position({x:(bb.x1+bb.x2)/2,y:(bb.y1+bb.y2)/2-17});
 }
 cy.on('tap','node,edge',e=>select(e.target.id()));
 cy.on('tap',e=>{if(e.target===cy&&matter)select(matter.id);});
 cy.on('dragfree','.business-node',e=>recalcGroup(e.target.data('groupKey')));
 cy.on('pan zoom',()=>options.onViewport?.(cy.zoom()));
 return {cy,update,select:selectFromOutside,fit,resize,setTheme,toggleEdges,setSearch,zoomBy,get presentation(){return presentation},get stats(){return {...perf,cyNodes:cy.nodes().length,cyEdges:cy.edges().length,labels:container.querySelectorAll('.graph-node').length}},destroy(){destroyed=true;ro.disconnect();cancelAnimationFrame(resizeFrame);cy.destroy();container.replaceChildren();}};
}

export {createMatterGraph, buildPresentation};
