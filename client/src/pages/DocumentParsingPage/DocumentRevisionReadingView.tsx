import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type { DocumentRevisionReadingResponse } from '@shared/document-revision-reading.interface';
import type { DocumentSemanticSection } from '@shared/document-semantic-map.interface';

import DocumentRevisionReadingSidePanel from './DocumentRevisionReadingSidePanel';

export interface DocumentRevisionReadingViewProps {
  reading: DocumentRevisionReadingResponse;
  returnParamsFor?: (binding: DocumentOriginalBinding) => string | null;
}

const COMPARISON_STATUS_LABEL: Record<
  DocumentRevisionReadingResponse['systemComparison']['status'],
  string
> = {
  TEXT_EQUAL: '文本一致',
  TEXT_DIFFERENT: '文本差异',
  NOT_COMPARED: '未产生比较',
};

const COMPARISON_REASON_LABEL: Record<string, string> = {
  SEMANTIC_PROFILES_DIFFER: '两端语义 profile 不一致',
  ROLE_MISSING_OR_REPEATED: '角色在一端缺失或重复',
  SECTION_ORGANIZATION_UNCERTAIN: '章节组织不确定',
  SECTION_EMPTY_OR_UNREAD: '章节为空或未读',
  NON_PLAIN_TEXT_CONTENT: '含非纯文本内容',
  SOURCE_READING_LIMITATIONS: '来源读取限制',
};

interface RoleAudit {
  repeated: string[];
  missingHere: string[];
}

function roleKeyCounts(sections: DocumentSemanticSection[]): Map<string, number> {
  const counts: Map<string, number> = new Map();
  for (const section of sections) {
    if (!section.roleKey) continue;
    counts.set(section.roleKey, (counts.get(section.roleKey) ?? 0) + 1);
  }
  return counts;
}

function auditRoles(
  ownSections: DocumentSemanticSection[],
  otherSections: DocumentSemanticSection[],
): RoleAudit {
  const ownCounts: Map<string, number> = roleKeyCounts(ownSections);
  const otherCounts: Map<string, number> = roleKeyCounts(otherSections);
  const repeated: string[] = [];
  ownCounts.forEach((count: number, roleKey: string) => {
    if (count > 1) repeated.push(roleKey);
  });
  const missingHere: string[] = [];
  otherCounts.forEach((_count: number, roleKey: string) => {
    if (!ownCounts.has(roleKey)) missingHere.push(roleKey);
  });
  return { repeated, missingHere };
}

function RoleAuditLine({ label, audit }: { label: string; audit: RoleAudit }) {
  if (audit.repeated.length === 0 && audit.missingHere.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {label}：无角色重复或缺失提示。
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {label}：
      {audit.repeated.length > 0
        ? `重复角色 ${audit.repeated.join('、')}（不自动对齐）；`
        : ''}
      {audit.missingHere.length > 0
        ? `另一端存在而本端缺失的角色 ${audit.missingHere.join('、')}`
        : ''}
    </p>
  );
}

export default function DocumentRevisionReadingView({
  reading,
  returnParamsFor,
}: DocumentRevisionReadingViewProps) {
  const comparison = reading.systemComparison;
  const beforeAudit: RoleAudit = auditRoles(
    reading.before.sections,
    reading.after.sections,
  );
  const afterAudit: RoleAudit = auditRoles(
    reading.after.sections,
    reading.before.sections,
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">系统文本比较</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                comparison.status === 'NOT_COMPARED' ? 'secondary' : 'default'
              }
            >
              {COMPARISON_STATUS_LABEL[comparison.status]}
            </Badge>
            <span className="text-sm text-muted-foreground">
              角色 {comparison.roleKey} · family {reading.familyId}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            比较口径：{comparison.method}——仅比较标题、段落与父级条件的空白归一化纯文本；不含表格、图示与工程含义。
          </p>
          {comparison.status === 'TEXT_EQUAL' ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              “文本一致”不代表工程影响、评估或适航结论无变化。
            </p>
          ) : null}
          {comparison.status === 'NOT_COMPARED' && comparison.reasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              未产生比较且未返回原因；以 Host 读取记录为准。
            </p>
          ) : null}
          {comparison.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {comparison.reasons.map((reason: string) => (
                <li key={reason}>
                  {COMPARISON_REASON_LABEL[reason] ?? reason}
                  {COMPARISON_REASON_LABEL[reason] ? (
                    <span className="ml-1 text-xs">（{reason}）</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-1 border-t border-border pt-2">
            <RoleAuditLine label="基线端" audit={beforeAudit} />
            <RoleAuditLine label="比较目标端" audit={afterAudit} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">本端点不推导的结论</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            <Badge variant="outline" className="mr-2">
              {reading.publicationRelationship}
            </Badge>
            出版/采用关系：未验证。一对来源版本不证明出版顺序、正式采用，也不证明最新或完整修订跨度。
          </p>
          <p className="text-muted-foreground">
            <Badge variant="outline" className="mr-2">
              {reading.assessmentCoverage}
            </Badge>
            评估覆盖：本次读取未记录。本端点不记录、不推导新版评估覆盖。
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <DocumentRevisionReadingSidePanel
          sideLabel="基线端（before）"
          side={reading.before}
          returnParamsFor={returnParamsFor}
        />
        <DocumentRevisionReadingSidePanel
          sideLabel="比较目标端（after）"
          side={reading.after}
          returnParamsFor={returnParamsFor}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        本视图为只读展示：改版比较仅反映两端所选角色的纯文本关系；来源链接使用各端自身
        binding 构造，基线端与比较目标端身份不互用。工程影响与评估须另行人工核对。
      </p>
    </div>
  );
}
