function text(value) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Source observations only. Identity/currentness remain owned by the ingress owner. */
export function extractActualPdfMetadata({
  layout,
  actualSha256,
  actualByteLength,
  identity,
  extractedAt = new Date().toISOString(),
}) {
  const pages = new Map();
  for (const run of layout?.textRuns || []) {
    const page = Number(run.page);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > layout.pageCount ||
      !text(run.text)
    )
      continue;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push({ text: text(run.text), y: Number(run.y) });
  }
  const fields = Object.fromEntries(
    ['title', 'documentType', 'issuer', 'ata', 'mentionedAircraftModels'].map(
      (key) => [key, { status: 'NOT_FOUND', observations: [] }],
    ),
  );
  function add(key, value, page, excerpt) {
    const normalized = text(value);
    if (!normalized) return;
    const field = fields[key];
    field.status = 'PENDING_REVIEW';
    let observation = field.observations.find(
      (item) => item.value === normalized,
    );
    if (!observation) {
      observation = {
        value: normalized,
        status: 'PENDING_REVIEW',
        evidence: [],
      };
      field.observations.push(observation);
    }
    if (
      !observation.evidence.some(
        (item) => item.page === page && item.text === excerpt,
      )
    ) {
      observation.evidence.push({ page, text: excerpt });
    }
  }
  const typePatterns = {
    SB: /\b(?:alert\s+)?service\s+bulletin\b/iu,
    SL: /\bservice\s+letter\b/iu,
    FTD: /\bfleet\s+team\s+digest\b/iu,
    SIL: /\bservice\s+information\s+letter\b/iu,
    RIL: /\brepair\s+information\s+letter\b/iu,
    AOT: /\balert\s+operators?\s+transmission\b/iu,
    OIT: /\boperators?\s+information\s+transmission\b/iu,
    FOT: /\bflight\s+operations?\s+transmission\b/iu,
  };
  for (const [page, runs] of pages) {
    const pageText = runs.map((run) => run.text).join(' ');
    const lines = [];
    for (const run of runs) {
      const previous = lines.at(-1);
      if (
        previous &&
        Number.isFinite(run.y) &&
        Math.abs(previous.y - run.y) < 2
      )
        previous.text += ` ${run.text}`;
      else lines.push({ ...run });
    }
    // A labelled title can be split into PDF text runs. Stop at the next label.
    if (page <= 3) {
      for (const [index, line] of lines.entries()) {
        const label = line.text.match(
          /\b(?:issue\s+title|subject|title)\s*:\s*(.*)/iu,
        );
        if (!label) continue;
        const value = (label[1] || lines[index + 1]?.text || '').split(
          /\s+(?:Reference|References|ATA|Date|Revision|Number|Applicability|Effectivity|Summary|Description|Status|Background)\s*:/iu,
        )[0];
        if (value.length >= 3 && value.length <= 350)
          add(
            'title',
            value,
            page,
            label[1] ? line.text : `${line.text} ${value}`,
          );
      }
      const typePattern = typePatterns[identity?.documentFamily];
      const typeMatch = typePattern && pageText.match(typePattern);
      if (typeMatch)
        add('documentType', identity.documentFamily, page, typeMatch[0]);
      const issuer = text(identity?.issuer);
      const issuerIndex = issuer
        ? pageText.toUpperCase().indexOf(issuer.toUpperCase())
        : -1;
      if (issuerIndex >= 0)
        add(
          'issuer',
          issuer,
          page,
          pageText.slice(
            Math.max(0, issuerIndex - 35),
            issuerIndex + issuer.length + 50,
          ),
        );
    }
    for (const match of pageText.matchAll(
      /\bATA(?:\s+(?:CHAPTER|CHAP(?:TER)?\.?|SYSTEM|NO\.?))?\s*[:#-]?\s*(\d{2}(?:-\d{2}(?:-\d{2})?)?)\b/giu,
    )) {
      add('ata', match[1], page, match[0]);
    }
    for (const match of pageText.matchAll(
      /\b(?:A(?:220|300|310|318|319|320|321|330|340|350|380)(?:[ -]?(?:\d{3}|NEO|CEO))?|(?:B(?:OEING)?\s*)?(?:707|717|727|737|747|757|767|777|787)(?:[ -]?(?:MAX(?:[ -]?(?:7|8|9|10))?|NG|(?:[1-9]00|7|8|9|10)(?:ER|LR)?))?)\b/giu,
    )) {
      add(
        'mentionedAircraftModels',
        match[0]
          .toUpperCase()
          .replace(/^BOEING\s*/u, 'B')
          .replace(/\s+/gu, ' '),
        page,
        pageText.slice(
          Math.max(0, match.index - 45),
          match.index + match[0].length + 65,
        ),
      );
    }
  }
  return {
    schemaVersion: 'wiselink.document_metadata.v1',
    source: 'ACTUAL_PDF_TEXT',
    sourceSha256: actualSha256,
    sourceByteLength: actualByteLength,
    pageCount: layout.pageCount,
    inspectedPages: [...pages.keys()].sort((a, b) => a - b),
    extractedAt,
    ...fields,
    aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
    applicabilityAssessment: 'NOT_EVALUATED',
  };
}
