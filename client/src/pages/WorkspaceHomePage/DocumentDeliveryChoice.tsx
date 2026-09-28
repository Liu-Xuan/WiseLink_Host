import type { DocumentLibraryUploadRequest } from '@shared/api.interface';
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  RadioGroup,
  RadioGroupItem,
} from '@client/src/components/ui/radio-group';

export type DocumentDeliveryChoiceValue = NonNullable<
  DocumentLibraryUploadRequest['documentDelivery']
>;

interface DocumentDeliveryChoiceProps {
  value: DocumentDeliveryChoiceValue;
  onChange: (value: DocumentDeliveryChoiceValue) => void;
  disabled: boolean;
  idPrefix: string;
  context: 'matter' | 'library';
}

export function DocumentDeliveryChoice({
  value,
  onChange,
  disabled,
  idPrefix,
  context,
}: DocumentDeliveryChoiceProps) {
  const readingId = `${idPrefix}-reading`;
  const translationLabelId = `${idPrefix}-translation-label`;

  return (
    <section className="col-span-full grid gap-3 rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          id={readingId}
          checked={value.reading}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, reading: checked === true })
          }
        />
        <div className="grid gap-1">
          <label htmlFor={readingId} className="text-sm font-medium">
            独立文件解读{context === 'matter' ? '（默认请求）' : '（可选）'}
          </label>
          <span className="text-xs text-muted-foreground">
            概述这版文件本身；与工程事项的评估和综合结论分开。
          </span>
        </div>
      </div>
      <div className="grid gap-2 border-t border-border pt-3">
        <span id={translationLabelId} className="text-sm font-medium">
          中文全文翻译
        </span>
        <RadioGroup
          aria-labelledby={translationLabelId}
          value={value.translation}
          disabled={disabled}
          onValueChange={(translation) => {
            if (translation === 'NONE' || translation === 'ZH_FULL') {
              onChange({ ...value, translation });
            }
          }}
          className="gap-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="NONE" id={`${idPrefix}-translation-none`} />
            <label htmlFor={`${idPrefix}-translation-none`} className="text-xs">
              不请求全文翻译
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="ZH_FULL" id={`${idPrefix}-translation-zh`} />
            <label htmlFor={`${idPrefix}-translation-zh`} className="text-xs">
              请求全文中文翻译
            </label>
          </div>
        </RadioGroup>
        {context === 'matter' ? (
          <span className="text-xs text-muted-foreground">
            英文原文分析不会等待中文翻译。
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            此入口不会创建工程评估任务。
          </span>
        )}
      </div>
    </section>
  );
}
