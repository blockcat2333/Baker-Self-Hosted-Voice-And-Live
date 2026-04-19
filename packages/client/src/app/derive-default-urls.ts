export interface LocationLike {
  protocol?: string;
  hostname?: string;
  port?: string;
}

function getHostname(location: LocationLike | undefined) {
  const hostname = location?.hostname?.trim();
  return hostname ? hostname : 'localhost';
}

function getPortSuffix(location: LocationLike | undefined) {
  const port = location?.port?.trim();
  return port ? `:${port}` : '';
}

function isHttpProtocol(protocol: string | undefined) {
  return protocol === 'http:' || protocol === 'https:';
}

export function deriveDefaultApiBaseUrl(location: LocationLike): string {
  const protocol = isHttpProtocol(location.protocol) ? location.protocol : 'http:';
  return `${protocol}//${getHostname(location)}:3001`;
}

export function deriveDefaultGatewayUrl(location: LocationLike): string {
  const wsProtocol =
    location.protocol === 'https:' ? 'wss:' : isHttpProtocol(location.protocol) ? 'ws:' : 'ws:';

  // In browsers, prefer same-origin websocket so the deployment can proxy `/ws`
  // (and avoid mixed-content when the page is served over HTTPS).
  if (isHttpProtocol(location.protocol)) {
    return `${wsProtocol}//${getHostname(location)}${getPortSuffix(location)}/ws`;
  }

  // Non-http contexts (e.g. desktop file://) use the legacy direct-port default.
  return `${wsProtocol}//${getHostname(location)}:3002/ws`;
}
