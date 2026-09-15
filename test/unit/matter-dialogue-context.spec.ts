import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('@lark-apaas/aily-web-sdk', () => ({ initAgentChat: jest.fn() }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
import ContextualDialogue from '../../client/src/features/dialogue/ContextualDialogue';

function source(path: string) {
  return readFileSync(resolve(__dirname, '../../client/src', path), 'utf8');
}

describe('Matter discussion material wiring', () => {
  it('displays the supplied document and OEM revision without claiming the native history is scoped', () => {
    const html = renderToStaticMarkup(
      createElement(ContextualDialogue, {
        document: {
          workItemId: 'WI-test',
          documentVersionId: 'DV-test',
          label: '777-SB-test',
        },
        documentRevision: 'R03',
        discussionScope: '事项',
      }),
    );
    expect(html).toContain('本页资料为：777-SB-test · R03');
    expect(html).toContain('聊天可能包含此前其他资料的讨论');
    expect(html).not.toContain('讨论资料：当前资料');
    expect(html).not.toContain('787');
  });

  it('does not fabricate a revision label when none is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(ContextualDialogue, {
        document: { workItemId: 'WI-test', label: 'FTD-test' },
        discussionScope: '文档',
      }),
    );
    expect(html).toContain('本页资料为：FTD-test');
    expect(html).not.toContain('R03');
  });

  it('passes the exact unique PRIMARY catalog fields and preserves the document-page materials fallback', () => {
    const matter = source('features/matter/EngineeringMatterPage.tsx');
    expect(matter).toContain(
      'primaryMembers.length === 1 ? primaryMembers[0] : undefined',
    );
    expect(matter).toMatch(
      /discussionMaterial=\{\{\s*title: primary.document.documentCode,\s*documentVersionId: primary.document.documentVersionId,\s*versionLabel: primary.document.businessRevision,/u,
    );
    const panel = source('features/review/ContinuousReviewPanel.tsx');
    expect(panel).toContain('discussionMaterial ?? materials?.primary');
    expect(panel).toContain(
      'documentRevision={dialogueMaterial?.versionLabel}',
    );
    expect(panel).toContain(
      'documentVersionId: dialogueMaterial?.documentVersionId',
    );
  });

  it('reinitializes on exact document-version changes without inventing a native session API', () => {
    const dialogue = source('features/dialogue/ContextualDialogue.tsx');
    expect(dialogue).toMatch(
      /\}, \[\s*document.workItemId,\s*document.documentVersionId,/u,
    );
    expect(dialogue).not.toContain('sendMessage(');
    expect(dialogue).not.toContain('clearAndStop(');
    expect(dialogue).not.toContain('sessionId:');
  });
});
