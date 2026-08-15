import {
  type AeoContentBlock,
  type AeoSourceBinding,
} from '../../../shared/aeo-editor';

const SOURCE_SHA256 =
  '4244c5afd5038fd8a2a5cb1534b30609a20f31f45c6ce43de07c025d1e1f6035';

export const AEO_EDITOR_FIXTURE_PROCEDURE_ITEM_ID =
  'AEON-545AAB85680AD96EAE0C66CB';

export function makeAeoEditorBlocksFixture(): AeoContentBlock[] {
  return [
    {
      ...sourcedBase('AEOBLK-R09-001', '0010', 'SOURCE_ADOPTED'),
      blockType: 'PARAGRAPH',
      bodyZh: '确认新软件是否已存在于飞机 MSD。',
      bodyEn: 'Make sure whether the new software is already in the airplane MSD.',
    },
    {
      ...sourcedBase('AEOBLK-R09-002', '0020', 'SOURCE_ADAPTED'),
      blockType: 'ORDERED_LIST',
      items: [
        {
          listItemId: 'AEOLI-R09-001',
          bodyZh: '启动维护笔记本上的 SMT 工具。',
          bodyEn: 'Start the SMT tool on the maintenance laptop.',
        },
        {
          listItemId: 'AEOLI-R09-002',
          bodyZh: '检查软件包和飞机连接。',
          bodyEn: 'Check the software package and airplane connection.',
        },
      ],
    },
    {
      ...sourcedBase('AEOBLK-R09-010', '0025', 'SOURCE_ADAPTED'),
      blockType: 'UNORDERED_LIST',
      items: [
        {
          listItemId: 'AEOLI-R09-003',
          bodyZh: '确认软件包名称与版本。',
          bodyEn: 'Confirm the software package name and version.',
        },
        {
          listItemId: 'AEOLI-R09-004',
          bodyZh: '确认飞机构型与适用性。',
          bodyEn: 'Confirm the airplane configuration and applicability.',
        },
      ],
    },
    {
      ...sourcedBase('AEOBLK-R09-011', '0028', 'SOURCE_ADOPTED'),
      blockType: 'WARNING',
      titleZh: '警告',
      titleEn: 'WARNING',
      bodyZh: '不得在未确认飞机状态时开始软件传输。',
      bodyEn: 'Do not start software transfer before airplane status is confirmed.',
    },
    {
      ...sourcedBase('AEOBLK-R09-003', '0030', 'HISTORICAL_OCCURRENCE_COPIED'),
      blockType: 'CAUTION',
      titleZh: '注意',
      titleEn: 'CAUTION',
      bodyZh: '传输期间不要断开维护笔记本。',
      bodyEn: 'Do not disconnect the maintenance laptop during transfer.',
    },
    {
      ...sourcedBase('AEOBLK-R09-004', '0040', 'SOURCE_ADOPTED'),
      blockType: 'REFERENCE',
      referenceKind: 'AMM',
      referenceLabel: 'AMM DMC-B787-A-46-12-00-23A-110B-A',
      targetRef: 'DMC-B787-A-46-12-00-23A-110B-A',
      bodyZh: '启动 OSM 功能。',
      bodyEn: 'Start the OSM function.',
    },
    {
      ...sourcedBase('AEOBLK-R09-005', '0050', 'HISTORICAL_OCCURRENCE_COPIED'),
      blockType: 'DATA_TABLE',
      columns: [
        { columnId: 'name', titleZh: '软件名称', titleEn: 'SW Nomenclature' },
        { columnId: 'part', titleZh: '软件件号', titleEn: 'Part Number' },
      ],
      rows: [
        {
          rowId: 'AEOTR-R09-001',
          cells: [
            {
              cellId: 'AEOTC-R09-001-NAME',
              columnId: 'name',
              textZh: 'Airplane Keys AMI',
              textEn: null,
              rowSpan: 1,
              columnSpan: 1,
            },
            {
              cellId: 'AEOTC-R09-001-PART',
              columnId: 'part',
              textZh: null,
              textEn: 'NOTE [1]',
              rowSpan: 1,
              columnSpan: 1,
            },
          ],
        },
      ],
    },
    {
      ...sourcedBase('AEOBLK-R09-006', '0060', 'HISTORICAL_OCCURRENCE_COPIED'),
      blockType: 'CONDITIONAL_BRANCH',
      branchEdgeId: 'AEOBR-7DDB3C17DA04C1D31E3AD302',
      outcomeLabel: 'IF_YES',
      effect: 'GOTO_AND_MARK_NOT_APPLICABLE',
      targetItemId: 'AEON-3D09766581B6D6514962EDDF',
      notApplicableItemIds: ['AEON-457DE1AFC314F272820FDAD6'],
      displayZh: '如果已存在，转到安装步骤，并将传输步骤签署 N/A。',
      displayEn: 'If present, go to installation and sign N/A for transfer.',
      reviewState: 'NEEDS_ENGINEERING_REVIEW',
    },
    {
      ...sourcedBase('AEOBLK-R09-007', '0070', 'HISTORICAL_OCCURRENCE_COPIED'),
      blockType: 'IMAGE',
      imageRef: 'AEOPIC-R09-SMT-001',
      fileName: 'smt-status.png',
      mediaType: 'image/png',
      sha256: '9'.repeat(64),
      captionZh: 'SMT 软件传输状态示意',
      captionEn: 'SMT software transfer status',
      anchorRole: 'AFTER_ITEM',
    },
    {
      ...engineerBase('AEOBLK-R09-008', '0080'),
      blockType: 'PARAGRAPH',
      bodyZh: '安装完成后执行软件检查。',
      bodyEn: 'Perform the Software Check after installation.',
    },
    {
      ...ungroundedBase('AEOBLK-R09-009', '0090'),
      blockType: 'NOTE',
      titleZh: 'AI 建议（待确认）',
      titleEn: 'AI suggestion (unconfirmed)',
      bodyZh: '记录工具版本和传输日志。',
      bodyEn: 'Record the tool version and transfer log.',
    },
  ];
}

