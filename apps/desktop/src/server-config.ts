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

export { isServerVersionGreaterThanClient, isVersionGreater } from './versioning';

const HEALTH_TIMEOUT_MS = 15000;
const GATEWAY_TIMEOUT_MS = 10000;

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

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.name === 'AbortError' || message.includes('aborted');
}

function createTimeoutReason(target: string, timeoutMs: number) {
  const seconds = Math.round(timeoutMs / 1000);
  return new Error(`Connection to ${target} timed out after ${seconds} seconds.`);
}

function explainFetchError(error: unknown, target: string, timeoutMs: number): Error {
  if (isAbortError(error)) {
    return createTimeoutReason(target, timeoutMs);
  }

  if (error instanceof TypeError) {
    return new Error(
      `Cannot reach ${target}. Check the domain, port, HTTPS certificate, and reverse proxy CORS settings.`,
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`Cannot reach ${target}.`);
}

export async function readServerHealth(
  apiBaseUrl: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<ServerHealth> {
  const controller = new AbortController();
  const healthUrl = `${apiBaseUrl}/health`;
  const timeout = setTimeout(() => controller.abort(createTimeoutReason(healthUrl, timeoutMs)), timeoutMs);

  try {
    const response = await fetch(healthUrl, {
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
  } catch (error) {
    throw explainFetchError(error, healthUrl, timeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeGateway(gatewayUrl: string, timeoutMs = GATEWAY_TIMEOUT_MS): Promise<void> {
  if (typeof WebSocket === 'undefined') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        socket.close();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const timeout = setTimeout(() => {
      finish(createTimeoutReason(gatewayUrl, timeoutMs));
    }, timeoutMs);

    try {
      socket = new WebSocket(gatewayUrl);
    } catch (error) {
      clearTimeout(timeout);
      reject(explainFetchError(error, gatewayUrl, timeoutMs));
      return;
    }

    socket.addEventListener('open', () => finish());
    socket.addEventListener('error', () => {
      finish(
        new Error(
          `Cannot open gateway WebSocket at ${gatewayUrl}. Check that the port forwards /ws and supports WSS when using HTTPS.`,
        ),
      );
    });
    socket.addEventListener('close', () => {
      finish(new Error(`Gateway WebSocket at ${gatewayUrl} closed before it was ready.`));
    });
  });
}
