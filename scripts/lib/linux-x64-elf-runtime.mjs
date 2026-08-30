import { constants as fsConstants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const ELF_HEADER_SIZE = 64;
const PROGRAM_HEADER_SIZE = 56;
const DYNAMIC_ENTRY_SIZE = 16;
const ELF_CLASS_64 = 2;
const ELF_DATA_LITTLE_ENDIAN = 1;
const ELF_VERSION_CURRENT = 1;
const ELF_MACHINE_X86_64 = 62;
const ELF_TYPE_EXECUTABLE = 2;
const ELF_TYPE_SHARED = 3;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const PT_INTERP = 3;
const DT_NULL = 0n;
const DT_NEEDED = 1n;
const DT_STRTAB = 5n;
const DT_STRSZ = 10n;
const DT_SONAME = 14n;
const DT_RPATH = 15n;
const DT_RUNPATH = 29n;
const DT_CONFIG = 0x6ffffefan;
const DT_DEPAUDIT = 0x6ffffefbn;
const DT_AUDIT = 0x6ffffefcn;
const DT_VERDEF = 0x6ffffffcn;
const DT_VERDEFNUM = 0x6ffffffdn;
const DT_VERNEED = 0x6ffffffen;
const DT_VERNEEDNUM = 0x6fffffffn;
const DT_AUXILIARY = 0x7ffffffdn;
const DT_FILTER = 0x7fffffffn;
const FORBIDDEN_DYNAMIC_TAGS = new Set([
  DT_CONFIG,
  DT_DEPAUDIT,
  DT_AUDIT,
  DT_AUXILIARY,
  DT_FILTER,
]);
const GLIBC_RUNTIME_FILES = new Set([
  'ld-linux-x86-64.so.2',
  'libc.so.6',
  'libm.so.6',
  'libresolv.so.2',
]);
const MAX_VERSION_RECORDS = 16_384;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export async function parseLinuxX64Elf(path) {
  const bytes = await readFile(path);
  if (
    bytes.length < 4 ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  ) {
    fail('OCR_RUNTIME_ELF_NOT_ELF', path);
  }
  assertRange(bytes, 0, ELF_HEADER_SIZE, 'OCR_RUNTIME_ELF_MALFORMED');
  if (bytes[4] !== ELF_CLASS_64) {
    fail('OCR_RUNTIME_ELF_CLASS_MISMATCH', path);
  }
  if (bytes[5] !== ELF_DATA_LITTLE_ENDIAN) {
    fail('OCR_RUNTIME_ELF_ENDIAN_MISMATCH', path);
  }
  if (bytes[6] !== ELF_VERSION_CURRENT) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }
  if (bytes[7] !== 0 && bytes[7] !== 3) {
    fail('OCR_RUNTIME_ELF_OSABI_MISMATCH', path);
  }

  const type = bytes.readUInt16LE(16);
  if (type !== ELF_TYPE_EXECUTABLE && type !== ELF_TYPE_SHARED) {
    fail('OCR_RUNTIME_ELF_TYPE_INVALID', path);
  }
  if (bytes.readUInt16LE(18) !== ELF_MACHINE_X86_64) {
    fail('OCR_RUNTIME_ELF_MACHINE_MISMATCH', path);
  }
  if (
    bytes.readUInt32LE(20) !== ELF_VERSION_CURRENT ||
    bytes.readUInt16LE(52) !== ELF_HEADER_SIZE ||
    bytes.readUInt16LE(54) !== PROGRAM_HEADER_SIZE
  ) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }

  const programHeaderOffset = toSafeNumber(
    bytes.readBigUInt64LE(32),
    'OCR_RUNTIME_ELF_MALFORMED',
  );
  const programHeaderCount = bytes.readUInt16LE(56);
  if (programHeaderCount === 0 || programHeaderCount === 0xffff) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }
  assertRange(
    bytes,
    programHeaderOffset,
    programHeaderCount * PROGRAM_HEADER_SIZE,
    'OCR_RUNTIME_ELF_MALFORMED',
  );

  const programHeaders = [];
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * PROGRAM_HEADER_SIZE;
    const fileOffset = bytes.readBigUInt64LE(offset + 8);
    const virtualAddress = bytes.readBigUInt64LE(offset + 16);
    const fileSize = bytes.readBigUInt64LE(offset + 32);
    const memorySize = bytes.readBigUInt64LE(offset + 40);
    if (fileSize > memorySize) fail('OCR_RUNTIME_ELF_MALFORMED', path);
    assertBigIntFileRange(
      bytes,
      fileOffset,
      fileSize,
      'OCR_RUNTIME_ELF_MALFORMED',
    );
    programHeaders.push({
      type: bytes.readUInt32LE(offset),
      fileOffset,
      virtualAddress,
      fileSize,
      memorySize,
    });
  }

  const loads = programHeaders.filter((header) => header.type === PT_LOAD);
  const dynamicHeaders = programHeaders.filter(
    (header) => header.type === PT_DYNAMIC,
  );
  if (loads.length === 0 || dynamicHeaders.length !== 1) {
    fail('OCR_RUNTIME_ELF_DYNAMIC_MISSING', path);
  }
  const interpreterHeaders = programHeaders.filter(
    (header) => header.type === PT_INTERP,
  );
  if (interpreterHeaders.length > 1) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }
  const interpreter = interpreterHeaders.length
    ? readSegmentString(bytes, interpreterHeaders[0], path)
    : null;

  const dynamic = parseDynamicTable(bytes, dynamicHeaders[0], path);
  for (const tag of FORBIDDEN_DYNAMIC_TAGS) {
    if (dynamic.has(tag)) fail('OCR_RUNTIME_ELF_FORBIDDEN_DYNAMIC_TAG', path);
  }
  if (dynamic.has(DT_RPATH)) fail('OCR_RUNTIME_ELF_RPATH_FORBIDDEN', path);

  const stringTableAddress = singletonDynamicValue(dynamic, DT_STRTAB, path);
  const stringTableSize = singletonDynamicValue(dynamic, DT_STRSZ, path);
  if (stringTableAddress === null || stringTableSize === null) {
    fail('OCR_RUNTIME_ELF_STRTAB_INVALID', path);
  }
  const stringTableLength = toSafeNumber(
    stringTableSize,
    'OCR_RUNTIME_ELF_STRTAB_INVALID',
  );
  const stringTableOffset = mapVirtualAddress(
    loads,
    stringTableAddress,
    stringTableSize,
    path,
  );
  assertRange(
    bytes,
    stringTableOffset,
    stringTableLength,
    'OCR_RUNTIME_ELF_STRTAB_INVALID',
  );
  const readString = (offset) =>
    readDynamicString(
      bytes,
      stringTableOffset,
      stringTableLength,
      offset,
      path,
    );

  const needed = dynamicValues(dynamic, DT_NEEDED).map(readString);
  for (const dependency of needed) validateLibraryName(dependency, path);
  if (new Set(needed).size !== needed.length) {
    fail('OCR_RUNTIME_ELF_NEEDED_NAME_INVALID', path);
  }
  const sonameValue = singletonDynamicValue(dynamic, DT_SONAME, path);
  const rpathValue = singletonDynamicValue(dynamic, DT_RPATH, path);
  const runpathValue = singletonDynamicValue(dynamic, DT_RUNPATH, path);
  const soname = sonameValue === null ? null : readString(sonameValue);
  const rpath = rpathValue === null ? null : readString(rpathValue);
  const runpath = runpathValue === null ? null : readString(runpathValue);
  if (soname !== null) validateLibraryName(soname, path);
  if (rpath !== null) fail('OCR_RUNTIME_ELF_RPATH_FORBIDDEN', path);
  validateRunpath(runpath, path);

  const versionNeeds = parseVersionNeeds({
    bytes,
    loads,
    dynamic,
    needed,
    path,
    readString,
  });
  const versionDefinitions = parseVersionDefinitions({
    bytes,
    loads,
    dynamic,
    path,
    readString,
  });

  return {
    path,
    type,
    interpreter,
    soname,
    needed,
    rpath,
    runpath,
    versionNeeds,
    versionDefinitions,
  };
}

