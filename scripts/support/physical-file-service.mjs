import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function requiredText(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizedBucketId(value) {
  const bucketId = requiredText(value, 'PHYSICAL_FILE_SERVICE_BUCKET_REQUIRED');
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(bucketId)) {
    throw new Error('PHYSICAL_FILE_SERVICE_BUCKET_INVALID');
  }
  return bucketId;
}

function normalizedFilePath(value) {
  const filePath = requiredText(
    value,
    'PHYSICAL_FILE_SERVICE_PATH_REQUIRED',
  ).replace(/^\/+/, '');
  const segments = filePath.split('/');
  if (
    filePath.length > 1024 ||
    filePath.includes('\0') ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.length > 255,
    )
  ) {
    throw new Error('PHYSICAL_FILE_SERVICE_PATH_INVALID');
  }
  return filePath;
}

function inputBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('PHYSICAL_FILE_SERVICE_BYTES_REQUIRED');
}

function strictlyContained(root, candidate) {
  const child = relative(root, candidate);
  return Boolean(
    child &&
    child !== '..' &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child),
  );
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export class PhysicalFileService {
  #rootDirectory;
  #defaultBucketId;
  #createdByUserId;
  #counts = {
    getDefaultBucket: 0,
    getFileMetadata: 0,
    upload: 0,
    download: 0,
    remove: 0,
  };

  constructor({ rootDirectory, defaultBucketId, createdByUserId } = {}) {
    const root = resolve(
      requiredText(rootDirectory, 'PHYSICAL_FILE_SERVICE_ROOT_REQUIRED'),
    );
    if (
      !strictlyContained('/private/tmp', root) &&
      !strictlyContained('/tmp', root)
    ) {
      throw new Error('PHYSICAL_FILE_SERVICE_ROOT_NOT_TEMPORARY');
    }
    this.#rootDirectory = root;
    this.#defaultBucketId = normalizedBucketId(defaultBucketId);
    this.#createdByUserId = requiredText(
      createdByUserId,
      'PHYSICAL_FILE_SERVICE_CREATED_BY_REQUIRED',
    );
  }

  get rootDirectory() {
    return this.#rootDirectory;
  }

  get operationCounts() {
    return { ...this.#counts };
  }

  get operationCount() {
    return Object.values(this.#counts).reduce((sum, value) => sum + value, 0);
  }

  async initialize() {
    await mkdir(this.#rootDirectory, { recursive: false }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    const actualRoot = await realpath(this.#rootDirectory);
    if (actualRoot !== this.#rootDirectory) {
      throw new Error('PHYSICAL_FILE_SERVICE_ROOT_REDIRECTED');
    }
    return this;
  }

  async getDefaultBucket() {
    this.#counts.getDefaultBucket += 1;
    return this.#defaultBucketId;
  }

  from(bucketIdValue) {
    const bucketId = normalizedBucketId(bucketIdValue);
    return Object.freeze({
      getFileMetadata: async (filePath) => {
        this.#counts.getFileMetadata += 1;
        return this.#getFileMetadata(bucketId, filePath);
      },
      upload: async (bytes, options = {}) => {
        this.#counts.upload += 1;
        return this.#upload(bucketId, bytes, options);
      },
      download: async (filePath) => {
        this.#counts.download += 1;
        return this.#download(bucketId, filePath);
      },
      remove: async (filePaths) => {
        this.#counts.remove += 1;
        return this.#remove(bucketId, filePaths);
      },
    });
  }

  async seed({ filePath, bytes, fileName, contentType = 'application/pdf' }) {
    return this.from(this.#defaultBucketId).upload(bytes, {
      filePath,
      fileName,
      contentType,
      createdByUserId: this.#createdByUserId,
      upsert: false,
    });
  }

  physicalObjectPath(bucketId, filePath) {
    return this.#location(bucketId, filePath).objectPath;
  }

  #location(bucketIdValue, filePathValue) {
    const bucketId = normalizedBucketId(bucketIdValue);
    const filePath = normalizedFilePath(filePathValue);
    const bucketRoot = resolve(this.#rootDirectory, 'objects', bucketId);
    const objectPath = resolve(bucketRoot, filePath);
    if (!strictlyContained(bucketRoot, objectPath)) {
      throw new Error('PHYSICAL_FILE_SERVICE_PATH_ESCAPE');
    }
    return {
      bucketId,
      filePath,
      objectPath,
      metadataPath: `${objectPath}.metadata.json`,
    };
  }

  async #getFileMetadata(bucketId, filePath) {
    const location = this.#location(bucketId, filePath);
    try {
      await Promise.all([
        access(location.objectPath),
        access(location.metadataPath),
      ]);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    return JSON.parse(await readFile(location.metadataPath, 'utf8'));
  }

  async #upload(bucketId, value, options) {
    const location = this.#location(bucketId, options.filePath);
    const bytes = inputBytes(value);
    const fileName = requiredText(
      options.fileName,
      'PHYSICAL_FILE_SERVICE_FILE_NAME_REQUIRED',
    );
    const contentType = requiredText(
      options.contentType,
      'PHYSICAL_FILE_SERVICE_CONTENT_TYPE_REQUIRED',
    );
    const createdByUserId = requiredText(
      options.createdByUserId ?? this.#createdByUserId,
      'PHYSICAL_FILE_SERVICE_CREATED_BY_REQUIRED',
    );
    await mkdir(dirname(location.objectPath), { recursive: true });
    const writeFlag = options.upsert === true ? 'w' : 'wx';
    await writeFile(location.objectPath, bytes, { flag: writeFlag });
    const objectStat = await stat(location.objectPath);
    const digest = sha256(bytes);
    const metadata = {
      id: `physical-${sha256(Buffer.from(`${bucketId}\n${location.filePath}\n${digest}`)).slice(0, 48)}`,
      bucketID: bucketId,
      filePath: `/${location.filePath}`,
      name: fileName,
      createdBy: { userID: createdByUserId },
      updatedAt: objectStat.mtime.toISOString(),
      metadata: {
        contentLength: String(bytes.byteLength),
        mimeType: contentType,
      },
    };
    await writeFile(location.metadataPath, `${JSON.stringify(metadata)}\n`, {
      flag: writeFlag,
    });
    return structuredClone(metadata);
  }

  async #download(bucketId, filePath) {
    const location = this.#location(bucketId, filePath);
    const metadata = await this.#getFileMetadata(bucketId, filePath);
    if (!metadata) throw new Error('PHYSICAL_FILE_SERVICE_OBJECT_NOT_FOUND');
    return {
      content: await readFile(location.objectPath),
      metadata,
    };
  }

  async #remove(bucketId, filePaths) {
    for (const filePath of Array.isArray(filePaths) ? filePaths : [filePaths]) {
      const location = this.#location(bucketId, filePath);
      await Promise.all([
        rm(location.objectPath, { force: true }),
        rm(location.metadataPath, { force: true }),
      ]);
    }
  }
}
