import * as XLSX from 'xlsx';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LcmHostSnapshot, LcmLocalObservation, LcmParsedExport } from '../../../shared/lcm-export-staging.interface';
import { parseLcmExport } from '../../../server/modules/lcm-export-staging/lcm-export.parser';
import { parseHostSnapshot, matchLcmRecords } from '../../../server/modules/lcm-export-staging/lcm-host-snapshot.matcher';
import { stageLcmExport } from '../../../server/modules/lcm-export-staging/lcm-export.store';

function matrixBytes(values: Array<string | number | null>): Buffer {
  const book: XLSX.WorkBook = XLSX.utils.book_new();
  const tails: string[] = values.map((_value: string | number | null, index: number) => `B-${7800 + index}`);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['ATA章', '系统', '类型', '软件名称', '软件件号', ...tails],
    ['27', 'synthetic-system', 'synthetic-type', 'synthetic-software', 'TEST-PN-001', ...values],
  ]), 'Sheet0');
  return XLSX.write(book, { type: 'buffer', bookType: 'xls' }) as Buffer;
}

function host(): LcmHostSnapshot {
  return { schemaVersion: 'wiselink.lcm.host_snapshot.v1', snapshotId: 'synthetic-test-only',
    capturedAt: '2026-10-08T12:00:00Z',
    aircraft: [{ assetId: 'asset-1', tailNumber: 'B-7800', aircraftModel: 'B787-9' }],
    software: [{ softwareId: 'software-1', partNumber: 'TEST-PN-001' }],
    documentBindings: [{ sourceEoValue: 'TEST-EO-001', documentId: 'document-1', documentVersionId: 'version-1', version: 'R1' }],
  };
}

describe('LCM user-confirmed matrix semantics', () => {
  it('retains optional FIN positions, duplicate cells, and conflicts within the same exact row context', () => {
    const book: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['ATA章','系统','类型','软件名称','软件件号','FIN号','B-7800'],
      ['27','test-system','test-type','test-name','TEST-PN','FIN-A',1],
      ['27','test-system','test-type','test-name','TEST-PN','FIN-B',2],
      ['27','test-system','test-type','test-name','TEST-PN','FIN-A',2],
      ['27','test-system','test-type','test-name','TEST-PN','FIN-A',1],
    ]),'Sheet0');
    const parsed: LcmParsedExport = parseLcmExport(XLSX.write(book,{type:'buffer',bookType:'xls'}) as Buffer,'B787-9');
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records.reduce((total:number,record:LcmParsedExport['records'][number])=>total+record.sourceRows.length,0)).toBe(4);
    expect(parsed.diagnostics.filter((item:LcmParsedExport['diagnostics'][number])=>item.code==='IDENTITY_CONFLICT')).toHaveLength(1);
    expect(parsed.records[0].sourceRows[0].cells['FIN号'].address).toMatch(/^F/u);
    expect(parsed.records[0].sourceRows[0].cells['机尾号'].address).toBe('G1');
  });
  it('maps 1 to allowed/installed, 2 to allowed/not installed, and blanks or other values to unknown', () => {
    const parsed: LcmParsedExport = parseLcmExport(matrixBytes([1, '2', null, '　', 'unexpected']), 'B787-9');
    const byTail: Map<string, LcmParsedExport['records'][number]> = new Map(parsed.records.map(
      (record: LcmParsedExport['records'][number]) => [record.tailNumber, record]));
    expect(byTail.get('B-7800')).toMatchObject({ allowed: true, installed: true, observation: 'allowed-and-installed' });
    expect(byTail.get('B-7801')).toMatchObject({ allowed: true, installed: false, observation: 'allowed-only' });
    expect(byTail.get('B-7802')).toMatchObject({ allowed: null, installed: null, observation: 'unknown-blank' });
    expect(byTail.get('B-7803')).toMatchObject({ allowed: null, installed: null, observation: 'unknown-blank' });
    expect(byTail.get('B-7804')).toMatchObject({ allowed: null, installed: null, observation: 'unknown-value' });
    expect(byTail.get('B-7803')?.sourceRows[0].cells['矩阵值'].rawValue).toBe('　');
    expect(byTail.get('B-7804')?.fields['矩阵值']).toBe('unexpected');
    expect(parsed.diagnostics.filter((item: LcmParsedExport['diagnostics'][number]) => item.code === 'MATRIX_VALUE_UNKNOWN')).toHaveLength(1);
    expect(parsed.records.every((record: LcmParsedExport['records'][number]) =>
      record.executedAt === null && record.effectiveAt === null && record.semanticBasis === 'user-confirmed-matrix-definition')).toBe(true);
    expect(parsed.records).toHaveLength(5);
    expect(parsed.metadata.exportDate.localDateTime).toBeNull();
    expect(parsed.sourceAuthority).toBe('unverified/local');
  });

  it('keeps exact PN/tail identities and does not infer identity from a name or prefix', () => {
    const parsed: LcmParsedExport = parseLcmExport(matrixBytes([1, 2]), 'B787-9');
    const snapshot: LcmHostSnapshot = host();
    snapshot.software[0].partNumber = 'TEST-PN-001-OTHER';
    const matches: ReturnType<typeof matchLcmRecords> = matchLcmRecords(parsed.records, snapshot);
    expect(matches.every((item: ReturnType<typeof matchLcmRecords>[number]) => item.software.status === 'unresolved')).toBe(true);
    expect(matches.every((item: ReturnType<typeof matchLcmRecords>[number]) => item.liveHostVerified === false)).toBe(true);
    expect(new Set(parsed.records.map((record: LcmParsedExport['records'][number]) => record.recordId)).size).toBe(2);
  });
});

