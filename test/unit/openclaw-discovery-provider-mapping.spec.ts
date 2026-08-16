import {
  isOfficialOemCandidateUrl,
  mapHostedOpenClawDiscoveryResult,
} from '../../server/modules/document-management/src/hosted/openClawDiscoveryProviderMapping';

describe('DM Phase 13D hosted OpenClaw provider mapping', () => {
  it.each([
    ['BOEING', 'UPSTREAM_CONNECT_TIMEOUT'],
    ['AIRBUS', 'ROBOTS_WAF_BLOCKED'],
  ] as const)(
    'maps %s access denial with its real failure instead of ZERO',
    (provider, failureCode) => {
      const mapped = mapHostedOpenClawDiscoveryResult({
        searchRunRef: `search:${provider.toLowerCase()}:denied`,
        observedAt: '2026-08-16T12:00:00.000Z',
        providerResult: {
          provider,
          query: `${provider} controlled technical publication`,
          resultStatus: 'ACCESS_DENIED',
          accessRestricted: true,
          truncated: false,
          partialOnly: false,
          failureCode,
          candidates: [],
        },
      });

      expect(mapped).toMatchObject({
        resultStatus: 'ACCESS_DENIED',
        accessRestricted: true,
        failureCode,
        candidates: [],
      });
      expect(mapped.resultStatus).not.toBe('ZERO_RESULTS_FOR_TARGET_IDENTIFIER');
    },
  );

  it('keeps COMAC official-list/RSS incompleteness explicit and does not elevate Baidu', () => {
    const mapped = mapHostedOpenClawDiscoveryResult({
      searchRunRef: 'search:comac:partial',
      observedAt: '2026-08-16T12:01:00.000Z',
      providerResult: {
        provider: 'COMAC',
        query: 'COMAC official technical publication RSS',
        resultStatus: 'PARTIAL_RESULTS',
        accessRestricted: false,
        truncated: true,
        partialOnly: true,
        failureCode: 'NON_OFFICIAL_SEARCH_REDIRECT',
        candidates: [
          {
            title: 'Baidu redirect',
            sourceUrl: 'https://www.baidu.com/s?wd=COMAC',
            matchLevel: 'TANGENTIAL',
          },
        ],
      },
    });

    expect(mapped).toMatchObject({
      resultStatus: 'PARTIAL_RESULTS',
      failureCode: 'NON_OFFICIAL_SEARCH_REDIRECT',
      partialOnly: true,
      truncated: true,
    });
    expect(isOfficialOemCandidateUrl('COMAC', mapped.candidates[0]?.url)).toBe(
      false,
    );
  });

  it('maps a complete Airbus direct official result without adopting it', () => {
    const mapped = mapHostedOpenClawDiscoveryResult({
      searchRunRef: 'search:airbus:fast62',
      observedAt: '2026-08-16T12:02:00.000Z',
      providerResult: {
        provider: 'AIRBUS',
        query: 'Airbus FAST 62',
        resultStatus: 'CANDIDATES_FOUND',
        accessRestricted: false,
        truncated: false,
        partialOnly: false,
        candidates: [
          {
            title: 'FAST issue 62',
            sourceUrl: 'https://www.airbus.com/en/newsroom/stories/fast-62',
            matchLevel: 'DIRECT',
          },
        ],
      },
    });

    expect(mapped.candidates[0]).toMatchObject({
      publisher: 'AIRBUS',
      disposition: 'DIRECT_OFFICIAL_SOURCE_MATCH',
    });
    expect(isOfficialOemCandidateUrl('AIRBUS', mapped.candidates[0]?.url)).toBe(
      true,
    );
  });
});
