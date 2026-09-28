import { compactReadingSummary } from '../../client/src/features/matter/compact-reading-summary';

describe('saved work reading summary', () => {
  it('keeps a short judgment together with its decisive limit', () => {
    const brief = '已确认故障机理；构型是否匹配仍待核实，不可据此认定必须实施。';
    expect(compactReadingSummary('故障机理已识别', brief)).toBe(brief);
  });

  it('surfaces the issue and open condition in a legacy metadata-first brief', () => {
    const brief = [
      '本份 FTD 编号 787-FTD-45-25001、ATA 45-00，Originated 09/16/2025、Last Revised 03/23/2026、ECCN 9E991',
      '机型元数据列 -8/-9/-10，适用范围仍待交叉验证',
      'CMCF OSS 中被禁用的可选设备系统在 ACARS 上行配置请求后会触发报告功能锁死或循环下链前一份有效报告，整套系统配置上行请求不受影响',
      '临时处置包括电源循环、模块测试或主从切换，并建议避免对禁用系统发起配置上行',
      '最终软件更新日期仍未确定，装机版本与机队适用性待核实',
    ].join('；');
    const summary = compactReadingSummary('787 FTD 当前认识', brief);
    expect(summary).toContain('触发报告功能锁死');
    expect(summary).toContain('整套系统配置上行请求不受影响');
    expect(summary).toContain('装机版本与机队适用性待核实');
    expect(summary).not.toContain('Originated');
    expect(summary.length).toBeLessThanOrEqual(260);
  });

  it('does not manufacture a claim from a metadata-only brief', () => {
    const headline = '文件工程认识';
    const brief = '文件编号与版次已登记；ATA 章节已登记；创建日期已登记。';
    expect(compactReadingSummary(headline, brief)).toBe(headline);
  });

  it('surfaces engineering facts instead of repeating the title for a long saved brief', () => {
    const brief = '依据 PRUN-example 两页原文恢复四项既有事项的实质工程分析：FTD 信息类通报、Applicability=All 787 Aircraft、Gatelink 受 TLS 1.0 阻断两种地面情景、AID 已为 TLS 1.2 与 OBEDS TLS 1.0 的链路差异、Interim 保持地面 TLS 1.0 + TWLU 有线连接、Final CSM BP v7.1 增加 OBEDS TLS 1.2 支持；Production Incorporation 3Q 2027 (Target) 与 Service Bulletin Available (TBD) 并列，SB 实际编号、装机清单与正式合规间隔属真实外部未知。';
    const summary = compactReadingSummary('787 文件标题', brief);
    expect(summary).toContain('Gatelink 受 TLS 1.0 阻断');
    expect(summary).toContain('All 787 Aircraft');
    expect(summary).toContain('正式合规间隔属真实外部未知');
    expect(summary).not.toContain('PRUN-example');
    expect(summary.length).toBeLessThanOrEqual(260);
  });
});
