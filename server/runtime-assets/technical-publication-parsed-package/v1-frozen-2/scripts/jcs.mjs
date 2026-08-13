#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SAFE_INTEGER_MAX = 9_007_199_254_740_991;

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("lone high surrogate is not permitted");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("lone low surrogate is not permitted");
    }
  }
}

export function canonicalize(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_INTEGER_MAX) {
      throw new TypeError("hash-critical numbers must be safe integers");
    }
    return String(value);
  }
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    for (const key of keys) assertUnicodeScalarString(key);
    keys.sort();
    return `{${keys
      .map((key) => `${canonicalize(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`unsupported JSON type: ${typeof value}`);
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function runVectors(vectorPath) {
  const document = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
  const failures = [];
  const results = [];
  for (const vector of document.vectors) {
    const actualCanonical = canonicalize(vector.input);
    const actualHash = sha256(actualCanonical);
    const ok =
      actualCanonical === vector.expectedCanonicalUtf8 &&
      actualHash === vector.expectedSha256;
    results.push({ name: vector.name, ok, sha256: actualHash });
    if (!ok) {
      failures.push({
        name: vector.name,
        expectedCanonicalUtf8: vector.expectedCanonicalUtf8,
        actualCanonicalUtf8: actualCanonical,
        expectedSha256: vector.expectedSha256,
        actualSha256: actualHash,
      });
    }
  }
  return { ok: failures.length === 0, count: results.length, results, failures };
}

function main(argv) {
  const vectorIndex = argv.indexOf("--vectors");
  if (vectorIndex === -1 || !argv[vectorIndex + 1]) {
    process.stderr.write("usage: node scripts/jcs.mjs --vectors <path>\n");
    return 2;
  }
  const report = runVectors(argv[vectorIndex + 1]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