function sourcedBase(
  blockId: string,
  orderKey: string,
  originType: AeoSourceBinding['originType'],
) {
  return {
    blockId,
    orderKey,
    originType,
    sourceBindings: [sourceBinding(blockId, originType)],
    engineerDecisionRef: null,
    unresolved: [],
  };
}

function engineerBase(blockId: string, orderKey: string) {
  return {
    blockId,
    orderKey,
    originType: 'ENGINEER_AUTHORED' as const,
    sourceBindings: [],
    engineerDecisionRef: 'AEODEC-R09-ENGINEER-001',
    unresolved: [],
  };
}

function ungroundedBase(blockId: string, orderKey: string) {
  return {
    blockId,
    orderKey,
    originType: 'MODEL_SUGGESTED_UNGROUNDED' as const,
    sourceBindings: [],
    engineerDecisionRef: null,
    unresolved: [
      {
        unresolvedId: 'AEOUNRES-R09-AI-001',
        code: 'AEO_MODEL_SUGGESTION_UNGROUNDED',
        message: '必须绑定受控依据或由工程师确认后才能进入导出检查点。',
        severity: 'BLOCKING' as const,
        blocksCheckpoint: true,
      },
    ],
  };
}

function sourceBinding(
  blockId: string,
  originType: AeoSourceBinding['originType'],
): AeoSourceBinding {
  return {
    bindingId: `AEOSRC-${blockId}`,
    originType,
    usage: bindingUsage(originType),
    sourceArtifactRef: 'AEOSRC-AEO-B787-46-0015-R09-DOCX',
    sourceNodeRef: `AEON-${blockId}`,
    sourceVersion: 'R09/A.1',
    sourceSha256: SOURCE_SHA256,
    locator: `docx:fixture:${blockId}`,
    language: 'BILINGUAL',
  };
}

function bindingUsage(
  originType: AeoSourceBinding['originType'],
): AeoSourceBinding['usage'] {
  if (originType === 'SOURCE_ADOPTED') return 'ADOPTED';
  if (originType === 'SOURCE_ADAPTED') return 'ADAPTED';
  if (originType === 'CATEGORY_PATTERN_INSTANTIATED') return 'INSTANTIATED';
  if (originType === 'LOCAL_METHOD') return 'REFERENCE_ONLY';
  return 'COPIED';
}
