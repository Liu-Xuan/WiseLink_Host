import { runtimeBuildModuleUrl } from '@client/src/config/runtime-build-module-url';

export interface RuntimeBuildFingerprint {
  sourceCommit: string;
  buildTime: string;
  visualVersion: string;
}

const FRONTEND_APP_ID = 'app_17bzc551rsg';
const FRONTEND_ASSET_ORIGIN = 'https://lf-miaoda-static.feishucdn.com';
const UNKNOWN_SOURCE_COMMIT = 'UNAVAILABLE';

function verifiedCommit(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{40}$/iu.test(value)
    ? value.toLowerCase() : null;
}

/** Only this application's exact official JS namespace can identify its source. */
function ownAssetCommit(raw: string): { commit: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // Malformed resource metadata is not source evidence.
  }
  const prefix: string = `/${FRONTEND_APP_ID}/`;
  if (url.origin !== FRONTEND_ASSET_ORIGIN || !url.pathname.startsWith(prefix))
    return null;
  if (url.username || url.password || url.search || url.hash)
    return { commit: null };
  const match: RegExpMatchArray | null = url.pathname.slice(prefix.length)
    .match(/^([a-f0-9]{40})\/client\/assets\/[a-zA-Z0-9_-]+[.]js$/u);
  return { commit: match?.[1] ?? null };
}

/** Timing records may expose mixed/failed imports, but never prove execution. */
function completedScriptResources(): PerformanceResourceTiming[] {
  if (typeof performance === 'undefined' ||
    typeof performance.getEntriesByType !== 'function') return [];
  return performance.getEntriesByType('resource')
    .filter((entry: PerformanceEntry): entry is PerformanceResourceTiming => entry.entryType === 'resource')
    .filter((entry: PerformanceResourceTiming) => entry.initiatorType === 'script');
}

function frontendSourceCommit(configured: unknown): string {
  const metadata: string | null = verifiedCommit(configured);
  // import.meta.url belongs to this executed module, unlike a pending DOM script.
  const executed: { commit: string | null } | null = typeof runtimeBuildModuleUrl === 'string'
    ? ownAssetCommit(runtimeBuildModuleUrl) : null;
  if (executed && !executed.commit) return UNKNOWN_SOURCE_COMMIT;
  const source: string | null = metadata ?? executed?.commit ?? null;
  if (!source || (metadata && executed?.commit && metadata !== executed.commit))
    return UNKNOWN_SOURCE_COMMIT;
  for (const entry of completedScriptResources()) {
    const asset: { commit: string | null } | null = ownAssetCommit(entry.name);
    if (!asset) continue;
    const status: unknown = Reflect.get(entry, 'responseStatus');
    if (!asset.commit || asset.commit !== source ||
      (typeof status === 'number' && status >= 400)) return UNKNOWN_SOURCE_COMMIT;
  }
  return source;
}

const configuredSourceCommit: string | null =
  typeof __WISELINK_SOURCE_COMMIT__ === 'string' ? __WISELINK_SOURCE_COMMIT__ : null;

export const runtimeBuildFingerprint: RuntimeBuildFingerprint = {
  // Read again after lazy imports so a later mixed namespace cannot remain hidden.
  get sourceCommit(): string {
    return frontendSourceCommit(configuredSourceCommit);
  },
  buildTime:
    typeof __WISELINK_BUILD_TIME__ === 'string'
      ? __WISELINK_BUILD_TIME__
      : 'UNAVAILABLE',
  visualVersion:
    typeof __WISELINK_VISUAL_VERSION__ === 'string'
      ? __WISELINK_VISUAL_VERSION__
      : 'UNAVAILABLE',
};
