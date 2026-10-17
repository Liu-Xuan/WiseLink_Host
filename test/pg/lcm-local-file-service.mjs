// File-backed FileService substitute for owned local PG acceptance, never a production provider.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

export async function localFileService(directory, initialOwner = '123') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let owner = initialOwner;
  const bucketId = 'lcm-local-file-service';
  const key = path => createHash('sha256').update(path.replace(/^\/+/, '')).digest('hex');
  const metadata = async path => {
    try { return JSON.parse(await readFile(join(directory, key(path) + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const bucket = {
    getFileMetadata: metadata,
    async upload(body, options) {
      const filePath = options.filePath.replace(/^\/+/, '');
      const bytes = Buffer.from(body);
      const row = { id: randomUUID(), name: options.fileName, filePath, bucketID: bucketId,
        metadata: { contentLength: String(bytes.length), mimeType: options.contentType },
        createdBy: { userID: owner }, createdAt: new Date().toISOString() };
      await writeFile(join(directory, key(filePath) + '.bin'), bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(join(directory, key(filePath) + '.json'), JSON.stringify(row), { flag: 'wx', mode: 0o600 });
      return row;
    },
    download(filePath) {
      return { asStream: async () => ({ content: await readFile(join(directory, key(filePath) + '.bin')),
        metadata: await metadata(filePath) }) };
    },
  };
  return { files: { getDefaultBucket: async () => bucketId, from: selected => {
    if (selected !== bucketId) throw new Error('LOCAL_BUCKET_MISMATCH');
    return bucket;
  } },
  setOwner: value => { owner = value; },
  async upload(bytes, name, requestId) {
    const row = await bucket.upload(bytes, { filePath: `wiselink/lcm/uploads/${requestId}/${name}`,
      fileName: name, contentType: 'application/vnd.ms-excel', upsert: false });
    return { bucketId, filePath: row.filePath, expectedProviderObjectId: row.id };
  } };
}