export async function validateLinuxX64ElfRuntime({
  root,
  renderer,
  engine,
  loader,
  libraryDirectory,
}) {
  const rootReal = await realpath(root);
  const libraryDirectoryReal = await containedRealpath(
    rootReal,
    libraryDirectory,
    'OCR_RUNTIME_ELF_LIBRARY_DIRECTORY_OUTSIDE_ROOT',
  );
  const rootPrograms = [
    ['renderer', renderer],
    ['engine', engine],
  ];
  const parsedPrograms = new Map();
  for (const [name, path] of rootPrograms) {
    const programReal = await containedRealpath(
      rootReal,
      path,
      'OCR_RUNTIME_ELF_PROGRAM_OUTSIDE_ROOT',
    );
    await assertRegularExecutable(programReal);
    const info = await parseLinuxX64Elf(programReal);
    if (info.interpreter !== '/lib64/ld-linux-x86-64.so.2') {
      fail('OCR_RUNTIME_ELF_INTERPRETER_MISMATCH', programReal);
    }
    if (info.runpath !== '$ORIGIN/../lib') {
      fail('OCR_RUNTIME_ELF_RUNPATH_INVALID', programReal);
    }
    parsedPrograms.set(name, info);
  }

  const loaderReal = await containedRealpath(
    rootReal,
    loader,
    'OCR_RUNTIME_ELF_LOADER_OUTSIDE_ROOT',
  );
  await assertRegularExecutable(loaderReal);
  const loaderInfo = await parseLinuxX64Elf(loaderReal);
  if (
    loaderInfo.type !== ELF_TYPE_SHARED ||
    loaderInfo.interpreter !== null ||
    basename(loaderReal) !== 'ld-linux-x86-64.so.2'
  ) {
    fail('OCR_RUNTIME_ELF_LOADER_INVALID', loaderReal);
  }

  const entries = await readdir(libraryDirectoryReal, {
    withFileTypes: true,
  });
  const librariesByName = new Map();
  const sonameOwners = new Map();
  const libraryInfos = [];
  for (const entry of entries) {
    const entryPath = join(libraryDirectoryReal, entry.name);
    const entryReal = await containedRealpath(
      rootReal,
      entryPath,
      'OCR_RUNTIME_ELF_DEPENDENCY_OUTSIDE_ROOT',
    );
    const metadata = await lstat(entryReal);
    if (!metadata.isFile()) {
      fail('OCR_RUNTIME_ELF_DEPENDENCY_NOT_REGULAR', entryPath);
    }
    const info = await parseLinuxX64Elf(entryReal);
    if (!info.soname) fail('OCR_RUNTIME_ELF_SONAME_MISSING', entryReal);
    if (entry.name !== info.soname) {
      fail('OCR_RUNTIME_ELF_DEPENDENCY_SONAME_MISMATCH', entryReal);
    }
    if (sonameOwners.has(info.soname)) {
      fail('OCR_RUNTIME_ELF_SONAME_COLLISION', info.soname);
    }
    if (
      info.runpath !== null &&
      info.runpath !== '$ORIGIN' &&
      !GLIBC_RUNTIME_FILES.has(entry.name)
    ) {
      fail('OCR_RUNTIME_ELF_RUNPATH_INVALID', entryReal);
    }
    librariesByName.set(entry.name, info);
    sonameOwners.set(info.soname, entryReal);
    libraryInfos.push(info);
  }

  if (librariesByName.get(basename(loaderReal))?.path !== loaderReal) {
    fail('OCR_RUNTIME_ELF_LOADER_INVALID', loaderReal);
  }

  const allConsumers = [...parsedPrograms.values(), ...libraryInfos];
  const edges = [];
  for (const consumer of allConsumers) {
    for (const needed of consumer.needed) {
      const provider = librariesByName.get(needed);
      if (!provider) {
        fail(
          'OCR_RUNTIME_ELF_DEPENDENCY_MISSING',
          `${basename(consumer.path)}:${needed}`,
        );
      }
      if (provider.soname !== needed) {
        fail(
          'OCR_RUNTIME_ELF_DEPENDENCY_SONAME_MISMATCH',
          `${needed}:${provider.soname ?? 'null'}`,
        );
      }
      edges.push({ from: consumer.path, needed, to: provider.path });
    }
    for (const [providerName, versions] of consumer.versionNeeds) {
      const provider = librariesByName.get(providerName);
      if (!provider) {
        fail(
          'OCR_RUNTIME_ELF_DEPENDENCY_MISSING',
          `${basename(consumer.path)}:${providerName}`,
        );
      }
      for (const version of versions) {
        if (!provider.versionDefinitions.has(version)) {
          fail(
            'OCR_RUNTIME_ELF_ABI_VERSION_UNSATISFIED',
            `${basename(consumer.path)}:${providerName}:${version}`,
          );
        }
      }
    }
  }

  return {
    root: rootReal,
    loader: loaderInfo,
    renderer: parsedPrograms.get('renderer'),
    engine: parsedPrograms.get('engine'),
    libraries: libraryInfos,
    edges,
  };
}

