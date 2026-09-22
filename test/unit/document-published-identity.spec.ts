import { DocumentParsingHostedService } from '../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
function fixture() {
 const context={ tenantId: 'tenant', actorUserId: 'actor', roles: [] };
 const sourceBinding={ documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 123 };
 const row={ tenantId: 'tenant', documentVersionId: 'DV', parseRunId: 'PR-old', parseRevision: 2, status: 'PUBLISHED', sourceBinding,
  manifestArtifact: { role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 456 } };
 const source={ version: { ...sourceBinding }, family: { familyId: 'FAM' }, source: { sourceArtifactId: 'ART', sha256: sourceBinding.pdfSha256, byteLength: 123 } };
 const authorizer={ assertCanRead: jest.fn() };
 const catalog={ readMetadataSource: jest.fn().mockResolvedValue(source) };
 const repository={ read: jest.fn().mockResolvedValue(row), current: jest.fn() };
 const files={ from: jest.fn(() => { throw new Error('NO_STORAGE_READ_ALLOWED'); }) };
 const service=new DocumentParsingHostedService(files as never,catalog as never,repository as never,{} as never,{} as never,authorizer as never);
 return { context, row, source, authorizer, catalog, repository, files, service };
}
it('inspects exact published source registration with two ACL checks and no object-store access', async () => {
 const f=fixture();
 await expect(f.service.inspectPublishedIdentity('DV','PR-old',f.context)).resolves.toEqual({ familyId: 'FAM', binding: {
  documentVersionId: 'DV',parseRunId:'PR-old',parseRevision:2,sourceArtifactId:'ART',sourceSha256:'a'.repeat(64),sourceByteLength:123 } });
 expect(f.authorizer.assertCanRead).toHaveBeenCalledTimes(2);
 expect(f.catalog.readMetadataSource).toHaveBeenCalledWith('DV','tenant');
 expect(f.repository.read).toHaveBeenCalledWith({ ...f.context, documentVersionId:'DV' },'PR-old');
 expect(f.repository.current).not.toHaveBeenCalled(); expect(f.files.from).not.toHaveBeenCalled();
});
it.each(['tenant','parse','status','manifest','digest','bytes','artifact','family'])('rejects mismatched %s registration', async field => {
 const f=fixture();
 if(field==='tenant') f.row.tenantId='other';
 if(field==='parse') f.row.parseRunId='other';
 if(field==='status') f.row.status='STAGING';
 if(field==='manifest') f.row.manifestArtifact.readback='PENDING';
 if(field==='digest') f.source.source.sha256='c'.repeat(64);
 if(field==='bytes') f.source.version.byteLength=999;
 if(field==='artifact') f.source.version.sourceArtifactId='other';
 if(field==='family') f.source.family.familyId='other';
 await expect(f.service.inspectPublishedIdentity('DV','PR-old',f.context)).rejects.toThrow();
 expect(f.files.from).not.toHaveBeenCalled();
});
it('refuses unavailable records and permission revoked before or after lookup', async () => {
 const f=fixture();
 f.authorizer.assertCanRead.mockRejectedValueOnce(new Error('REVOKED'));
 await expect(f.service.inspectPublishedIdentity('DV','PR-old',f.context)).rejects.toThrow('REVOKED');
 expect(f.catalog.readMetadataSource).not.toHaveBeenCalled();
 f.authorizer.assertCanRead.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('REVOKED_AFTER'));
 await expect(f.service.inspectPublishedIdentity('DV','PR-old',f.context)).rejects.toThrow('REVOKED_AFTER');
 f.repository.read.mockResolvedValueOnce(null);
 await expect(f.service.inspectPublishedIdentity('DV','PR-old',f.context)).rejects.toThrow('NOT_PUBLISHED');
});
