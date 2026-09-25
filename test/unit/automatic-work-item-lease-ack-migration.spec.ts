import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('automatic WorkItem lease acknowledgement migration', () => {
  it('stores only a token hash receipt and requires complete terminal state', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'migrations/0063_auto_work_item_lease_ack.sql'),
      'utf8',
    );

    expect(migration).toMatch(/completed_lease_token_hash varchar\(64\)/iu);
    expect(migration).toMatch(/completed_lease_generation integer/iu);
    expect(migration).toMatch(/completed_at timestamptz\(3\)/iu);
    expect(migration).toMatch(/status = 'COMPLETED'/iu);
    expect(migration).toMatch(
      /completed_lease_token_hash ~ '\^\[a-f0-9\]\{64\}\$'/iu,
    );
    expect(migration).toMatch(/completed_lease_generation > 0/iu);
    expect(migration).not.toMatch(/completed_lease_token\s+uuid/iu);
  });
});