function parseDynamicTable(bytes, header, path) {
  const offset = toSafeNumber(header.fileOffset, 'OCR_RUNTIME_ELF_MALFORMED');
  const size = toSafeNumber(header.fileSize, 'OCR_RUNTIME_ELF_MALFORMED');
  if (size === 0 || size % DYNAMIC_ENTRY_SIZE !== 0) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }
  const values = new Map();
  let terminated = false;
  for (
    let cursor = offset;
    cursor < offset + size;
    cursor += DYNAMIC_ENTRY_SIZE
  ) {
    const tag = bytes.readBigInt64LE(cursor);
    const value = bytes.readBigUInt64LE(cursor + 8);
    if (tag === DT_NULL) {
      terminated = true;
      break;
    }
    const existing = values.get(tag) ?? [];
    existing.push(value);
    values.set(tag, existing);
  }
  if (!terminated) fail('OCR_RUNTIME_ELF_DYNAMIC_UNTERMINATED', path);
  return values;
}

function singletonDynamicValue(dynamic, tag, path) {
  const values = dynamicValues(dynamic, tag);
  if (values.length > 1) fail('OCR_RUNTIME_ELF_MALFORMED', path);
  return values[0] ?? null;
}

function dynamicValues(dynamic, tag) {
  return dynamic.get(tag) ?? [];
}

