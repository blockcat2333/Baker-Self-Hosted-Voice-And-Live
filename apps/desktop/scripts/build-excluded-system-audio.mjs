import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(desktopRoot, 'native', 'excluded-system-audio.cpp');
const output = join(desktopRoot, 'native', 'excluded-system-audio.exe');
const objectFile = join(desktopRoot, 'native', 'excluded-system-audio.obj');
const required = process.argv.includes('--required');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
    ...options,
  });
}

function findVsWhere() {
  const candidates = [
    join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    join(process.env.ProgramFiles ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function findVcVarsAll() {
  const vswhere = findVsWhere();
  if (!vswhere) {
    return null;
  }

  const result = run(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { capture: true },
  );
  const installationPath = result.stdout?.trim();
  if (!installationPath) {
    return null;
  }

  const candidate = join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
  return existsSync(candidate) ? candidate : null;
}

function skip(message) {
  if (required) {
    console.error(message);
    process.exit(1);
  }

  console.warn(message);
  process.exit(0);
}

if (process.platform !== 'win32') {
  skip('Skipping excluded system audio helper build: Windows-only target.');
}

const vcvarsall = findVcVarsAll();
if (!vcvarsall) {
  skip('Skipping excluded system audio helper build: MSVC Build Tools were not found.');
}

await mkdir(dirname(output), { recursive: true });

const compileCommand = [
  'cl',
  '/nologo',
  '/EHsc',
  '/std:c++17',
  '/O2',
  '/W4',
  `"/Fo:${objectFile}"`,
  `"/Fe:${output}"`,
  `"${source}"`,
].join(' ');

const command = [
  '@echo off',
  `call "${vcvarsall}" x64`,
  'if errorlevel 1 exit /b %errorlevel%',
  compileCommand,
].join('\r\n');

const batchFile = join(tmpdir(), `baker-build-excluded-system-audio-${process.pid}.cmd`);
await writeFile(batchFile, command, 'utf8');

try {
  const result = run('cmd.exe', ['/d', '/c', batchFile]);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  await rm(batchFile, { force: true });
  await rm(objectFile, { force: true });
}
