import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CanonicalApplicabilitySelectionReadModel } from '@shared/api.interface';

import {
  isApplicabilitySelectionUnconfigured,
  presentApplicabilitySelection,
  presentApplicabilitySelectionError,
} from '../../client/src/pages/DocumentParsingPage/applicability-selection-presentation';

const root = resolve(__dirname, '../..');

function selection(
  overrides: Partial<CanonicalApplicabilitySelectionReadModel> = {},
): CanonicalApplicabilitySelectionReadModel {
  return {
    schemaVersion: 'wiselink.3_1.applicability_selection_read_model.v1',
    workItemId: 'internal-work-item',
    workItemRevision: 17,
    documentVersionId: 'internal-document-version',
    aircraftIdentifier: 'B-1234',
    asOf: '2026-08-30',
    selectionRevision: 'internal-selection-revision',
    currentness: 'CURRENT',
    fleetSource: {
      sourceRevisionKey: 'internal-source-revision',
      authorityRevision: 'internal-authority-revision',
      sourceAsOf: '2026-08-29',
    },
    frozenSourceBinding: {
      status: 'READY',
      sourceExpressionCount: 8,
      assignmentCount: 3,
    },
    ...overrides,
  };
}

describe('applicability selection presentation', () => {
  it('maps success, unknown, waiting, stale and error without inferring applicability', () => {
    expect(presentApplicabilitySelection('ready', selection())).toMatchObject({
      state: 'success',
      selectionLabel: '选择已同步',
      sourceLabel: '来源已绑定',
    });
    expect(presentApplicabilitySelection('ready', null)).toMatchObject({
      state: 'unknown',
      selectionLabel: '选择状态未知',
    });
    expect(presentApplicabilitySelection('unconfigured', null)).toMatchObject({
      state: 'waiting',
      selectionLabel: '等待工程师输入',
    });
    expect(presentApplicabilitySelection('error', null)).toMatchObject({
      state: 'error',
      selectionLabel: '选择状态未知',
    });
    expect(
      presentApplicabilitySelection(
        'ready',
        selection({ currentness: 'STALE' }),
      ),
    ).toMatchObject({
      state: 'waiting',
      selectionLabel: '资料已更新',
    });
    expect(
      presentApplicabilitySelection(
        'ready',
        selection({
          frozenSourceBinding: {
            status: 'MISSING',
            sourceExpressionCount: 0,
            assignmentCount: 0,
          },
        }),
      ),
    ).toMatchObject({
      state: 'waiting',
      sourceLabel: '来源待补齐',
    });
  });

  it('recognizes the Host unconfigured state without exposing its code', () => {
    const reason = new Error(
      'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED',
    );
    expect(isApplicabilitySelectionUnconfigured(reason)).toBe(true);
    expect(presentApplicabilitySelection('unconfigured', null).guidance).toBe(
      '填写飞机号和评估日期后保存，系统不会自行推测。',
    );
  });

  it('maps raw Host failures to bounded user guidance', () => {
    const cases: Array<[Error, 'read' | 'save']> = [
      [new Error('APPLICABILITY_SELECTION_UNAVAILABLE'), 'read'],
      [new Error('WORK_ITEM_REVISION_CONFLICT'), 'save'],
      [new Error('PERMISSION_DENIED: actor-id'), 'read'],
      [new Error('WAITING_INPUT: internal-detail'), 'save'],
    ];

    for (const [reason, action] of cases) {
      const message: string = presentApplicabilitySelectionError(
        reason,
        action,
      );
      expect(message).toMatch(/[\u4e00-\u9fff]/u);
      expect(message).not.toMatch(
        /APPLICABILITY|WORK_ITEM|PERMISSION|WAITING_INPUT|actor-id|internal-detail/u,
      );
    }
  });

  it('keeps internal identifiers and raw errors out of the rendered component', async () => {
    const component: string = await readFile(
      resolve(
        root,
        'client/src/pages/DocumentParsingPage/ApplicabilitySelectionPanel.tsx',
      ),
      'utf8',
    );

    for (const internalLabel of [
      'currentness ·',
      'frozen source',
      'Host 返回',
      'authenticated GET readback',
      'WorkItem revision',
      'selection revision',
      'DocumentVersion',
      'Fleet source revision',
      'Fleet authority revision',
    ]) {
      expect(component).not.toContain(internalLabel);
    }
    expect(component).not.toContain('<code>{errorDetail}</code>');
    expect(component).not.toContain('{selection.documentVersionId}');
    expect(component).not.toContain('{selection.selectionRevision}');
    expect(component).toContain(
      '<details className="applicability-selection-readback">',
    );
  });

  it('allows the assessment audit explanation to wrap on narrow layouts', async () => {
    const styles: string = await readFile(
      resolve(
        root,
        'client/src/pages/DocumentParsingPage/document-parsing.css',
      ),
      'utf8',
    );
    const match: RegExpMatchArray | null = styles.match(
      /\.parse-assessment-audit article > small \{(?<body>[^}]+)\}/u,
    );
    expect(match?.groups?.body).toContain('overflow-wrap: anywhere');
    expect(match?.groups?.body).not.toContain('white-space: nowrap');
    expect(match?.groups?.body).not.toContain('text-overflow: ellipsis');
  });
});
