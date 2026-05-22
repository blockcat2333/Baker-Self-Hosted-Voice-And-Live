export interface DesktopServerConfig {
  apiBaseUrl: string;
  gatewayUrl: string;
  input: string;
  savedAt: string;
  serverVersion: string;
}

export interface ServerHealth {
  service: string;
  status: string;
  version: string;
}

function hasHttpProtocol(input: string) {
  return /^https?:\/\//i.test(input);
}

export function normalizeServerInput(input: string): Pick<DesktopServerConfig, 'apiBaseUrl' | 'gatewayUrl' | 'input'> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a server domain or IP address.');
  }

  const parsed = new URL(hasHttpProtocol(trimmed) ? trimmed : `http://${trimmed}`);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Server address must use HTTP or HTTPS.');
  }

  const apiBaseUrl = `${parsed.protocol}//${parsed.host}`;
  const gatewayProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';

  return {
    apiBaseUrl,
    gatewayUrl: `${gatewayProtocol}//${parsed.host}/ws`,
    input: trimmed,
  };
}

function parseVersion(version: string): number[] {
  return version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function isVersionGreater(left: string, right: string): boolean {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return true;
    }
    if (leftPart < rightPart) {
      return false;
    }
  }

  return false;
}

export async function readServerHealth(apiBaseUrl: string): Promise<ServerHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Server health check failed with HTTP ${response.status}.`);
    }

    const data = (await response.json()) as Partial<ServerHealth>;
    if (data.status !== 'ok' || !data.version) {
      throw new Error('Server did not return a valid Baker health response.');
    }

    return {
      service: data.service ?? 'api',
      status: data.status,
      version: data.version,
    };
  } finally {
    clearTimeout(timeout);
  }
}
