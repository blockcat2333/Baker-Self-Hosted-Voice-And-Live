import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function readText(path) {
  return readFileSync(join(root, path), 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function check(name, condition, detail) {
  if (!condition) {
    failures.push(`${name}: ${detail}`);
  }
}

function listPackageJsons(directory) {
  const base = join(root, directory);
  if (!existsSync(base)) {
    return [];
  }

  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${directory}/${entry.name}/package.json`)
    .filter((path) => existsSync(join(root, path)));
}

const rootPackage = readJson('package.json');
const serverPackageVersion = rootPackage.version;
const desktopPackagePath = 'apps/desktop/package.json';
const desktopPackage = readJson(desktopPackagePath);
const desktopVersion = desktopPackage.version;
const stableServerVersionPattern = /^\d+\.\d+\.\d+$/;
const betaServerVersionPattern = /^(\d+\.\d+\.\d+)-beta(?:\.(\d+))?$/;
const betaServerVersionMatch = serverPackageVersion.match(
  betaServerVersionPattern,
);
const serverReleaseLabel = betaServerVersionMatch
  ? `${betaServerVersionMatch[1]}beta${betaServerVersionMatch[2] ? `.${betaServerVersionMatch[2]}` : ''}`
  : serverPackageVersion;
const isBetaServerRelease = Boolean(betaServerVersionMatch);
const desktopVersionPattern = /^(\d+\.\d+\.\d+)-([a-z])$/;
const desktopVersionMatch = desktopVersion.match(desktopVersionPattern);
const desktopReleaseLabel = desktopVersionMatch
  ? `${desktopVersionMatch[1]}${desktopVersionMatch[2]}`
  : desktopVersion;

check(
  'root package version',
  stableServerVersionPattern.test(serverPackageVersion) || isBetaServerRelease,
  `expected numeric server version or semver beta version, found ${serverPackageVersion}`,
);
check(
  'desktop package version',
  Boolean(desktopVersionMatch),
  `expected semver client package version like X.Y.Z-a, found ${desktopVersion}`,
);
if (!isBetaServerRelease) {
  check(
    'desktop package version base',
    desktopVersionMatch?.[1] === serverPackageVersion,
    `expected ${desktopVersion} to use server base ${serverPackageVersion}`,
  );
}
check(
  'release check script',
  rootPackage.scripts?.['release:check'] ===
    'node scripts/check-release-consistency.mjs',
  'expected package.json scripts.release:check to run this script',
);

for (const packagePath of [
  ...listPackageJsons('apps'),
  ...listPackageJsons('packages'),
]) {
  const packageJson = readJson(packagePath);
  if (packagePath === desktopPackagePath) {
    continue;
  }

  check(
    packagePath,
    packageJson.version === serverPackageVersion,
    `expected version ${serverPackageVersion}, found ${packageJson.version}`,
  );
}

const desktopArtifactName = desktopPackage.build?.artifactName ?? '';
if (!isBetaServerRelease) {
  check(
    'desktop artifact name',
    desktopArtifactName.includes(desktopReleaseLabel),
    `expected artifactName to include ${desktopReleaseLabel}, found ${desktopArtifactName}`,
  );
}

const sharedVersionSource = readText('packages/shared/src/version.ts');
check(
  'BAKER_VERSION',
  new RegExp(
    `BAKER_VERSION\\s*=\\s*['"]${escapeRegExp(serverReleaseLabel)}['"]`,
  ).test(sharedVersionSource),
  `expected packages/shared/src/version.ts to export ${serverReleaseLabel}`,
);

for (const readmePath of ['README.md', 'README.zh-CN.md']) {
  const readme = readText(readmePath);
  check(
    readmePath,
    readme.includes(serverReleaseLabel),
    `expected server version ${serverReleaseLabel}`,
  );
  check(
    readmePath,
    readme.includes(desktopReleaseLabel),
    `expected desktop version ${desktopReleaseLabel}`,
  );
}

for (const docsPath of [
  'README.md',
  'README.zh-CN.md',
  'docs/beginner-deployment.md',
  'docs/beginner-deployment.zh-CN.md',
]) {
  const text = readText(docsPath);
  const pinnedDockerTags = [
    ...text.matchAll(/blockcat233\/baker:(?!latest\b)([A-Za-z0-9._-]+)/g),
  ].map((match) => match[1]);

  check(
    docsPath,
    pinnedDockerTags.length > 0,
    'expected at least one pinned Baker Docker tag',
  );
  for (const tag of pinnedDockerTags) {
    check(
      docsPath,
      tag === serverReleaseLabel,
      `expected Docker tag ${serverReleaseLabel}, found ${tag}`,
    );
  }
}

const imageWorkflow = readText('.github/workflows/publish-images.yml');
check(
  'Docker image workflow tag guard',
  imageWorkflow.includes('is_server_tag') &&
    imageWorkflow.includes(
      '^v[0-9]+\\.[0-9]+\\.[0-9]+(beta([0-9]*|\\.[0-9]+)?|-beta(\\.[0-9]+)?)?$',
    ),
  'expected publish-images.yml to publish stable, compact/dotted beta, and semver beta server tags',
);

const desktopWorkflow = readText('.github/workflows/publish-desktop.yml');
check(
  'desktop workflow tag guard',
  desktopWorkflow.includes('is_desktop_tag') &&
    desktopWorkflow.includes('^v[0-9]+\\.[0-9]+\\.[0-9]+[a-z]$'),
  'expected publish-desktop.yml to skip numeric server release tags',
);
check(
  'desktop workflow release check',
  desktopWorkflow.includes('pnpm release:check'),
  'expected publish-desktop.yml to run pnpm release:check before building desktop assets',
);

if (failures.length > 0) {
  console.error('Release consistency check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Release consistency OK: server ${serverReleaseLabel}, package ${serverPackageVersion}, desktop ${desktopVersion}`,
  );
  console.log(`Expected Docker tag: blockcat233/baker:${serverReleaseLabel}`);
  console.log(`Expected GitHub Release tag: v${serverReleaseLabel}`);
  if (!isBetaServerRelease) {
    console.log(`Expected desktop GitHub Release tag: v${desktopReleaseLabel}`);
  }
}
