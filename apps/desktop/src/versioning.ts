export interface BakerVersionParts {
  clientSuffix: string | null;
  major: number;
  minor: number;
  patch: number;
}

const bakerVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)([a-z])?(?:[-+].*)?$/;
const clientReleasePattern = /^v?\d+\.\d+\.\d+[a-z](?:[-+].*)?$/;

export function parseBakerVersion(version: string): BakerVersionParts {
  const match = version.trim().match(bakerVersionPattern);
  if (!match) {
    return {
      clientSuffix: null,
      major: 0,
      minor: 0,
      patch: 0,
    };
  }

  return {
    clientSuffix: match[4] ?? null,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function suffixRank(suffix: string | null) {
  if (!suffix) {
    return 0;
  }
  return suffix.charCodeAt(0) - 96;
}

export function compareBakerVersions(left: string, right: string): number {
  const a = parseBakerVersion(left);
  const b = parseBakerVersion(right);

  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    suffixRank(a.clientSuffix) - suffixRank(b.clientSuffix) ||
    left.localeCompare(right)
  );
}

export function isVersionGreater(left: string, right: string): boolean {
  return compareBakerVersions(left, right) > 0;
}

export function isClientReleaseVersion(version: string): boolean {
  return clientReleasePattern.test(version.trim());
}

export function isServerVersionGreaterThanClient(serverVersion: string, clientVersion: string): boolean {
  const server = parseBakerVersion(serverVersion);
  const client = parseBakerVersion(clientVersion);

  return (
    server.major > client.major ||
    (server.major === client.major && server.minor > client.minor) ||
    (server.major === client.major && server.minor === client.minor && server.patch > client.patch)
  );
}

export function normalizeReleaseTag(tag: string): string {
  return tag.trim().replace(/^v/, '');
}
