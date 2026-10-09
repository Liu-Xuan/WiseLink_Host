import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOwnedEndpoint } from '../pg/owned-postgres-cluster.mjs';
const expected = {
  port: 54329,
  database: 'wiselink_tdms_test_1234567890abcdef',
};
const valid = `postgres://tdms_test_owner@127.0.0.1:${expected.port}/${expected.database}`;
test('physical PG runner only accepts its own generated loopback/database endpoint', () => {
  assert.equal(validateOwnedEndpoint(valid, expected).hostname, '127.0.0.1');
});
test('external/local shared URL, query, credentials and changed instance fail before connecting', () => {
  for (const url of [
    valid.replace('127.0.0.1', 'example.com'),
    valid.replace('127.0.0.1', 'localhost'),
    valid.replace(expected.database, 'production'),
    valid + '?host=elsewhere',
    valid + '#x',
    valid.replace('tdms_test_owner@', 'tdms_test_owner:secret@'),
    valid.replace('54329', '54330'),
  ])
    assert.throws(
      () => validateOwnedEndpoint(url, expected),
      /OWNED_ENDPOINT_REQUIRED/,
    );
});
