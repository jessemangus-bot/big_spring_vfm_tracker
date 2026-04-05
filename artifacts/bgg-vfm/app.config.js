function normalizeBaseUrl(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function resolveBaseUrl() {
  const explicit = normalizeBaseUrl(process.env.EXPO_PUBLIC_BASE_URL);
  if (explicit) return explicit;

  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY) {
    const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
    if (repo) return `/${repo}`;
  }

  return undefined;
}

module.exports = ({ config }) => {
  const baseUrl = resolveBaseUrl();
  return {
    ...config,
    experiments: {
      ...(config.experiments ?? {}),
      ...(baseUrl ? { baseUrl } : {}),
    },
  };
};
