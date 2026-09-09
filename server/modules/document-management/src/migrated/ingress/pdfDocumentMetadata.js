function text(value) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

// Publication-module cover pages place the subject between their primary
// publication heading and the Publication/Issue row, without a Subject label.
function boeingPublicationTitle(lines, identity) {
  if (identity?.issuer !== 'BOEING' || identity?.documentFamily !== 'SB')
    return null;
  for (const [index, line] of lines.entries()) {
    const heading = line.text.match(
      /^Service Bulletin\s+(B787-\d{5}-SB\d{6}-\d{2})\s+(.+)$/iu,
    );
    if (!heading) continue;
    const continuation = [];
    for (const next of lines.slice(index + 1, index + 6)) {
      if (
        /\bPublication\s*:/iu.test(next.text) ||
        /^Issue\s+\d/iu.test(next.text)
      ) {
        // The primary identity must also occur in the adjacent publication row.
        if (!next.text.includes(heading[1])) break;
        return {
          value: [heading[2], ...continuation].join(' '),
          evidence: [line.text, ...continuation].join(' '),
        };
      }
      if (/\b(?:Copyright|BOEING PROPRIETARY|TITLE PAGE)\b/iu.test(next.text))
        break;
      continuation.push(next.text);
    }
  }
  return null;
}

function labelledTitle(lines, index, label) {
  const line = lines[index];
  const value = (label[1] || lines[index + 1]?.text || '').split(
    /\s+(?:Reference|References|ATA|Date|Revision|Number|Applicability|Effectivity|Summary|Description|Status|Background)\s*:/iu,
  )[0];
  const result = {
    value,
    evidence: label[1] ? line.text : `${line.text} ${value}`,
  };
  // In the proven two-column SUBJECT block, the value starts in a separate
  // PDF run to the right of the label. Follow only tightly spaced continuation
  // lines aligned to that value column, stopping before the next section.
  const labelIndex = line.runs.findIndex((run) =>
    /\b(?:issue\s+title|subject|title)\s*:\s*$/iu.test(run.text),
  );
  const labelRun = line.runs[labelIndex];
  const valueRun = line.runs[labelIndex + 1];
  if (
    labelIndex < 0 ||
    !valueRun ||
    !Number.isFinite(valueRun.x) ||
    valueRun.x <= labelRun.x ||
    !Number.isFinite(valueRun.fontSize) ||
    valueRun.fontSize <= 0
  )
    return result;
  let previous = line;
  for (const next of lines.slice(index + 1)) {
    const gap = previous.y - next.y;
    if (
      !Number.isFinite(gap) ||
      gap <= 0 ||
      gap > valueRun.fontSize * 1.6 ||
      Math.abs(next.x - valueRun.x) > 2 ||
      Math.abs(next.fontSize - valueRun.fontSize) > 0.5 ||
      /^(?:[A-Z][A-Z /-]*:|EXPORT CONTROLLED|BOEING PROPRIETARY|Copyright)(?=\s|$)/u.test(
        next.text,
      )
    )
      break;
    if (result.value.length + next.text.length + 1 > 350) break;
    result.value += ` ${next.text}`;
    result.evidence += ` ${next.text}`;
    previous = next;
  }
  return result;
}

function trademarkDeclarationRanges(pageText) {
  return [
    ...pageText.matchAll(
      /[^.!?]*\b(?:are|is)\s+(?:all\s+)?(?:registered\s+)?trademarks?\s+(?:owned\s+by|of)\b[^.!?]*(?:[.!?]|$)/giu,
    ),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
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
    pages
      .get(page)
      .push({
        text: text(run.text),
        x: Number(run.x),
        y: Number(run.y),
        fontSize: Number(run.fontSize),
      });
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
      ) {
        previous.text += ` ${run.text}`;
        previous.runs.push(run);
      } else lines.push({ ...run, runs: [run] });
    }
    const publicationTitle =
      page === 1 ? boeingPublicationTitle(lines, identity) : null;
    if (publicationTitle)
      add('title', publicationTitle.value, page, publicationTitle.evidence);
    // A labelled title can be split into PDF text runs. Stop at the next label.
    if (page <= 3) {
      for (const [index, line] of lines.entries()) {
        const label = line.text.match(
          /\b(?:issue\s+title|subject|title)\s*:\s*(.*)/iu,
        );
        if (!label) continue;
        const title = labelledTitle(lines, index, label);
        if (title.value.length >= 3 && title.value.length <= 350)
          add('title', title.value, page, title.evidence);
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
      /\bATA(?:\s+(?:CHAPTER|CHAP(?:TER)?\.?|SYSTEM|NO\.?))?\s*[:#-]?\s*(\d{6}|\d{4}|\d{2}(?:-\d{2}(?:-\d{2})?)?)\b/giu,
    )) {
      add('ata', match[1], page, match[0]);
    }
    const trademarkRanges = trademarkDeclarationRanges(pageText);
    // Numeric variants require a written separator. A bare 7077 is a number,
    // not evidence for 707-7. Preserve explicit slash lists as one source phrase.
    for (const match of pageText.matchAll(
      /\b(?:A(?:220|300|310|318|319|320|321|330|340|350|380)(?:[ -]?(?:\d{3}|NEO|CEO))?|(?:B(?:OEING)?\s*)?(?:707|717|727|737|747|757|767|777|787)(?:[ -]?(?:MAX(?:[ -]?(?:7|8|9|10))?|NG)|[ -](?:8200|[1-9]00|10|7|8|9)(?:ER|LR)?(?:\/(?:8200|[1-9]00|10|7|8|9)(?:ER|LR)?)*)?)\b/giu,
    )) {
      if (
        trademarkRanges.some(
          (range) => match.index >= range.start && match.index < range.end,
        )
      )
        continue;
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
