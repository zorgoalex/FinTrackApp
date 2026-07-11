const injectedBuild = globalThis.__FINTRACK_BUILD__ || {};

export const BUILD_INFO = Object.freeze({
  version: injectedBuild.version || 'local',
  environment: injectedBuild.environment || 'development',
});

export const BUILD_LABEL = `${BUILD_INFO.version} · ${BUILD_INFO.environment}`;
