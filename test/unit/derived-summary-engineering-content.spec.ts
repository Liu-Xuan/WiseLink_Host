import {
  deduplicateSummaryNotices,
  summaryEngineeringHeadline,
  summaryEngineeringLimitations,
  summaryEngineeringText,
} from '@shared/derived-summary-engineering-content';
import { wikiLayerInstruction } from '../../server/modules/canonical-host/hierarchical-wiki-generation';

test('mechanical inheritance is stable and keeps distinct citations, editions and conditions', () => {
  const original = ['需核对构型 A.1 [[source-a]]', '需核对构型 A.1 [[source-a]]',
    '需核对构型 A.1 [[source-b]]', '需核对构型 A.2 [[source-a]]', '仅在构型 A.1 时无需重启'];
  expect(deduplicateSummaryNotices(original)).toEqual([original[0], ...original.slice(2)]);
  expect(original).toHaveLength(5);
  expect(deduplicateSummaryNotices(['同一条件', ' 同一条件 '])).toEqual(['同一条件']);
});

test('filters known control notices while retaining source revision differences and partial reading gaps', () => {
  expect(summaryEngineeringLimitations([
    '这是派生候选摘要，不是新增独立证据。仅覆盖已保存的精确成员。',
    '本成员为已保存候选工作；同一根来源在其他成员中出现时只计一次，不继承其正式采用、适用性或执行状态。',
    '来源版本document_version_fixture是本地目录当前选择；发布方现行有效状态未核，不代表适用性、正式采用或其他版本覆盖。',
    '来源版本 document_version_fixture 为本地目录当前选择，发布方现行有效状态未核，不代表适用性、正式采用或其他版本覆盖。',
    '原件交付范围：COMPLETE_DELIVERY，41/41。',
    '本次尚未完成的下层依赖：SUMMARY 仍为 PARTIAL，DOCUMENT 仍为 SAVED_ASSESSMENT_NOT_READY。',
    '原件交付范围：PARTIAL_DELIVERY，20/41，尚缺故障恢复段落。',
    '来源版本DV-old与本地目录当前选择DV-new不同；尚未比较新版措施。',
  ])).toEqual([
    '原件交付范围：PARTIAL_DELIVERY，20/41，尚缺故障恢复段落。',
    '来源版本DV-old与本地目录当前选择DV-new不同；尚未比较新版措施。',
  ]);
});

test('separates a capability status prefix from the actual missing engineering data', () => {
  const limitation = 'fleet_configuration、reliability_history、knowledge_retrieval capability 均 NOT_CONNECTED/ACCESS_DENIED；MSN 装机清单、OSS/CMCF 软件版本与可靠性记录未取得，零起报告不构成零可能性。';
  expect(summaryEngineeringLimitations([limitation, limitation])).toEqual([
    'MSN 装机清单、OSS/CMCF 软件版本与可靠性记录未取得，零起报告不构成零可能性。',
  ]);
});

test('retains FTD reference status, TBD, dates, model differences, negation and workaround gaps', () => {
  const engineering = [
    'FTD 为参考性文档（for reference purposes only）；Production Incorporation、BCA Service Bulletin 均 TBD。',
    'Last Revised Date 03/23/2026、Estimated Completion Date 11/04/2027 不代表已经完成。',
    'Minor Model(s) -8/-9/-10 与 All 787 Aircrafts. 并存，Other Model(s) 空白。',
    'ACARS 实际发起方、workaround 驾驶舱效应、mastership switch 成功率与重启副作用均未确认。',
    '候选故障机理仍需验证；正式采用构型前须核对软件兼容条件。',
  ];
  expect(summaryEngineeringLimitations(engineering)).toEqual(engineering);
  expect(summaryEngineeringText(engineering.join('\n\n'))).toBe(engineering.join('\n\n'));
});

test('removes only the explicit adoption clause from a mixed substantive restriction', () => {
  const text = '文档受 BOEING PROPRIETARY 与 EAR ECCN 9E991（E:1/E:2 国家例外）约束；本候选不形成机队适用性、工程决策、批准、执行或正式采用意见。';
  expect(summaryEngineeringText(text)).toContain('BOEING PROPRIETARY 与 EAR ECCN 9E991（E:1/E:2 国家例外）');
  expect(summaryEngineeringText(text)).not.toContain('本候选');
});

