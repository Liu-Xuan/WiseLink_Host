import type { FC } from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';

interface MatterMembersProps {
  members: EngineeringMatterCatalogEntry[];
  onOpenMember: (member: EngineeringMatterCatalogEntry) => void;
}

const MatterMembers: FC<MatterMembersProps> = ({ members, onOpenMember }) => (
  <section className="space-y-4" aria-label="事项关联资料">
    <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      <FileText className="size-4" aria-hidden="true" />
      事项关联资料
    </h2>
    <ul className="space-y-4">
      {members.map((member: EngineeringMatterCatalogEntry) => (
        <li
          key={member.workItemId}
          className="space-y-2 border-t border-border pt-3"
        >
          <p className="break-words text-sm font-medium">
            {member.document.documentCode || '已登记文档'}
          </p>
          <p className="text-xs leading-6 text-muted-foreground">
            {member.document.businessRevision || '版本未标注'} ·{' '}
            {member.relationRole === 'PRIMARY' ? '主要来源' : '关联来源'}
            {!member.documentCurrentness.selectedVersionIsCurrent
              ? ' · 历史文档版本'
              : ''}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenMember(member)}
          >
            {member.sourceNavigation.status === 'AVAILABLE'
              ? '阅读这份原文'
              : '查看资料状态'}
          </Button>
        </li>
      ))}
    </ul>
    <p className="text-xs leading-6 text-muted-foreground">
      关联仅表明材料加入事项；是否被实际核查，以事项工作记录为准。
    </p>
  </section>
);

export default MatterMembers;
