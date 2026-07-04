import { BAKER_IMAGE_REPOSITORY } from './docker-control';

interface DockerHubTag {
  digest: string | null;
  lastUpdated: string | null;
  name: string;
}

interface GithubRelease {
  body: string | null;
  htmlUrl: string | null;
  tagName: string;
}

export interface BakerUpdateVersion {
  digest: string | null;
  image: string;
  isLatest: boolean;
  publishedAt: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  tag: string;
}

const dockerHubTagsUrl = 'https://hub.docker.com/v2/namespaces/blockcat233/repositories/baker/tags?page_size=100';
const githubReleasesUrl = 'https://api.github.com/repos/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases?per_page=100';
const dockerReleaseTagPattern =
  /^\d+\.\d+\.\d+(?:beta\d*|[-+][0-9A-Za-z.-]+)?$/;

function semverParts(tag: string) {
  const normalized = tag.replace(
    /(\d+\.\d+\.\d+)beta(\d*)$/,
    (_, version: string, betaNumber: string) =>
      `${version}-beta${betaNumber ? `.${betaNumber}` : ''}`,
  );
  const [version, suffix = ''] = normalized.split(/[-+]/, 2);
  const parts = version?.split('.').map((item) => Number(item)) ?? [];
  const betaMatch = /^beta(?:\.(\d+))?$/.exec(suffix);
  return {
    betaNumber: betaMatch ? Number(betaMatch[1] ?? 0) : -1,
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    stable: suffix.length === 0,
  };
}

export function compareVersionTagsDesc(left: string, right: string) {
  const a = semverParts(left);
  const b = semverParts(right);
  return (
    b.major - a.major ||
    b.minor - a.minor ||
    b.patch - a.patch ||
    Number(b.stable) - Number(a.stable) ||
    b.betaNumber - a.betaNumber ||
    right.localeCompare(left)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstImageDigest(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (isRecord(item) && typeof item['digest'] === 'string') {
      return item['digest'];
    }
  }
  return null;
}

function parseDockerHubTags(value: unknown): DockerHubTag[] {
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    return [];
  }

  return value['results'].flatMap((item): DockerHubTag[] => {
    if (
      !isRecord(item) ||
      typeof item['name'] !== 'string' ||
      !dockerReleaseTagPattern.test(item['name'])
    ) {
      return [];
    }

    return [
      {
        digest: firstImageDigest(item['images']),
        lastUpdated: typeof item['last_updated'] === 'string' ? item['last_updated'] : null,
        name: item['name'],
      },
    ];
  });
}

function parseGithubReleases(value: unknown): GithubRelease[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): GithubRelease[] => {
    if (!isRecord(item) || typeof item['tag_name'] !== 'string') {
      return [];
    }
    return [
      {
        body: typeof item['body'] === 'string' ? item['body'] : null,
        htmlUrl: typeof item['html_url'] === 'string' ? item['html_url'] : null,
        tagName: item['tag_name'].replace(/^v/, ''),
      },
    ];
  });
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with HTTP ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

export async function listBakerUpdateVersions(): Promise<BakerUpdateVersion[]> {
  const dockerTags = parseDockerHubTags(await fetchJson(dockerHubTagsUrl));

  let releases = new Map<string, GithubRelease>();
  try {
    releases = new Map(
      parseGithubReleases(await fetchJson(githubReleasesUrl, {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      })).map((release) => [release.tagName, release]),
    );
  } catch {
    releases = new Map();
  }

  const sortedTags = dockerTags.sort((left, right) => compareVersionTagsDesc(left.name, right.name));
  const latestTag = sortedTags[0]?.name ?? null;

  return sortedTags.map((tag) => {
    const release = releases.get(tag.name) ?? null;
    return {
      digest: tag.digest,
      image: `${BAKER_IMAGE_REPOSITORY}:${tag.name}`,
      isLatest: tag.name === latestTag,
      publishedAt: tag.lastUpdated,
      releaseNotes: release?.body ?? null,
      releaseUrl: release?.htmlUrl ?? null,
      tag: tag.name,
    };
  });
}
