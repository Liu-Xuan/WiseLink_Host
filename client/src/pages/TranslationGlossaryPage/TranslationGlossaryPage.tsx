import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type {
  TranslationGlossaryEntry,
  TranslationGlossarySnapshot,
} from '@shared/api.interface';
import {
  readTranslationGlossary,
  updateTranslationGlossary,
  type TranslationGlossaryApiError,
} from '@client/src/api/translation-glossary';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';

function normalizeEntry(
  entry: TranslationGlossaryEntry,
): TranslationGlossaryEntry {
  return {
    ...entry,
    sourceText: entry.sourceText.trim(),
    targetRenderings:
      entry.kind === 'NO_TRANSLATE'
        ? []
        : entry.targetRenderings.map((text: string) => text.trim()),
    note: entry.note?.trim() || null,
  };
}

function validationMessage(entries: TranslationGlossaryEntry[]): string | null {
  if (entries.length > 200) return '术语表最多保留 200 条。';
  const keys: Set<string> = new Set();
  for (const entry of entries) {
    const source: string = entry.sourceText.trim();
    if (!source || source.length > 160) return '原文必须为 1–160 个字符。';
    if ((entry.note?.trim().length ?? 0) > 500) return '备注最多 500 个字符。';
    const key: string = `${entry.kind}\u0000${source.toLocaleLowerCase()}`;
    if (keys.has(key)) return `「${source}」在同一类别中重复。`;
    keys.add(key);
    if (entry.kind === 'NO_TRANSLATE') continue;
    const renderings: string[] = entry.targetRenderings.map((text: string) =>
      text.trim(),
    );
    if (
      renderings.length < 1 ||
      renderings.length > 5 ||
      renderings.some((text: string) => !text || text.length > 160)
    ) {
      return `「${source}」需要 1–5 个译法，每个译法为 1–160 个字符。`;
    }
    if (
      new Set(renderings.map((text: string) => text.toLocaleLowerCase()))
        .size !== renderings.length
    ) {
      return `「${source}」的译法不能重复。`;
    }
  }
  return null;
}

function errorMessage(reason: unknown): string {
  const error: TranslationGlossaryApiError | null =
    reason instanceof Error ? (reason as TranslationGlossaryApiError) : null;
  if (
    error?.statusCode === 409 ||
    error?.code === 'TRANSLATION_GLOSSARY_REVISION_CONFLICT'
  ) {
    return '术语表已被其他人更新。当前草稿未保存；请先保留需要的内容，再重新读取最新版本并修订。';
  }
  if (error?.statusCode === 401) return '登录已失效，请重新登录后读取术语表。';
  return error?.message || '术语表操作失败，请重试。';
}

export default function TranslationGlossaryPage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  return (
    <TranslationGlossaryEditor
      key={sessionGeneration}
      authenticationRequired={authenticationRequired}
    />
  );
}