function mapVirtualAddress(loads, address, size, path) {
  const end = address + size;
  if (end < address) fail('OCR_RUNTIME_ELF_VADDR_UNMAPPABLE', path);
  const matches = loads.filter((load) => {
    const loadEnd = load.virtualAddress + load.fileSize;
    return address >= load.virtualAddress && end <= loadEnd;
  });
  if (matches.length !== 1) {
    fail('OCR_RUNTIME_ELF_VADDR_UNMAPPABLE', path);
  }
  return toSafeNumber(
    matches[0].fileOffset + (address - matches[0].virtualAddress),
    'OCR_RUNTIME_ELF_VADDR_UNMAPPABLE',
  );
}

function readSegmentString(bytes, header, path) {
  const offset = toSafeNumber(header.fileOffset, 'OCR_RUNTIME_ELF_MALFORMED');
  const size = toSafeNumber(header.fileSize, 'OCR_RUNTIME_ELF_MALFORMED');
  const end = bytes.indexOf(0, offset);
  if (end < offset || end >= offset + size) {
    fail('OCR_RUNTIME_ELF_MALFORMED', path);
  }
  return decodeUtf8(bytes.subarray(offset, end), path);
}

function readDynamicString(
  bytes,
  stringTableOffset,
  stringTableLength,
  offsetValue,
  path,
) {
  const relativeOffset = toSafeNumber(
    offsetValue,
    'OCR_RUNTIME_ELF_STRTAB_INVALID',
  );
  if (relativeOffset >= stringTableLength) {
    fail('OCR_RUNTIME_ELF_STRTAB_INVALID', path);
  }
  const offset = stringTableOffset + relativeOffset;
  const end = bytes.indexOf(0, offset);
  if (end < offset || end >= stringTableOffset + stringTableLength) {
    fail('OCR_RUNTIME_ELF_STRTAB_INVALID', path);
  }
  return decodeUtf8(bytes.subarray(offset, end), path);
}

