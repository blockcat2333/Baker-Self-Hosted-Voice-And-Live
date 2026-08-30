import type { DesktopServerConfig } from './server-config';

export const DESKTOP_SERVER_REGISTRY_VERSION = 2 as const;

export interface DesktopServerEntry extends DesktopServerConfig {
  createdAt: string;
  id: string;
  lastConnectedAt: string | null;
  name: string;
  order: number;
}

export interface DesktopServerRegistry {
  activeServerId: string | null;
  schemaVersion: typeof DESKTOP_SERVER_REGISTRY_VERSION;
  servers: DesktopServerEntry[];
}

export interface ParsedDesktopServerRegistry {
  migrated: boolean;
  registry: DesktopServerRegistry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readLegacyServer(value: unknown): DesktopServerConfig | null {
  if (!isRecord(value)) return null;
  const apiBaseUrl = readString(value['apiBaseUrl']);
  const gatewayUrl = readString(value['gatewayUrl']);
  const input = readString(value['input']);
  const savedAt = readString(value['savedAt']);
  const serverVersion = readString(value['serverVersion']);
  if (!apiBaseUrl || !gatewayUrl || !input || !savedAt || !serverVersion) return null;
  return { apiBaseUrl, gatewayUrl, input, savedAt, serverVersion };
}

function readServerEntry(value: unknown, fallbackOrder: number): DesktopServerEntry | null {
  const legacy = readLegacyServer(value);
  if (!legacy || !isRecord(value)) return null;
  const id = readString(value['id']);
  if (!id) return null;
  const createdAt = readString(value['createdAt']) ?? legacy.savedAt;
  const name = readString(value['name']) ?? 'Baker';
  const lastConnectedAt = readString(value['lastConnectedAt']);
  const order =
    typeof value['order'] === 'number' && Number.isFinite(value['order'])
      ? Math.max(0, Math.trunc(value['order']))
      : fallbackOrder;
  return { ...legacy, createdAt, id, lastConnectedAt, name, order };
}

export function createEmptyServerRegistry(): DesktopServerRegistry {
  return { activeServerId: null, schemaVersion: DESKTOP_SERVER_REGISTRY_VERSION, servers: [] };
}

export function createDesktopServerEntry(
  config: DesktopServerConfig,
  input: { id: string; name: string; now: string; order: number },
): DesktopServerEntry {
  return {
    ...config,
    createdAt: input.now,
    id: input.id,
    lastConnectedAt: input.now,
    name: input.name.trim() || 'Baker',
    order: input.order,
  };
}

export function parseDesktopServerRegistry(
  value: unknown,
  createId: () => string,
): ParsedDesktopServerRegistry {
  if (isRecord(value) && value['schemaVersion'] === DESKTOP_SERVER_REGISTRY_VERSION) {
    const source = Array.isArray(value['servers']) ? value['servers'] : [];
    const seen = new Set<string>();
    const servers = source
      .map((entry, index) => readServerEntry(entry, index))
      .filter((entry): entry is DesktopServerEntry => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .sort((left, right) => left.order - right.order)
      .map((entry, order) => ({ ...entry, order }));
    const requestedActiveId = readString(value['activeServerId']);
    const activeServerId = servers.some((server) => server.id === requestedActiveId)
      ? requestedActiveId
      : (servers[0]?.id ?? null);
    return {
      migrated: false,
      registry: { activeServerId, schemaVersion: DESKTOP_SERVER_REGISTRY_VERSION, servers },
    };
  }

  const legacy = readLegacyServer(value);
  if (!legacy) return { migrated: false, registry: createEmptyServerRegistry() };
  const server = createDesktopServerEntry(legacy, {
    id: createId(),
    name: 'Baker',
    now: legacy.savedAt,
    order: 0,
  });
  return {
    migrated: true,
    registry: {
      activeServerId: server.id,
      schemaVersion: DESKTOP_SERVER_REGISTRY_VERSION,
      servers: [server],
    },
  };
}

export function upsertDesktopServer(
  registry: DesktopServerRegistry,
  server: DesktopServerEntry,
  makeActive = false,
): DesktopServerRegistry {
  const index = registry.servers.findIndex((entry) => entry.id === server.id);
  const servers = index < 0
    ? [...registry.servers, { ...server, order: registry.servers.length }]
    : registry.servers.map((entry) => (entry.id === server.id ? { ...server, order: entry.order } : entry));
  return {
    activeServerId: makeActive ? server.id : registry.activeServerId,
    schemaVersion: DESKTOP_SERVER_REGISTRY_VERSION,
    servers,
  };
}

export function removeDesktopServer(
  registry: DesktopServerRegistry,
  serverId: string,
): DesktopServerRegistry {
  const removedIndex = registry.servers.findIndex((entry) => entry.id === serverId);
  if (removedIndex < 0) return registry;
  const servers = registry.servers
    .filter((entry) => entry.id !== serverId)
    .map((entry, order) => ({ ...entry, order }));
  const fallback = servers[Math.min(removedIndex, Math.max(0, servers.length - 1))] ?? null;
  return {
    activeServerId: registry.activeServerId === serverId ? fallback?.id ?? null : registry.activeServerId,
    schemaVersion: DESKTOP_SERVER_REGISTRY_VERSION,
    servers,
  };
}