function TranslationGlossaryEditor({
  authenticationRequired,
}: {
  authenticationRequired: boolean;
}) {
  const { publishCurrentObject } = useCurrentObjectContext();
  const [saved, setSaved] = useState<TranslationGlossarySnapshot | null>(null);
  const [entries, setEntries] = useState<TranslationGlossaryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState<boolean>(false);
  const epoch = useRef<number>(0);

  useEffect(() => publishCurrentObject(null), [publishCurrentObject]);
  const dirty: boolean =
    saved !== null && JSON.stringify(entries) !== JSON.stringify(saved.entries);
  const disabled: boolean =
    authenticationRequired || loading || saving || !saved;
  const invalid: string | null = validationMessage(entries);

  const refresh = useCallback(async (): Promise<void> => {
    const current: number = ++epoch.current;
    if (authenticationRequired) {
      setSaved(null);
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const value: TranslationGlossarySnapshot =
        await readTranslationGlossary();
      if (epoch.current !== current) return;
      setSaved(value);
      setEntries(value.entries);
    } catch (reason) {
      if (epoch.current === current) setError(errorMessage(reason));
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }, [authenticationRequired]);

  useEffect(() => {
    void refresh();
    return () => {
      epoch.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function changeEntry(
    entryId: string,
    patch: Partial<TranslationGlossaryEntry>,
  ): void {
    setEntries((current: TranslationGlossaryEntry[]) =>
      current.map((entry: TranslationGlossaryEntry) =>
        entry.entryId === entryId ? { ...entry, ...patch } : entry,
      ),
    );
    setNotice(null);
  }

  function addEntry(): void {
    if (disabled || entries.length >= 200) return;
    setEntries((current: TranslationGlossaryEntry[]) => [
      ...current,
      {
        entryId: crypto.randomUUID(),
        kind: 'TERM',
        sourceText: '',
        targetRenderings: [''],
        note: null,
      },
    ]);
    setNotice(null);
  }

  async function save(): Promise<void> {
    if (!saved || disabled || !dirty) return;
    if (invalid) {
      setError(invalid);
      return;
    }
    const current: number = ++epoch.current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const value: TranslationGlossarySnapshot =
        await updateTranslationGlossary({
          expectedRevision: saved.revision,
          entries: entries.map(normalizeEntry),
        });
      if (epoch.current !== current) return;
      setSaved(value);
      setEntries(value.entries);
      setNotice(
        `已保存修订 ${value.revision}。后续新受理的翻译任务使用这份术语表。`,
      );
    } catch (reason) {
      if (epoch.current === current) setError(errorMessage(reason));
    } finally {
      if (epoch.current === current) setSaving(false);
    }
  }

  function requestRefresh(): void {
    if (dirty) {
      setConfirmReload(true);
      return;
    }
    void refresh();
  }

  return (
    <main
      className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 md:px-6"
      aria-labelledby="glossary-title"
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">翻译设置</p>
          <h1 id="glossary-title" className="mt-1 text-3xl font-semibold">
            翻译术语表
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            统一术语译法，并标记需保留原文的名称。任何已登录的同租户用户均可修订。
            保存后用于后续新受理的翻译任务；已有翻译和运行中的任务不会自动重译。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={requestRefresh}
          disabled={loading || saving || authenticationRequired}
        >
          <RefreshCw aria-hidden="true" />
          重新读取
        </Button>
      </header>
      <p className="mb-5 text-sm text-muted-foreground">
        <Link to="/">返回工作台</Link>
      </p>
      {authenticationRequired ? (
        <p role="alert">请通过右上角账户入口重新登录。</p>
      ) : null}
      {loading ? <p role="status">正在读取术语表…</p> : null}
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-4 rounded-lg border p-3">
          {notice}
        </p>
      ) : null}
      {saved ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <div>
              <strong>已读取保存修订 {saved.revision}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {saved.revision === 1
                  ? '当前为初始默认术语；可直接修订。'
                  : '页面显示当前已读取的保存版本。'}{' '}
                共 {saved.entries.length} 条。
              </p>
            </div>
            <span role="status" className="text-sm">
              {dirty ? '有未保存更改' : '与已读取版本一致'}
            </span>
          </div>
          <div className="space-y-4">
            {entries.map((entry: TranslationGlossaryEntry, index: number) => (
              <section
                key={entry.entryId}
                className="rounded-xl border bg-card p-4 md:p-5"
                aria-label={`术语 ${index + 1}`}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={`术语 ${index + 1} 类别`}
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={entry.kind === 'TERM' ? 'default' : 'outline'}
                      aria-pressed={entry.kind === 'TERM'}
                      disabled={disabled}
                      onClick={() => {
                        if (entry.kind !== 'TERM')
                          changeEntry(entry.entryId, {
                            kind: 'TERM',
                            targetRenderings: [''],
                          });
                      }}
                    >
                      术语译法
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        entry.kind === 'NO_TRANSLATE' ? 'default' : 'outline'
                      }
                      aria-pressed={entry.kind === 'NO_TRANSLATE'}
                      disabled={disabled}
                      onClick={() => {
                        if (entry.kind !== 'NO_TRANSLATE')
                          changeEntry(entry.entryId, {
                            kind: 'NO_TRANSLATE',
                            targetRenderings: [],
                          });
                      }}
                    >
                      保留原文
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setEntries((current: TranslationGlossaryEntry[]) =>
                        current.filter(
                          (item: TranslationGlossaryEntry) =>
                            item.entryId !== entry.entryId,
                        ),
                      );
                      setNotice(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`glossary-source-${entry.entryId}`}
                      className="mb-1 block text-sm font-medium"
                    >
                      原文
                    </label>
                    <Input
                      id={`glossary-source-${entry.entryId}`}
                      value={entry.sourceText}
                      maxLength={160}
                      disabled={disabled}
                      onChange={(event) =>
                        changeEntry(entry.entryId, {
                          sourceText: event.target.value,
                        })
                      }
                      placeholder="例如：Flight Crew Operations Manual"
                    />
                  </div>
                  {entry.kind === 'TERM' ? (
                    <div>
                      <label
                        htmlFor={`glossary-target-${entry.entryId}`}
                        className="mb-1 block text-sm font-medium"
                      >
                        推荐译法（每行一个，最多 5 个）
                      </label>
                      <Textarea
                        id={`glossary-target-${entry.entryId}`}
                        value={entry.targetRenderings.join('\n')}
                        disabled={disabled}
                        onChange={(event) =>
                          changeEntry(entry.entryId, {
                            targetRenderings: event.target.value.split('\n'),
                          })
                        }
                        placeholder="输入中文译法"
                      />
                    </div>
                  ) : (
                    <p className="self-center text-sm text-muted-foreground">
                      翻译时保持原文写法。
                    </p>
                  )}
                </div>
                <div className="mt-4">
                  <label
                    htmlFor={`glossary-note-${entry.entryId}`}
                    className="mb-1 block text-sm font-medium"
                  >
                    使用说明（可选）
                  </label>
                  <Textarea
                    id={`glossary-note-${entry.entryId}`}
                    value={entry.note ?? ''}
                    maxLength={500}
                    disabled={disabled}
                    onChange={(event) =>
                      changeEntry(entry.entryId, { note: event.target.value })
                    }
                    placeholder="补充适用范围或歧义说明"
                  />
                </div>
              </section>
            ))}
            {entries.length === 0 ? (
              <p className="rounded-xl border p-8 text-center text-muted-foreground">
                术语表为空，可添加第一条。
              </p>
            ) : null}
          </div>
          {invalid && dirty ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {invalid}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={disabled || entries.length >= 200}
              onClick={addEntry}
            >
              <Plus aria-hidden="true" />
              添加术语
            </Button>
            <Button
              disabled={disabled || !dirty || !!invalid}
              onClick={() => void save()}
            >
              保存术语表
            </Button>
            {saving ? (
              <span role="status" className="text-sm">
                正在保存…
              </span>
            ) : null}
          </div>
          <Dialog open={confirmReload} onOpenChange={setConfirmReload}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>放弃未保存更改？</DialogTitle>
                <DialogDescription>
                  重新读取会用最新保存版本替换当前草稿。
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmReload(false)}
                >
                  继续编辑
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmReload(false);
                    void refresh();
                  }}
                >
                  放弃并重新读取
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : !loading && !authenticationRequired ? (
        <p role="status">尚未读取术语表，请重试。</p>
      ) : null}
    </main>
  );
}