function decodeUtf8(bytes, path) {
  let value;
  try {
    value = UTF8_DECODER.decode(bytes);
  } catch {
    fail('OCR_RUNTIME_ELF_STRTAB_INVALID', path);
  }
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('OCR_RUNTIME_ELF_STRTAB_INVALID', path);
  }
  return value;
}

function parseVersionNeeds({
  bytes,
  loads,
  dynamic,
  needed,
  path,
  readString,
}) {
  const address = singletonDynamicValue(dynamic, DT_VERNEED, path);
  const countValue = singletonDynamicValue(dynamic, DT_VERNEEDNUM, path);
  if ((address === null) !== (countValue === null)) {
    fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
  }
  if (address === null) return new Map();
  const count = boundedRecordCount(countValue, path);
  let cursor = mapVirtualAddress(loads, address, 16n, path);
  const result = new Map();
  const visited = new Set();
  for (let index = 0; index < count; index += 1) {
    if (visited.has(cursor))
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    visited.add(cursor);
    assertRange(bytes, cursor, 16, 'OCR_RUNTIME_ELF_VERSION_TABLE_INVALID');
    const version = bytes.readUInt16LE(cursor);
    const auxiliaryCount = bytes.readUInt16LE(cursor + 2);
    const fileName = readString(BigInt(bytes.readUInt32LE(cursor + 4)));
    const auxiliaryOffset = bytes.readUInt32LE(cursor + 8);
    const nextOffset = bytes.readUInt32LE(cursor + 12);
    if (
      version !== 1 ||
      auxiliaryCount === 0 ||
      auxiliaryCount > MAX_VERSION_RECORDS ||
      !needed.includes(fileName)
    ) {
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    }
    let auxiliaryCursor = cursor + auxiliaryOffset;
    const versions = result.get(fileName) ?? new Set();
    for (let auxIndex = 0; auxIndex < auxiliaryCount; auxIndex += 1) {
      assertRange(
        bytes,
        auxiliaryCursor,
        16,
        'OCR_RUNTIME_ELF_VERSION_TABLE_INVALID',
      );
      versions.add(readString(BigInt(bytes.readUInt32LE(auxiliaryCursor + 8))));
      const auxiliaryNext = bytes.readUInt32LE(auxiliaryCursor + 12);
      if (auxIndex + 1 < auxiliaryCount) {
        if (auxiliaryNext < 16) {
          fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
        }
        auxiliaryCursor += auxiliaryNext;
      } else if (auxiliaryNext !== 0) {
        fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
      }
    }
    result.set(fileName, versions);
    if (index + 1 < count) {
      if (nextOffset < 16) fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
      cursor += nextOffset;
    } else if (nextOffset !== 0) {
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    }
  }
  return result;
}

