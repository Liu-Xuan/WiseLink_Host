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
