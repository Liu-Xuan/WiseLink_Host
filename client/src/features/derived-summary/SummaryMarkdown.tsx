import { useMemo, type ReactNode } from 'react';
import { defaultRehypePlugins, defaultRemarkPlugins } from 'streamdown';
import { Streamdown } from '@client/src/components/ui/streamdown';
import './summary-reading.css';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  data?: { hName?: string };
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const citationPrefix = '#wiselink-summary-reference:';

interface MarkdownParser { parse: (body: string) => MarkdownNode }

function summaryDefinitions(node: MarkdownNode): MarkdownNode[] {
  return node.type === 'definition' || node.type === 'footnoteDefinition' ? [node]
    : (node.children ?? []).flatMap(summaryDefinitions);
}

/** A fragment uses the full saved document's Markdown definitions. Parse those
 * with this same processor, preserving their URL, title and first-definition
 * order. Context blocks are parser input only; none of their prose is rendered. */
function remarkSummaryDefinitionContext(this: MarkdownParser, input: { body: string; context: string }) {
  return (tree: MarkdownNode): void => {
    if (input.body === input.context) return;
    const context: MarkdownNode = this.parse(input.context);
    const definitions: MarkdownNode[] = [], blocks: string[] = [];
    for (const node of context.children ?? []) {
      const selected: MarkdownNode[] = summaryDefinitions(node);
      if (!selected.length) continue;
      const start: number | undefined = node.position?.start.offset;
      const ends: number[] = selected.map((item: MarkdownNode) => {
        const end: number | undefined = item.position?.end.offset;
        if (end === undefined) throw new Error('SUMMARY_MARKDOWN_DEFINITION_POSITION_UNAVAILABLE');
        return end;
      });
      if (start === undefined) throw new Error('SUMMARY_MARKDOWN_DEFINITION_POSITION_UNAVAILABLE');
      // Keep the original containing block through its last definition. This
      // retains multiline, quoted and list definitions without inventing URLs.
      blocks.push(input.context.slice(start, Math.max(...ends)));
      definitions.push(...selected);
    }
    if (!definitions.length) return;
    // A root separator ends any original list/quote before the visible fragment.
    const prefix: string = blocks.join('\n\n') + '\n\n---\n\n';
    const parsed: MarkdownNode = this.parse(prefix + input.body);
    tree.children = [...definitions, ...(parsed.children ?? []).filter((node: MarkdownNode) =>
      (node.position?.start.offset ?? -1) >= prefix.length)];
  };
}

/** Replace text citations in the Markdown tree, never inside code or links. */
function remarkSummaryReferences() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (['code', 'inlineCode', 'link', 'linkReference', 'html'].includes(node.type) || !node.children) return;
      node.children = node.children.flatMap((child: MarkdownNode): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child]; }
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)) {
          const index = match.index;
          if (index > offset) parts.push({ type: 'text', value: child.value.slice(offset, index) });
          parts.push({ type: 'link', url: `${citationPrefix}${encodeURIComponent(match[1])}`,
            children: [{ type: 'text', value: match[0] }] });
          offset = index + match[0].length;
        }
        if (!offset) return [child];
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) });
        return parts;
      });
    };
    visit(tree);
  };
}

/** Only explicitly titled supporting sections fold. Unlabelled prose stays in place. */
function remarkSummarySupportingSections() {
  const titles = new Set(['依据与来源', '原文与来源', '生成记录', '生成过程']);
  return (tree: MarkdownNode): void => {
    const sections: MarkdownNode[] = [];
    const children = tree.children ?? [];
    for (let index = 0; index < children.length; index++) {
      const heading = children[index];
      const title = heading.children?.every((node: MarkdownNode) => node.type === 'text')
        ? heading.children.map((node: MarkdownNode) => node.value ?? '').join('').trim() : '';
      if (heading.type !== 'heading' || !titles.has(title)) { sections.push(heading); continue; }
      const contents: MarkdownNode[] = [];
      // Every next heading ends this section, including a nested engineering heading.
      while (children[index + 1] && children[index + 1].type !== 'heading') contents.push(children[++index]);
      sections.push({ type: 'blockquote', data: { hName: 'details' }, children: [
        { type: 'paragraph', data: { hName: 'summary' }, children: heading.children }, ...contents,
      ] });
    }
    tree.children = sections;
  };
}

export interface SummaryMarkdownProps {
  body: string;
  citationBody?: string;
  foldSupportingSections?: boolean;
  citationLabel: (reference: string) => string | undefined;
  onCitation: (reference: string) => void;
  renderUnresolvedCitation?: (reference: string) => ReactNode;
}

export default function SummaryMarkdown({ body, citationBody = body, foldSupportingSections = false,
  citationLabel, onCitation, renderUnresolvedCitation }: SummaryMarkdownProps) {
  const numbers = useMemo(() => new Map<string, number>([...new Set(
    Array.from(citationBody.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu), (match: RegExpMatchArray) => match[1]),
  )].map((reference: string, index: number) => [reference, index + 1])), [citationBody]);
  return <Streamdown className="summary-markdown" mode="static" parseIncompleteMarkdown={false}
    controls={false} parseMarkdownIntoBlocksFn={(text: string) => [text]}
    remarkPlugins={[defaultRemarkPlugins.gfm, defaultRemarkPlugins.math,
      [remarkSummaryDefinitionContext, { body, context: citationBody }], remarkSummaryReferences,
      ...(foldSupportingSections ? [remarkSummarySupportingSections] : [])]}
    rehypePlugins={[defaultRehypePlugins.raw, defaultRehypePlugins.sanitize, defaultRehypePlugins.katex]}
    components={{
      a: ({ href, title, children }) => {
        if (!href?.startsWith(citationPrefix)) return href
          ? <a href={href} title={title} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>;
        let reference: string;
        try { reference = decodeURIComponent(href.slice(citationPrefix.length)); }
        catch { return <span role="alert">［依据无法读回］</span>; }
        const label = citationLabel(reference);
        return label ? <button type="button" className="summary-citation"
          aria-label={`依据 ${numbers.get(reference) ?? ''}：${label}`} onClick={() => onCitation(reference)}>
          [{numbers.get(reference) ?? '依据'}]
        </button> : renderUnresolvedCitation
          ? renderUnresolvedCitation(reference) : <span role="alert">［依据无法读回］</span>;
      },
      // Saved prose must not initiate third-party image requests or executable diagrams.
      img: ({ alt }) => <span className="text-muted-foreground">［图片：{alt || '未提供说明'}，请在来源中查看］</span>,
      code: ({ children }) => <code>{children}</code>,
      pre: ({ children }) => <pre>{children}</pre>,
      table: ({ children }) => <div className="summary-table-scroll"><table>{children}</table></div>,
    }}>
    {body}
  </Streamdown>;
}
