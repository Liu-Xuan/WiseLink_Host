import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CanonicalStructuredContentUnit,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { projectCanonicalStructuredContentUnit } from '../../server/modules/canonical-host/canonical-structured-content-projection';
import { deriveCanonicalReferenceMentionPreview } from '../../server/modules/canonical-host/canonical-reference-mention-preview';
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

    const referenceMentions = deriveCanonicalReferenceMentionPreview(
      displayed,
      '737-34-3830',
      sourceUnits,
    );
    expect(referenceMentions.length).toBeGreaterThan(4);
    expect(referenceMentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedTarget: '737MAX-FTD-34-18008',
          documentType: 'FTD',
          targetApplicability: 'NOT_EVALUATED',
        }),
        expect.objectContaining({
          normalizedTarget: '737-SL-34-267',
          documentType: 'SL',
        }),
        expect.objectContaining({
          normalizedTarget: '2907C-34-7',
          documentType: 'SB',
        }),
        expect.objectContaining({
          documentType: 'AMM',
          contextRole: 'PROCEDURE_SUPPORT',
        }),
      ]),
    );
    expect(
      referenceMentions.some(
        (mention) => mention.normalizedTarget === '737-34-3830',
      ),
    ).toBe(false);
    expect(
      new Set(referenceMentions.map((mention) => mention.mentionId)).size,
    ).toBe(referenceMentions.length);
    expect(
      referenceMentions.find(
        (mention) => mention.normalizedTarget === '737MAX-FTD-34-18008',
      )?.sourceLocators[0],
    ).toMatchObject({ pageStart: 5 });
    expect(
      referenceMentions.some((mention) =>
        mention.normalizedTarget.endsWith('AMM 34-61-00'),
      ),
    ).toBe(true);
  });

  it('uses the real legacy FTD reference rows as precise occurrence owners', async () => {
    const bytes = new Uint8Array(
      await readFile(resolve('test/fixtures/real-ftd-frozen2.unified-package.json')),
    );
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://test/real-ftd-frozen-2',
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const sourceUnits = new Frozen2CandidateReaderService().readAllSourceUnits(
      artifact,
      bytes,
    );
    const displayed = sourceUnits
      .map((unit, index) =>
        projectCanonicalStructuredContentUnit(unit, index + 1),
      )
      .filter((unit): unit is CanonicalStructuredContentUnit => unit !== null);
    const mentions = deriveCanonicalReferenceMentionPreview(
      displayed,
      '777-FTD-31-21002',
      sourceUnits,
    );
    const structured = mentions.filter((mention) =>
      mention.mentionId.includes('-structured-'),
    );

    expect(structured).toHaveLength(15);
    expect(structured.map((mention) => mention.normalizedTarget)).toEqual(
      expect.arrayContaining([
        '777-31A0391',
        'D201009000032',
        '777-23-61',
        '777-SL-31-064',
      ]),
    );
    expect(new Set(structured.map((mention) => mention.documentType))).toEqual(
      new Set(['SB', 'SIL', 'FTD', 'FOTB', 'SL']),
    );
    expect(
      structured.every(
        (mention) =>
          mention.sourceRefIds.length > 0 &&
          mention.sourceLocators[0]?.quote?.includes(
            mention.normalizedTarget,
          ),
      ),
    ).toBe(true);
  });

  it('normalizes the reference text produced by the real FTD intake path', () => {
    const displayed: CanonicalStructuredContentUnit[] = [
      {
        ordinal: 1,
        displayKind: 'body',
        outlineKind: 'NONE',
        sectionTitle: null,
        displayText:
          'Pleasereferto FTD-31-21002 and FTD-23-20001formoreinformation. Service Letter (SL) 777-SL-31-064 is related.',
        sourceRefIds: ['src-real-ftd'],
        sourceLocators: [],
      },
    ];

    const mentions = deriveCanonicalReferenceMentionPreview(
      displayed,
      '777-FTD-31-21002',
    );

    expect(mentions.map((mention) => mention.normalizedTarget)).toEqual([
      '777-FTD-23-20001',
      '777-SL-31-064',
    ]);
    expect(mentions[0].contextRole).toBe('RELATED_INFORMATION');
    expect(mentions.map((mention) => mention.matchedText).join(' ')).not.toMatch(
      /formoreinformation/iu,
    );
  });
});
