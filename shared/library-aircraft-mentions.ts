/**
 * Document classification aliases only. Fleet IDs and parent/child relationships
 * remain exactly those supplied by the authoritative catalog. The fleet import
 * uses B787-9 while publication metadata uses 787-9; recognize that explicit
 * Boeing naming convention without stripping arbitrary manufacturer letters.
 */
export function libraryAircraftMentionAliases(value: string): string[] {
  const normalized = value.trim().toUpperCase();
  const boeing = /^B?(7[0-8]7(?:-[A-Z0-9]+)?)$/u.exec(normalized);
  return boeing
    ? [...new Set([normalized, boeing[1], `B${boeing[1]}`])]
    : [normalized];
}

export const LIBRARY_AIRCRAFT_MODEL_UNION_LIMIT = 32;
/** JSON string literals can double each permitted code unit through quote/backslash escaping. */
export const LIBRARY_AIRCRAFT_MODELS_QUERY_LIMIT = LIBRARY_AIRCRAFT_MODEL_UNION_LIMIT * (96 * 2 + 3) + 2;
/** Encoded ASCII query budgets leave room for the <=2048-char cursor, path and HTTP headers. */
export const LIBRARY_AIRCRAFT_MODELS_URL_BUDGET = 1800;
export const LIBRARY_CATALOG_UNION_QUERY_BUDGET = 3500;
export const LIBRARY_CATALOG_PAGED_QUERY_BUDGET = 6144;

/** Canonicalize a filter set only; source observations and document IDs stay intact. */
export function libraryAircraftModelUnion(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > LIBRARY_AIRCRAFT_MODEL_UNION_LIMIT ||
      value.some((model: unknown) => typeof model !== 'string' || !model.trim() ||
        model.length > 96 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(model)))
    throw new Error('LIBRARY_AIRCRAFT_MODELS_INVALID');
  const models = [...new Set(value.map((model: string) => model.trim()))].sort();
  if (new URLSearchParams({ aircraftModels: JSON.stringify(models) }).toString().length > LIBRARY_AIRCRAFT_MODELS_URL_BUDGET)
    throw new Error('LIBRARY_AIRCRAFT_MODELS_TOO_LONG');
  return models;
}

export function libraryAircraftModelsQuery(value: string | null | undefined): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (value.length > LIBRARY_AIRCRAFT_MODELS_QUERY_LIMIT) throw new Error('LIBRARY_AIRCRAFT_MODELS_INVALID');
  try { return libraryAircraftModelUnion(JSON.parse(value)); }
  catch (error: unknown) {
    throw new Error(error instanceof Error && error.message === 'LIBRARY_AIRCRAFT_MODELS_TOO_LONG'
      ? error.message : 'LIBRARY_AIRCRAFT_MODELS_INVALID');
  }
}

/** The exact HTTP serializer and budget are shared by the caller and both Host GETs. */
export function libraryCatalogueQuery(input: object): string {
  const query = new URLSearchParams();
  let union = false;
  for (const [key, value] of Object.entries(input)) {
    if (key === 'aircraftModels') {
      if (value === undefined) continue;
      query.set(key, JSON.stringify(libraryAircraftModelUnion(value))); union = true;
    } else if (value !== undefined && value !== null && value !== '' &&
        (typeof value === 'string' || typeof value === 'number')) query.set(key, String(value));
  }
  if (union) {
    const firstQuery = new URLSearchParams(query); firstQuery.delete('cursor');
    if (firstQuery.toString().length > LIBRARY_CATALOG_UNION_QUERY_BUDGET ||
        query.toString().length > LIBRARY_CATALOG_PAGED_QUERY_BUDGET)
      throw new Error('LIBRARY_CATALOG_QUERY_TOO_LONG');
  }
  return query.toString();
}
