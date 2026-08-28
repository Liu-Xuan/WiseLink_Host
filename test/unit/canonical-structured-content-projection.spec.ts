import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CanonicalStructuredContentUnit,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { projectCanonicalStructuredContentUnit } from '../../server/modules/canonical-host/canonical-structured-content-projection';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

describe('canonical structured-content browser projection', () => {
  it('turns the exact real 737 frozen.2 package into readable sections and source text without internal JSON', async () => {
    const bytes: Uint8Array = new Uint8Array(
      await readFile(
        resolve(
          'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
        ),
      ),
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      packageId: string;
    };
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://test/real-737-frozen-2',
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const sourceUnits = new Frozen2CandidateReaderService().readAllSourceUnits(
      artifact,
      bytes,
    );
    const displayed: CanonicalStructuredContentUnit[] = sourceUnits
      .map((unit, index) =>
        projectCanonicalStructuredContentUnit(unit, index + 1),
      )
      .filter((unit): unit is CanonicalStructuredContentUnit => unit !== null);

    expect(parsed.packageId).toMatch(/^urn:techpub:package:v1:sha256:/u);
    expect(sourceUnits).toHaveLength(75);
    expect(displayed).toHaveLength(58);
    expect(
      displayed.reduce<Record<string, number>>((counts, unit) => {
        counts[unit.displayKind] = (counts[unit.displayKind] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ section: 18, unavailable: 2, body: 38 });
    expect(displayed[0]).toMatchObject({
      ordinal: 1,
      displayKind: 'section',
      outlineKind: 'SECTION',
      sectionTitle: 'Concurrent Requirements',
      displayText: 'Concurrent Requirements',
    });
    expect(displayed.some((unit) => unit.ordinal === 2)).toBe(false);
    expect(displayed.at(-1)).toMatchObject({
      ordinal: 75,
      displayKind: 'body',
      outlineKind: 'NONE',
    });
    expect(displayed.at(-1)?.displayText).toContain(
      'FLIGHT MANAGEMENT COMPUTER',
    );
    expect(displayed.at(-1)?.displayText).not.toContain('reasonCode');

    const browserPayload: string = JSON.stringify(displayed);
    expect(browserPayload).not.toMatch(
      /observationType|authority|candidateOnly|windowId|reasonCode/iu,
    );
    expect(Object.keys(displayed[0].sourceLocators[0]).sort()).toEqual(
      ['kind', 'pageEnd', 'pageStart', 'quote', 'sourceRefId'].sort(),
    );
    expect(
      displayed
        .flatMap((unit) => unit.sourceLocators)
        .every(
          (locator) => locator.quote === null || locator.quote.length <= 320,
        ),
    ).toBe(true);
  });
});
