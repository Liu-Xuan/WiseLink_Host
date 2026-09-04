export interface RuntimeBuildFingerprint {
  sourceCommit: string;
  buildTime: string;
  visualVersion: string;
}

export const runtimeBuildFingerprint: RuntimeBuildFingerprint = {
  sourceCommit:
    typeof __WISELINK_SOURCE_COMMIT__ === 'string'
      ? __WISELINK_SOURCE_COMMIT__
      : 'UNAVAILABLE',
  buildTime:
    typeof __WISELINK_BUILD_TIME__ === 'string'
      ? __WISELINK_BUILD_TIME__
      : 'UNAVAILABLE',
  visualVersion:
    typeof __WISELINK_VISUAL_VERSION__ === 'string'
      ? __WISELINK_VISUAL_VERSION__
      : 'UNAVAILABLE',
};
