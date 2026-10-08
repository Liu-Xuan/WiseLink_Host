import type { CanonicalLibraryGraphResponse, LibraryGraphCluster, LibraryGraphFamily, LibraryGraphVersion } from '@shared/library-graph.interface';
import type { CytoscapeSuiteElement, SuiteGraphPresentation } from './suite-graph-model';
export type LibraryGraphItem = LibraryGraphCluster | LibraryGraphFamily | LibraryGraphVersion;
export function libraryGraphItemId(item:LibraryGraphItem):string {
  return item.kind === 'CLASSIFICATION' ? `library:cluster:${JSON.stringify(item.value)}`
    : item.kind === 'FAMILY' ? `library:family:${item.familyId}` : `library:version:${item.documentVersionId}`;
}
export function libraryClusterLabel(value:string|null, groupBy:'ata'|'normalizedFamily'):string {
  return value === null ? (groupBy === 'ata' ? '未标注 ATA' : '未标注资料类别')
    : value === '' ? '空分类值' : groupBy === 'ata' ? `ATA ${value}` : value;
}
export function libraryGraphItemLabel(item:LibraryGraphItem,groupBy:'ata'|'normalizedFamily'='ata'):string {
  return item.kind === 'CLASSIFICATION' ? libraryClusterLabel(item.value,groupBy)
    : item.kind === 'FAMILY' ? item.documentCode || item.familyId : item.businessRevision || '未提供版次';
}
const compact = (label:string,max=22) => label.length <= max ? label : `${label.slice(0,max-1)}…`;
/** Native points and display containment only. Never pairwise-link shared classifications. */
export function buildLibraryGraphPresentation(page:CanonicalLibraryGraphResponse):SuiteGraphPresentation {
  if (page.items.length > 50) throw new Error('LIBRARY_GRAPH_PAGE_UNBOUNDED');
  const elements:CytoscapeSuiteElement[] = [];
  const groupBy = page.level === 'versions' ? 'ata' : page.groupBy;
  const anchor = page.level === 'clusters' ? null : page.level === 'families'
    ? `library:anchor:cluster:${JSON.stringify(page.clusterValue)}` : `library:anchor:family:${page.familyId}`;
  if (anchor && page.items.length) elements.push({group:'nodes',classes:'macro-point macro-anchor',position:{x:0,y:0},
    data:{id:anchor,viewKind:'point',nativePoint:true,w:46,h:46,tone:'neutral',title:page.level === 'families'
      ? libraryClusterLabel(page.clusterValue,page.groupBy) : '所选文档族',macroLabel:page.level === 'families'
      ? compact(libraryClusterLabel(page.clusterValue,page.groupBy)) : '所选文档族'}});
  page.items.forEach((item,index) => {
    const id = libraryGraphItemId(item);
    const label = libraryGraphItemLabel(item,groupBy);
    const count = item.kind === 'CLASSIFICATION' ? item.uniqueFamilyCount : item.kind === 'FAMILY' ? item.readableVersionCount : 1;
    const size = item.kind === 'CLASSIFICATION' ? Math.min(64,28 + Math.log2(count+1)*3) : 22;
    // Stable compact separated clusters. A selected level replaces the preceding page.
    const columns = Math.min(8,Math.max(1,Math.ceil(Math.sqrt(page.items.length*1.4))));
    const row = Math.floor(index/columns), column = index%columns;
    const rows = Math.ceil(page.items.length/columns);
    const position = anchor
      ? {x:((column-(columns-1)/2)*150),y:110+row*112}
      : {x:(column-(columns-1)/2)*150 + (row%2)*28,y:(row-(rows-1)/2)*116};
    const subtitle = item.kind === 'CLASSIFICATION' ? `${item.uniqueFamilyCount} 族 · ${item.readableVersionCountInMatchingFamilies} 版`
      : item.kind === 'FAMILY' ? `${item.readableVersionCount} 可读版本` : item.isCurrent ? 'Host 当前登记版本' : '其他已登记版本';
    elements.push({group:'nodes',classes:'macro-point',position,
      data:{id,businessId:id,nativePoint:true,viewKind:'point',w:size,h:size,tone:item.kind === 'CLASSIFICATION' ? 'teal'
        : item.kind === 'FAMILY' ? 'blue' : item.isCurrent ? 'green' : 'neutral',title:label,subtitle,
        macroLabel:`${compact(label)}\n${subtitle}`}});
    if (anchor) elements.push({group:'edges',classes:'display-edge macro-containment',data:{id:`library:contains:${id}`,source:anchor,target:id,
      viewKind:'display',label:'',curvature:0,tone:'neutral',relationMeaning:'CLASSIFICATION_AND_CONTAINMENT_ONLY'}});
  });
  const ids = page.items.map(libraryGraphItemId);
  const connections = anchor && page.items.length ? page.items.length : 0;
  const points = elements.filter(e => e.group === 'nodes');
  const xs = points.map(e => e.position.x), ys = points.map(e => e.position.y);
  const x1 = Math.min(0,...xs)-70, x2=Math.max(0,...xs)+70,y1=Math.min(0,...ys)-60,y2=Math.max(0,...ys)+95;
  return {elements,groups:[],visibleIds:ids,visibleItemIds:ids,
    overflow:{page:0,pageSize:50,totalGroups:0,displayedGroups:0,omittedGroupKeys:[],hasMore:page.hasMore},
    counts:{loaded:{groups:0,items:ids.length,relationships:connections},eligible:{groups:0,items:ids.length},
      page:{index:0,size:50,count:ids.length,pageCount:1},shown:{groups:0,items:ids.length,cards:0},
      represented:{relationships:connections,displayConnections:connections,businessRelationships:0}},omittedRelationships:[],
    bounds:{x1,x2,y1,y2,w:x2-x1,h:y2-y1}};
}