function parseVersionDefinitions({ bytes, loads, dynamic, path, readString }) {
  const address = singletonDynamicValue(dynamic, DT_VERDEF, path);
  const countValue = singletonDynamicValue(dynamic, DT_VERDEFNUM, path);
  if ((address === null) !== (countValue === null)) {
    fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
  }
  if (address === null) return new Set();
  const count = boundedRecordCount(countValue, path);
  let cursor = mapVirtualAddress(loads, address, 20n, path);
  const result = new Set();
  const visited = new Set();
  for (let index = 0; index < count; index += 1) {
    if (visited.has(cursor))
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    visited.add(cursor);
    assertRange(bytes, cursor, 20, 'OCR_RUNTIME_ELF_VERSION_TABLE_INVALID');
    const version = bytes.readUInt16LE(cursor);
    const auxiliaryCount = bytes.readUInt16LE(cursor + 6);
    const auxiliaryOffset = bytes.readUInt32LE(cursor + 12);
    const nextOffset = bytes.readUInt32LE(cursor + 16);
    if (
      version !== 1 ||
      auxiliaryCount === 0 ||
      auxiliaryCount > MAX_VERSION_RECORDS
    ) {
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    }
    let auxiliaryCursor = cursor + auxiliaryOffset;
    for (let auxIndex = 0; auxIndex < auxiliaryCount; auxIndex += 1) {
      assertRange(
        bytes,
        auxiliaryCursor,
        8,
        'OCR_RUNTIME_ELF_VERSION_TABLE_INVALID',
      );
      if (auxIndex === 0) {
        result.add(readString(BigInt(bytes.readUInt32LE(auxiliaryCursor))));
      }
      const auxiliaryNext = bytes.readUInt32LE(auxiliaryCursor + 4);
      if (auxIndex + 1 < auxiliaryCount) {
        if (auxiliaryNext < 8) {
          fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
        }
        auxiliaryCursor += auxiliaryNext;
      } else if (auxiliaryNext !== 0) {
        fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
      }
    }
    if (index + 1 < count) {
      if (nextOffset < 20) fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
      cursor += nextOffset;
    } else if (nextOffset !== 0) {
      fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
    }
  }
  return result;
}

function boundedRecordCount(value, path) {
  const count = toSafeNumber(value, 'OCR_RUNTIME_ELF_VERSION_TABLE_INVALID');
  if (count === 0 || count > MAX_VERSION_RECORDS) {
    fail('OCR_RUNTIME_ELF_VERSION_TABLE_INVALID', path);
  }
  return count;
}

function validateLibraryName(value, path) {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value !== basename(value) ||
    value.includes('/') ||
    !/^[A-Za-z0-9_+.-]+$/u.test(value)
  ) {
    fail('OCR_RUNTIME_ELF_NEEDED_NAME_INVALID', path);
  }
}

function validateRunpath(runpath, path) {
  if (runpath === null) return;
  const entries = runpath.split(':');
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        !entry ||
        isAbsolute(entry) ||
        (entry !== '$ORIGIN' && entry !== '$ORIGIN/../lib'),
    )
  ) {
    fail('OCR_RUNTIME_ELF_RUNPATH_INVALID', path);
  }
}

async function containedRealpath(rootReal, candidate, reason) {
  const candidateReal = await realpath(candidate);
  const childRelative = relative(rootReal, candidateReal);
  if (
    childRelative === '..' ||
    childRelative.startsWith(`..${sep}`) ||
    isAbsolute(childRelative)
  ) {
    fail(reason, candidateReal);
  }
  return candidateReal;
}

async function assertRegularExecutable(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile()) fail('OCR_RUNTIME_ELF_PROGRAM_NOT_REGULAR', path);
  try {
    await access(path, fsConstants.X_OK);
  } catch {
    fail('OCR_RUNTIME_ELF_PROGRAM_NOT_EXECUTABLE', path);
  }
}

function assertBigIntFileRange(bytes, offset, size, reason) {
  const end = offset + size;
  if (end < offset || end > BigInt(bytes.length)) fail(reason);
}

function assertRange(bytes, offset, size, reason) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > bytes.length
  ) {
    fail(reason);
  }
}

function toSafeNumber(value, reason) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail(reason);
  return Number(value);
}

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}
