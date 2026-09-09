import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AssessmentUpdatePreview from '../../client/src/features/review/AssessmentUpdatePreview';
import { reviewUiTurn } from './fixtures/review-ui';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/dialog', () => ({
  Dialog: 'section',
  DialogContent: 'div',
  DialogDescription: 'p',
  DialogHeader: 'header',
  DialogTitle: 'h2',
}));

describe('reviewed assessment update boundary', () => {
  it('shows selected saved input and answer, exact versions and unsent exclusion', () => {
    const html = renderToStaticMarkup(
      createElement(AssessmentUpdatePreview, {
        open: true,
        onOpenChange: () => undefined,
        turns: [{ ...reviewUiTurn(3, true), purpose: 'CHAT' }],
        selectedIds: ['TURN-3'],
        onSelectionChange: () => undefined,
        revision: 7,
        workingRevision: 2,
        materialTitle: 'SB sample',
        documentVersionId: 'DV-exact',
        modelLabel: 'actual-model',
        hasUnsentDraft: true,
        pending: false,
        disabled: false,
        onConfirm: () => undefined,
      }),
    );
    expect(html).toContain('核对本次更新评估范围');
    expect(html).toContain('DV-exact');
    expect(html).toContain('工作版本 2');
    expect(html).toContain('actual-model');
    expect(html).toContain('未发送文字及附件不在本次范围内');
    expect(html).toContain('保留已有候选，等待核对。');
    expect(html).toContain('确认范围并更新评估');
  });
  it('preserves separate immutable update retry and never consumes the composer', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../client/src/features/review/AssessmentUpdateControl.tsx',
      ),
      'utf8',
    );
    expect(source).toContain('pending ??');
    expect(source).toContain('submittingRef.current');
    expect(source).toContain('preview.scope');
    expect(source).toContain('preview.modelRef');
    expect(source).toContain('turn.requestId === pending.requestId');
    expect(source).not.toContain('setMessage');
    expect(source).toContain('mustReopen');
  });
  it('explicitly sends CHAT without injecting assessment selection fields', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../client/src/features/review/ContinuousReviewPanel.tsx',
      ),
      'utf8',
    );
    const request = source.slice(
      source.indexOf(
        'const response = await canonicalHost.appendReviewTextTurn',
      ),
      source.indexOf('async function closeConversation'),
    );
    expect(request).toContain("purpose: 'CHAT'");
    expect(request).toContain("executionMode: 'AUTOMATIC'");
    expect(request).not.toContain('includedDiscussionTurnIds:');
    expect(request).not.toContain('expectedInputRevision:');
    expect(source).not.toContain('发送并分析');
  });
});