describe('LCM local staging history',()=>{
  it('replays the same collection after moving identical workbook bytes and retains the first source path', async () => {
    const directory: string = await mkdtemp(join(tmpdir(), 'lcm-moved-replay-test-'));
    try {
      const input: string = join(directory, 'original.xls'), moved: string = join(directory, 'moved.xls');
      const contextPath: string = join(directory, 'context.json');
      const context = { schemaVersion: 'wiselink.lcm.collection_context.v1', collectionId: 'moved-replay', sourceOrigin: 'local-file',
        pageUrl: null, filters: { aircraftModel: 'B787-9', status: null }, observedAt: null, sourceEvidence: 'synthetic only' };
      const options = { inputPath: input, stagingDirectory: join(directory, 'staging'), aircraftModel: 'B787-9',
        collectionContextPath: contextPath };
      const bytes: Buffer = matrixBytes([1]);
      await writeFile(input, bytes); await writeFile(moved, bytes); await writeFile(contextPath, JSON.stringify(context));
      const first = await stageLcmExport(options), retry = await stageLcmExport({ ...options, inputPath: moved });
      expect(retry.status).toBe('unchanged'); expect(retry.snapshotId).toBe(first.snapshotId);
      expect(retry.observationPath).toBe(first.observationPath);
      const observation: LcmLocalObservation = JSON.parse(await readFile(retry.observationPath, 'utf8')) as LcmLocalObservation;
      expect(observation.localSourcePath).toBe(input); expect(observation.originalFileName).toBe('original.xls');
      expect(await readdir(join(options.stagingDirectory, 'observations'))).toHaveLength(1);
      expect(await readdir(join(options.stagingDirectory, 'snapshots'))).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects changed workbook bytes for the same collection at a different path', async () => {
    const directory: string = await mkdtemp(join(tmpdir(), 'lcm-moved-conflict-test-'));
    try {
      const input: string = join(directory, 'original.xls'), moved: string = join(directory, 'changed.xls');
      const contextPath: string = join(directory, 'context.json');
      const context = { schemaVersion: 'wiselink.lcm.collection_context.v1', collectionId: 'moved-conflict', sourceOrigin: 'local-file',
        pageUrl: null, filters: { aircraftModel: 'B787-9', status: null }, observedAt: null, sourceEvidence: 'synthetic only' };
      const options = { inputPath: input, stagingDirectory: join(directory, 'staging'), aircraftModel: 'B787-9',
        collectionContextPath: contextPath };
      await writeFile(input, matrixBytes([1])); await writeFile(moved, matrixBytes([2]));
      await writeFile(contextPath, JSON.stringify(context));
      const first = await stageLcmExport(options), originalObservation: Buffer = await readFile(first.observationPath);
      await expect(stageLcmExport({ ...options, inputPath: moved })).rejects.toMatchObject({ code: 'COLLECTION_REPLAY_CONFLICT' });
      expect(await readFile(first.observationPath)).toEqual(originalObservation);
      expect(await readdir(join(options.stagingDirectory, 'observations'))).toHaveLength(1);
      expect(await readdir(join(options.stagingDirectory, 'snapshots'))).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('preserves A→B→A and replays an explicit collection without losing its provenance',async()=>{
    const directory:string=await mkdtemp(join(tmpdir(),'lcm-staging-test-'));
    try{
      const input:string=join(directory,'test.xls'),contextPath:string=join(directory,'context.json');
      const context={schemaVersion:'wiselink.lcm.collection_context.v1',collectionId:'A',sourceOrigin:'local-file',
        pageUrl:null,filters:{aircraftModel:'B787-9',status:null},observedAt:null,sourceEvidence:'synthetic only'};
      const options={inputPath:input,stagingDirectory:join(directory,'staging'),aircraftModel:'B787-9',collectionContextPath:contextPath};
      await writeFile(input,matrixBytes([1]));await writeFile(contextPath,JSON.stringify(context));
      const first=await stageLcmExport(options),retry=await stageLcmExport(options);
      expect(retry.status).toBe('unchanged');expect(retry.snapshotId).toBe(first.snapshotId);
      await writeFile(input,matrixBytes([2]));context.collectionId='B';await writeFile(contextPath,JSON.stringify(context));
      const second=await stageLcmExport(options);
      await writeFile(input,matrixBytes([1]));context.collectionId='C';await writeFile(contextPath,JSON.stringify(context));
      const third=await stageLcmExport(options);
      expect(third.snapshotId).not.toBe(first.snapshotId);
      const thirdJson=JSON.parse((await readFile(third.snapshotPath)).toString('utf8')) as {previousSnapshotId:string};
      expect(thirdJson.previousSnapshotId).toBe(second.snapshotId);
      context.collectionId='A';await writeFile(contextPath,JSON.stringify(context));
      expect((await stageLcmExport(options)).snapshotId).toBe(first.snapshotId);
      await writeFile(input,matrixBytes([2]));
      await expect(stageLcmExport(options)).rejects.toMatchObject({code:'COLLECTION_REPLAY_CONFLICT'});
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it('rejects wrong Excel formats and preserves exact EO and export date without creating event dates',()=>{
    expect(()=>parseLcmExport(Buffer.from('<html>login</html>'))).toThrow('Excel workbook');
    const headers:string[]=['ATA章节','系统','类型','软件名称','软件件号','软件描述','来源（EO）','状态','装载方式',
      '媒体件集号','模块件号','ERD','SLID','硬件名称','硬件件号','硬件描述'];
    const rows:Array<Array<string|null>>=[['所属构型','实飞构型',null,null,'机型','B787-9',null,null,'机尾号','B-7800',
      null,null,'导出日期','2026-03-20 14:32:33',null,null],['机构','synthetic only'],headers,
      ['27','test','test','test','PN-TEST',null,'EO-TEST Rev.02','raw-state',null,null,null,null,null,null,null,null]];
    const book:XLSX.WorkBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Sheet0');
    const parsed:LcmParsedExport=parseLcmExport(XLSX.write(book,{type:'buffer',bookType:'xls'}) as Buffer);
    expect(parsed.metadata.exportDate.localDateTime).toBe('2026-03-20T14:32:33');
    expect(parsed.records[0].originalEo).toBe('EO-TEST Rev.02');
    expect(parsed.records[0].sourceRows[0].cells['来源（EO）'].address).toBe('G4');
    expect(parsed.records[0].effectiveAt).toBeNull();expect(parsed.records[0].executedAt).toBeNull();
    rows[0][13]='2026-02-30 14:32:33';
    const invalid:XLSX.WorkBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(invalid,XLSX.utils.aoa_to_sheet(rows),'Sheet0');
    expect(()=>parseLcmExport(XLSX.write(invalid,{type:'buffer',bookType:'xls'}) as Buffer)).toThrow('invalid calendar');
  });
});

describe('LCM Host snapshot consistency', () => {
  it('rejects a documentVersionId attached to two different document objects', () => {
    const snapshot: LcmHostSnapshot = host();
    snapshot.documentBindings.push({ ...snapshot.documentBindings[0], documentId:'different-document' });
    expect(() => parseHostSnapshot(Buffer.from(JSON.stringify(snapshot)))).toThrow('conflicting attributes');
  });
  it.each(['aircraft', 'software', 'documentBindings'] as const)(
    'rejects a reused %s primary key with conflicting attributes',
    (collection: 'aircraft' | 'software' | 'documentBindings') => {
      const snapshot: LcmHostSnapshot = host();
      if (collection === 'aircraft') snapshot.aircraft.push({ ...snapshot.aircraft[0], tailNumber: 'B-7801' });
      if (collection === 'software') snapshot.software.push({ ...snapshot.software[0], partNumber: 'OTHER-PN' });
      if (collection === 'documentBindings') snapshot.documentBindings.push({ ...snapshot.documentBindings[0], version: 'R2' });
      expect(() => parseHostSnapshot(Buffer.from(JSON.stringify(snapshot)))).toThrow('conflicting attributes');
    },
  );

  it('accepts exact duplicates but preserves distinct exact IDs as ambiguous', () => {
    const snapshot: LcmHostSnapshot = host();
    snapshot.software.push({ ...snapshot.software[0] });
    expect(parseHostSnapshot(Buffer.from(JSON.stringify(snapshot))).software).toHaveLength(2);
    snapshot.software.push({ softwareId: 'software-2', partNumber: 'TEST-PN-001' });
    const parsed: LcmParsedExport = parseLcmExport(matrixBytes([1]), 'B787-9');
    expect(matchLcmRecords(parsed.records, snapshot)[0].software.status).toBe('conflict');
  });
});
