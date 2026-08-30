export interface S1000dXmlElement {
  readonly qualifiedName: string;
  readonly localName: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly S1000dXmlElement[];
  readonly text: string;
}

interface MutableXmlElement {
  qualifiedName: string;
  localName: string;
  attributes: Record<string, string>;
  children: MutableXmlElement[];
  textParts: string[];
}

const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_XML_DEPTH = 256;
const MAX_XML_ELEMENTS = 200_000;
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/u;

/**
 * Single, dependency-free XML runtime for the S1000D adapter. It is deliberately
 * non-validating: the producer separately binds each module to an authorized
 * local XSD. DTDs and custom entities are rejected so FileService bytes cannot
 * trigger external resolution or entity expansion.
 */
export function parseS1000dXml(
  bytes: Uint8Array,
  normalizedPath: string,
): S1000dXmlElement {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_XML_BYTES) {
    throw xmlError('BYTE_LENGTH', normalizedPath);
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw xmlError('UTF8', normalizedPath);
  }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw xmlError('DTD_OR_ENTITY_DECLARATION', normalizedPath);
  }
  const declaration = xml.match(/^\s*<\?xml\s+([^?]+)\?>/iu);
  const declaredEncoding = declaration?.[1].match(
    /\bencoding\s*=\s*(['"])([^'"]+)\1/iu,
  )?.[2];
  if (declaredEncoding && !/^utf-?8$/iu.test(declaredEncoding)) {
    throw xmlError('ENCODING', normalizedPath);
  }

  const roots: MutableXmlElement[] = [];
  const stack: MutableXmlElement[] = [];
  let elementCount = 0;
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) {
      appendText(xml.slice(cursor), stack, roots, normalizedPath);
      break;
    }
    appendText(xml.slice(cursor, open), stack, roots, normalizedPath);
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) throw xmlError('COMMENT', normalizedPath);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end < 0) throw xmlError('PROCESSING_INSTRUCTION', normalizedPath);
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0 || stack.length === 0) {
        throw xmlError('CDATA', normalizedPath);
      }
      stack[stack.length - 1].textParts.push(xml.slice(open + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('</', open)) {
      const end = xml.indexOf('>', open + 2);
      if (end < 0) throw xmlError('CLOSE_TAG', normalizedPath);
      const name = xml.slice(open + 2, end).trim();
      if (!XML_NAME.test(name) || stack.at(-1)?.qualifiedName !== name) {
        throw xmlError('TAG_BALANCE', normalizedPath);
      }
      stack.pop();
      cursor = end + 1;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      throw xmlError('DECLARATION', normalizedPath);
    }

    const end = tagEnd(xml, open + 1, normalizedPath);
    const raw = xml.slice(open + 1, end);
    const selfClosing = /\/\s*$/u.test(raw);
    const body = selfClosing ? raw.replace(/\/\s*$/u, '') : raw;
    const parsed = parseStartTag(body, normalizedPath);
    const element: MutableXmlElement = {
      ...parsed,
      localName: localName(parsed.qualifiedName),
      children: [],
      textParts: [],
    };
    elementCount += 1;
    if (elementCount > MAX_XML_ELEMENTS || stack.length >= MAX_XML_DEPTH) {
      throw xmlError('LIMIT', normalizedPath);
    }
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else roots.push(element);
    if (!selfClosing) stack.push(element);
    cursor = end + 1;
  }
  if (stack.length !== 0 || roots.length !== 1) {
    throw xmlError('DOCUMENT_ELEMENT', normalizedPath);
  }
  return freezeElement(roots[0]);
}

export function xmlChildren(
  element: S1000dXmlElement,
  name: string,
): S1000dXmlElement[] {
  return element.children.filter((child) => child.localName === name);
}

export function xmlDescendants(
  element: S1000dXmlElement,
  name: string,
): S1000dXmlElement[] {
  const result: S1000dXmlElement[] = [];
  const visit = (current: S1000dXmlElement): void => {
    for (const child of current.children) {
      if (child.localName === name) result.push(child);
      visit(child);
    }
  };
  visit(element);
  return result;
}

export function xmlFirst(
  element: S1000dXmlElement,
  name: string,
): S1000dXmlElement | null {
  return xmlDescendants(element, name)[0] ?? null;
}

export function xmlText(element: S1000dXmlElement): string {
  const values: string[] = [element.text];
  for (const child of element.children) values.push(xmlText(child));
  return values.join(' ').replace(/\s+/gu, ' ').trim();
}

export function xmlAttribute(
  element: S1000dXmlElement,
  name: string,
): string | null {
  const direct = element.attributes[name];
  if (direct !== undefined) return direct;
  const match = Object.entries(element.attributes).find(
    ([key]) => localName(key) === name,
  );
  return match?.[1] ?? null;
}

function appendText(
  raw: string,
  stack: MutableXmlElement[],
  roots: MutableXmlElement[],
  normalizedPath: string,
): void {
  if (!raw) return;
  const value = decodeEntities(raw, normalizedPath);
  if (stack.length === 0) {
    if (value.trim() || roots.length > 1) {
      throw xmlError('TEXT_OUTSIDE_ROOT', normalizedPath);
    }
    return;
  }
  stack[stack.length - 1].textParts.push(value);
}

function tagEnd(xml: string, start: number, normalizedPath: string): number {
  let quote = '';
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  throw xmlError('OPEN_TAG', normalizedPath);
}

function parseStartTag(
  raw: string,
  normalizedPath: string,
): Pick<MutableXmlElement, 'qualifiedName' | 'attributes'> {
  const nameMatch = raw.match(/^\s*([^\s/>]+)/u);
  const qualifiedName = nameMatch?.[1] ?? '';
  if (!XML_NAME.test(qualifiedName)) throw xmlError('NAME', normalizedPath);
  const attributes: Record<string, string> = {};
  let rest = raw.slice(nameMatch?.[0].length ?? 0);
  while (rest.trim()) {
    const match = rest.match(/^\s*([^\s=/>]+)\s*=\s*(['"])([\s\S]*?)\2/u);
    if (!match || !XML_NAME.test(match[1]) || match[1] in attributes) {
      throw xmlError('ATTRIBUTE', normalizedPath);
    }
    attributes[match[1]] = decodeEntities(match[3], normalizedPath);
    rest = rest.slice(match[0].length);
  }
  return { qualifiedName, attributes };
}

function decodeEntities(value: string, normalizedPath: string): string {
  return value.replace(/&([^;]+);/gu, (_match, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const numeric = entity.match(/^#(x[0-9a-f]+|[0-9]+)$/iu);
    if (!numeric) throw xmlError('ENTITY', normalizedPath);
    const codePoint = numeric[1].toLowerCase().startsWith('x')
      ? Number.parseInt(numeric[1].slice(1), 16)
      : Number.parseInt(numeric[1], 10);
    if (
      !Number.isSafeInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw xmlError('ENTITY_CODE_POINT', normalizedPath);
    }
    return String.fromCodePoint(codePoint);
  });
}

function freezeElement(value: MutableXmlElement): S1000dXmlElement {
  return {
    qualifiedName: value.qualifiedName,
    localName: value.localName,
    attributes: Object.freeze({ ...value.attributes }),
    children: Object.freeze(value.children.map(freezeElement)),
    text: value.textParts.join(''),
  };
}

function localName(value: string): string {
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
}

function xmlError(
  reason: string,
  normalizedPath: string,
): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error(
      `S1000D XML is unsupported or malformed (${normalizedPath}:${reason}).`,
    ),
    { code: 'S1000D_XML_PARSE_REJECTED', statusCode: 409 },
  );
}