test('free-form layer prose is preserved because its variable scope may carry engineering conditions', () => {
  const intro = '本层为 B787 · ATA 45（ATA2）候选综合，由其唯一已保存的 ATA 45-00 子层候选正文 [[child-exact]] 形成，保留该子层身份及其全部继承限制；本层为派生候选，非新增独立证据。';
  const body = 'CMCF 配置报告的 ACARS 上行请求异常；重启的副作用尚未确认。 [[child-exact]]';
  expect(summaryEngineeringText(`${intro}\n\n${body}`)).toBe(`${intro}\n\n${body}`);
});

test('headlines remove workflow labels without dropping the engineering problem or changing technical candidates', () => {
  expect(summaryEngineeringHeadline('B787 ATA 45 候选综合：CMCF 配置报告 ACARS 上行错误——基于唯一 ATA 45-00 子层候选的上层综合（候选，未完成分类）'))
    .toBe('B787 ATA 45 综合：CMCF 配置报告 ACARS 上行错误');
  expect(summaryEngineeringHeadline('候选故障机理与备用配置适用条件')).toBe('候选故障机理与备用配置适用条件');
});

test('new Wiki task instruction requires engineering titles and substantive conditions, not internal status prose', () => {
  const instruction = wikiLayerInstruction('ATA2');
  expect(instruction).toContain('标题直接写工程问题与对象');
  expect(instruction).toContain('内部记录，不逐层复制进正文或limitations');
  expect(instruction).toContain('参考属性');
  expect(instruction).toContain('workaround实际缺口必须保留');
});


test('known coverage bookkeeping becomes one factual label while an extended condition stays intact', () => {
  const legacy = '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。';
  expect(summaryEngineeringLimitations([legacy, legacy])).toEqual(['正文未直接引用该成员工作。']);
  expect(summaryEngineeringLimitations([legacy + ' 另有待核条件。'])).toEqual([legacy + ' 另有待核条件。']);
});

test('an engineering condition appended to a control-shaped paragraph is never discarded', () => {
  const values = [
    '本次尚未完成的下层依赖：SUMMARY 仍为 PARTIAL；MSN 1001 的装机软件版本尚未确认。',
    '本次尚未完成的下层依赖：SUMMARY 仍为 PARTIAL，不得宣称已覆盖这些新工作。 另有 ACARS 驾驶舱效应待核。',
    '仅覆盖显式选取的三份成员，全部溯源同一 FTD 原文，为同一来源派生复用而非独立佐证；未选成员、其他 ATA 与其他机型未覆盖。 机型 -8 与 -9 软件条件不同。',
  ];
  expect(summaryEngineeringLimitations(values)).toEqual(values);
});

test.each([
  '本次尚未完成的下层依赖：SUMMARY 仍为 PARTIAL，MSN 1001 的装机软件版本未核，无法确认重启适用性，不得宣称已覆盖这些新工作。',
  '本层为 B787 ATA 45 候选综合，由其唯一已保存的 ATA 45-00（仅适用于 OSS 1.2 构型）子层候选正文 [[child-exact]] 形成，保留该子层身份及其全部继承限制；本层为派生候选，非新增独立证据。',
  '仅覆盖显式选取的三份成员（-8 与 -9 的软件条件不同），全部溯源同一 FTD 原文，为同一来源派生复用而非独立佐证；未选成员、其他 ATA 与其他机型未覆盖。',
])('independent review mixed-condition paragraph is preserved: %s', value => {
  expect(summaryEngineeringText(value)).toBe(value);
  expect(summaryEngineeringLimitations([value])).toEqual([value]);
});

test('a free-form engineering condition inside a workflow-shaped title suffix is preserved', () => {
  const title = 'CMCF 综合——基于唯一 ATA 45-00（仅适用于 OSS 1.2 构型）子层候选的上层综合';
  expect(summaryEngineeringHeadline(title)).toBe(title);
});
