import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { buildMatterObjectContext } from '@client/src/features/matter/matter-navigation';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import useMatterDirectory from '@client/src/features/matter/useMatterDirectory';
import useEngineeringMatter from '@client/src/features/matter/useEngineeringMatter';
import { matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import TrinitySituationView from '@client/src/features/trinity/TrinitySituationView';
import { projectAuthorizedSituation } from '@client/src/features/trinity/trinity-authorized-data';
import type { TrinityNavigationTarget } from '@client/src/features/trinity/trinity-types';

export default function EngineeringSituationPage() {
  const { matterId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [refresh, setRefresh] = useState(0);
  const [panel, setPanel] = useState<TrinityNavigationTarget | null>(null);
  const directory = useMatterDirectory('', '', sessionGeneration, !authenticationRequired, refresh);
  const focus = useEngineeringMatter(matterId, sessionGeneration, authenticationRequired);
  const { publishCurrentObject } = useCurrentObjectContext();
  useEffect(() => {
    publishCurrentObject(focus.data && !focus.error && !focus.loading ? buildMatterObjectContext(focus.data.matter, focus.data.working) : null);
    return () => publishCurrentObject(null);
  }, [focus.data, focus.error, focus.loading, publishCurrentObject]);
  const availability = authenticationRequired ? 'denied' : matterId
    ? focus.error ? 'failed' : focus.loading ? 'loading' : 'complete'
    : directory.error ? 'failed' : directory.loading ? 'loading' : 'complete';
  const directoryExhausted = !directory.loading && directory.nextCursor === null;
  const projection = useMemo(() => projectAuthorizedSituation(
    directory.items,
    availability,
    matterId ? focus.data : null,
    directoryExhausted,
  ), [directory.items, availability, matterId, focus.data, directoryExhausted]);
  const data = projection.data;
  const stage = params.get('stage') || '';
  const sourceCategory = params.get('source') || '';
  const readingRoute = (id: string) => id === matterId && focus.data?.working.current
    ? matterWorkRoute(id, focus.data.working.current.matterWorkRevisionId) : `/matters/${encodeURIComponent(id)}`;
  function select(stageId: string, sourceId: string) {
    const next = new URLSearchParams(params);
    if (stageId) next.set('stage', stageId); else next.delete('stage');
    if (sourceId) next.set('source', sourceId); else next.delete('source');
    setParams(next, { replace: true });
  }
  function handleNavigate(target: TrinityNavigationTarget) {
    switch (target.type) {
      case 'focus-matter': navigate(`/matters/${encodeURIComponent(target.matterId)}/posture`); return;
      case 'matter-reading': navigate(readingRoute(target.matterId)); return;
      case 'matter-work': navigate(matterWorkRoute(target.matterId, target.workRef)); return;
      case 'knowledge-item': {
        const route = projection.knowledgeTargets[target.knowledgeId];
        if (route) navigate(route);
        return;
      }
      case 'source-item': {
        const route = projection.sourceTargets[target.sourceId];
        if (route) navigate(route);
        return;
      }
      case 'view':
        if (target.view === 'library') navigate('/library?mode=matter');
        else if (target.view === 'timeline') { if (matterId) setPanel({type:'matter-timeline', matterId}); else navigate('/timeline'); }
        else if (target.view === 'graph') {
          if (!matterId) navigate('/graph');
          else {
            const graphParams = new URLSearchParams({ matterId });
            const workRef = focus.data?.working.current?.matterWorkRevisionId;
            if (workRef) graphParams.set('workRef', workRef);
            navigate(`/graph?${graphParams}`);
          }
        }
        return;
      case 'matter-timeline': setPanel(target); return;
      case 'knowledge-view': navigate('/knowledge'); return;
      default: setPanel(target);
    }
  }
  const stageId = panel && 'stageId' in panel ? panel.stageId : '';
  const associated = data.matters.filter((matter) =>
    matter.activeAssessmentStages.includes(stageId));
  const canRead = availability === 'complete';
  const catalog = focus.data?.matter.catalog.entries ?? [];
  const materials = focus.data?.matter.materials;
  const sourceIds = materials
    ? materials.filter(item => item.disposition === 'INCLUDED' && item.kind !== 'EXPECTED').map(item => item.documentVersionId).filter((id): id is string => Boolean(id))
    : catalog.map(item => item.document.documentVersionId);
  const sources = [...new Set(sourceIds)].map(id => ({id, label: catalog.find(item=>item.document.documentVersionId === id)?.document}));
  return <>
    <TrinitySituationView data={data} level={matterId ? 'focus' : 'macro'} focusMatterId={matterId}
      fleet="all" fleetOptions={[{value:'all', label:'当前授权事项'}]}
      selectedStageId={stage} selectedSourceId={sourceCategory}
      onLevelChange={(level) => {
        if (level === 'macro') navigate('/situation');
        else if (data.matters[0]) navigate(`/matters/${encodeURIComponent(data.matters[0].id)}/posture`);
        else setPanel({type:'view', view:'library'});
      }}
      onFocusMatterChange={(id) => navigate(`/matters/${encodeURIComponent(id)}/posture`)}
      onSelectionChange={({stageId, sourceId}) => select(stageId, sourceId)}
      onNavigate={handleNavigate} />
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <p>{canRead ? `本次目录已取得 ${directory.items.length} 个事项；六类来源与评估关联仍按实际接入范围显示。` : authenticationRequired ? '请登录后读取授权事项。' : focus.error || directory.error || '正在读取授权资料。'}</p>
      <Button variant="outline" size="sm" disabled={authenticationRequired || directory.loading || focus.loading} onClick={() => {setRefresh((value)=>value+1); if (matterId) void focus.refresh().catch(()=>undefined);}}>重新读取</Button>
      {directory.nextCursor ? <Button variant="outline" size="sm" disabled={directory.loading} onClick={directory.loadMore}>继续读取事项</Button> : null}
    </div>
    <Dialog open={Boolean(panel)} onOpenChange={(open)=>{if (!open) setPanel(null);}}>
      <DialogContent><DialogHeader><DialogTitle>{panel?.type === 'agent' ? '工程智能体' : panel?.type === 'matter-timeline' ? '选择时间声明的准确来源' : stageId ? data.stages.find(item=>item.id === stageId)?.title : '选择工程事项'}</DialogTitle><DialogDescription>{panel?.type === 'agent' ? '依据授权来源协助理解、调查、评估和协作。实际工作保存后可按准确版本阅读；正式采用由有权人员决定。这里不显示未经核实的运行进度。' : '以下仅为本次已取得范围，不代表全量事项或正式业务完成。'}</DialogDescription></DialogHeader>
        {canRead && panel?.type === 'matter-timeline' ? <ul className="space-y-3">{sources.map(source=><li key={source.id}><Link className="underline" to={`/timeline?${new URLSearchParams({documentVersionId:source.id})}`}>{source.label ? `${source.label.documentCode} · ${source.label.businessRevision}` : '阅读已关联文档版本的时间声明'}</Link><p className="text-xs text-muted-foreground">{source.id}</p></li>)}</ul> : null}
        {panel?.type === 'matter-timeline' && sources.length === 0 ? <p>尚未取得可选文档版本，请先进入事项核对关联资料。</p> : null}
        {canRead && stageId ? <ul className="space-y-3">{associated.map(matter=><li key={matter.id}><Link className="underline" to={readingRoute(matter.id)}>{matter.title}</Link><p className="text-xs text-muted-foreground">{matter.status}</p></li>)}</ul> : null}
        {stageId && associated.length === 0 ? <p>尚未取得该环节的关联记录。</p> : null}
        <Link className="underline" to={panel?.type === 'stage-knowledge' ? '/knowledge' : '/library?mode=matter'}>进入{panel?.type === 'stage-knowledge' ? '知识查阅' : '资料库'}</Link>
      </DialogContent>
    </Dialog>
  </>;
}
