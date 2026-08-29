import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { canonicalize, runVectors } from "../scripts/jcs.mjs";

test("shared JCS vectors match", () => {
  const report = runVectors(new URL("../fixtures/canonicalization/jcs-test-vectors.json", import.meta.url));
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.count, 6);
});

test("restricted numeric domain rejects floats and unsafe integers", () => {
  assert.throws(() => canonicalize(1.5), /safe integers/);
  assert.throws(() => canonicalize(Number.MAX_SAFE_INTEGER + 1), /safe integers/);
});

test("lone surrogates are rejected", () => {
  assert.throws(() => canonicalize("\ud800"), /lone high surrogate/);
  assert.throws(() => canonicalize("\udc00"), /lone low surrogate/);
});

test("vector source itself is valid JSON", () => {
  const path = new URL("../fixtures/canonicalization/jcs-test-vectors.json", import.meta.url);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path, "utf8")));
});
