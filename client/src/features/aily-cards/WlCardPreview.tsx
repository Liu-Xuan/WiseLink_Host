import type {
  WlCardBodyElement,
  WlCardColumnSet,
  WlCardHeader,
  WlCardJson,
} from './types';

/* ============================================================
 * WiseLink 3.1 · 飞书卡片 JSON 2.0 轻量渲染器（预览页专用）
 * 只实现模板用到的组件子集：
 * header / markdown（粗体+列表子集）/ column_set / hr / note / action。
 * 仅用于本地视觉验收，不追求与飞书客户端像素一致。
 * ============================================================ */

interface RenderContext {
  onActionClick?: (value: Record<string, unknown>) => void;
}

const HEADER_TONE_CLASS: Record<string, string> = {
  blue: 'wl-preview-header--blue',
  turquoise: 'wl-preview-header--turquoise',
  green: 'wl-preview-header--green',
  orange: 'wl-preview-header--orange',
  red: 'wl-preview-header--red',
  grey: 'wl-preview-header--grey',
  violet: 'wl-preview-header--violet',
};

export function WlCardPreview({
  card,
  context,
}: {
  card: WlCardJson;
  context?: RenderContext;
}) {
  return (
    <div className="wl-preview-card">
      {card.header ? <CardHeader header={card.header} /> : null}
      <div className="wl-preview-card__body">
        {card.body.elements.map((element, index) => (
          <CardBodyElementView
            key={index}
            element={element}
            context={context}
          />
        ))}
      </div>
    </div>
  );
}

function CardHeader({ header }: { header: WlCardHeader }) {
  const tone = HEADER_TONE_CLASS[header.template ?? 'blue'] ?? '';
  return (
    <div className={`wl-preview-header ${tone}`.trim()}>
      <div className="wl-preview-header__title">{header.title.content}</div>
      {header.subtitle ? (
        <div className="wl-preview-header__subtitle">
          {header.subtitle.content}
        </div>
      ) : null}
    </div>
  );
}

function CardBodyElementView({
  element,
  context,
}: {
  element: WlCardBodyElement;
  context?: RenderContext;
}) {
  if (element.tag === 'markdown') {
    return <MarkdownView content={element.content} />;
  }
  if (element.tag === 'hr') {
    return <hr className="wl-preview-hr" />;
  }
  if (element.tag === 'note') {
    return (
      <div className="wl-preview-note">
        {element.elements.map((note, index) => (
          <span key={index}>{note.content}</span>
        ))}
      </div>
    );
  }
  if (element.tag === 'column_set') {
    return <ColumnSetView columnSet={element} context={context} />;
  }
  return (
    <div className="wl-preview-actions">
      {element.actions.map((button, index) => (
        <button
          key={index}
          type="button"
          className={`wl-preview-button wl-preview-button--${button.type ?? 'default'}`}
          onClick={() => {
            const behavior = button.behaviors[0];
            if (behavior?.type === 'callback' && context?.onActionClick) {
              context.onActionClick(
                (behavior.value ?? {}) as Record<string, unknown>,
              );
            }
          }}
        >
          {button.text.content}
        </button>
      ))}
    </div>
  );
}

function ColumnSetView({
  columnSet,
  context,
}: {
  columnSet: WlCardColumnSet;
  context?: RenderContext;
}) {
  return (
    <div
      className={`wl-preview-columns${columnSet.background_style === 'grey' ? ' wl-preview-columns--grey' : ''}`}
    >
      {columnSet.columns.map((column, index) => (
        <div
          key={index}
          className="wl-preview-column"
          style={{ flex: column.weight ?? 1 }}
        >
          {column.elements.map((element, elementIndex) => (
            <CardBodyElementView
              key={elementIndex}
              element={element}
              context={context}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** markdown 子集：**粗体** 行、• 列表行、普通行 */
function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="wl-preview-markdown">
      {lines.map((line, index) => {
        if (line.trim().length === 0)
          return <div key={index} className="wl-preview-markdown__blank" />;
        const boldMatch = /^\*\*(.+)\*\*$/.exec(line.trim());
        if (boldMatch) {
          return (
            <div key={index} className="wl-preview-markdown__label">
              {boldMatch[1]}
            </div>
          );
        }
        if (line.trim().startsWith('•')) {
          return (
            <div key={index} className="wl-preview-markdown__item">
              {line.trim()}
            </div>
          );
        }
        return (
          <div key={index} className="wl-preview-markdown__text">
            {line}
          </div>
        );
      })}
    </div>
  );
}
