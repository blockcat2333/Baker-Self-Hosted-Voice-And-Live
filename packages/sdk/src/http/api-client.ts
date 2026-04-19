import {
  AuthSessionSchema,
  ChannelListResponseSchema,
  GuildListResponseSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  PublicServerConfigSchema,
  MessagePageSchema,
  MessageSchema,
  RegisterRequestSchema,
  RefreshTokenRequestSchema,
  SendMessageRequestSchema,
  ServiceManifestSchema,
  UpdateMeRequestSchema,
  type AuthSession,
  type AuthUser,
  type ChannelSummary,
  type GuildSummary,
  type HealthResponse,
  type LogoutResponse,
  type Message,
  type MessagePage,
  type PublicServerConfig,
  type ServiceManifest,
} from '@baker/protocol';

export interface ApiClientOptions {
  /** Returns the current access token. Called before every authenticated request. */
  getAccessToken?: () => string | null;
}

export interface ApiClient {
  // Unauthenticated
  getHealth(): Promise<HealthResponse>;
  getServiceManifest(): Promise<ServiceManifest>;
  getPublicServerConfig(): Promise<PublicServerConfig>;
  register(input: { email: string; password: string; username: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  refresh(input: { refreshToken: string }): Promise<AuthSession>;
  logout(): Promise<LogoutResponse>;

  // Authenticated
  me(): Promise<AuthUser>;
  updateMe(input: { username: string }): Promise<AuthUser>;
  listGuilds(): Promise<GuildSummary[]>;
  listChannels(guildId: string): Promise<ChannelSummary[]>;
  listMessages(channelId: string, params?: { before?: string; limit?: number }): Promise<MessagePage>;
  sendMessage(channelId: string, content: string): Promise<Message>;
}

async function parseJson<T>(
  schema: { parse(data: unknown): T },
  response: Response,
): Promise<T> {
  const rawText = await response.text();
  const trimmed = rawText.trim();
  let json: unknown = null;
  let jsonParseFailed = false;

  if (trimmed) {
    try {
      json = JSON.parse(trimmed) as unknown;
    } catch {
      jsonParseFailed = true;
      json = null;
    }
  }

  if (!response.ok) {
    const message = typeof json === 'object' && json !== null && 'message' in json
      ? String((json as Record<string, unknown>)['message'])
      : trimmed
        ? `HTTP ${response.status}`
        : `HTTP ${response.status} (empty response)`;
    throw new ApiError(response.status, message);
  }

  if (!trimmed) {
    throw new Error(`Empty response from server (HTTP ${response.status}).`);
  }

  if (jsonParseFailed) {
    const contentType = response.headers.get('content-type');
    const snippet = trimmed.slice(0, 120);
    throw new Error(
      `Invalid JSON response from server (HTTP ${response.status}${contentType ? `, content-type: ${contentType}` : ''}).` +
      (snippet ? ` Body starts with: ${JSON.stringify(snippet)}` : ''),
    );
  }

  return schema.parse(json);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApiClient(baseUrl: string, options: ApiClientOptions = {}): ApiClient {
  function url(path: string) {
    return new URL(path, baseUrl).toString();
  }

  function authHeaders(): Record<string, string> {
    const token = options.getAccessToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function post<T>(schema: { parse(data: unknown): T }, path: string, body: unknown, auth = false): Promise<T> {
    const response = await fetch(url(path), {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? authHeaders() : {}),
      },
      method: 'POST',
    });
    return parseJson(schema, response);
  }

  async function patch<T>(schema: { parse(data: unknown): T }, path: string, body: unknown): Promise<T> {
    const response = await fetch(url(path), {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      method: 'PATCH',
    });
    return parseJson(schema, response);
  }

  async function get<T>(schema: { parse(data: unknown): T }, path: string, params?: Record<string, string>): Promise<T> {
    const fullUrl = new URL(path, baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        fullUrl.searchParams.set(k, v);
      }
    }
    const response = await fetch(fullUrl.toString(), {
      headers: { ...authHeaders() },
      method: 'GET',
    });
    return parseJson(schema, response);
  }

  return {
    async getHealth() {
      return get(HealthResponseSchema, '/health');
    },
    async getServiceManifest() {
      return get(ServiceManifestSchema, '/v1/meta/services');
    },
    async getPublicServerConfig() {
      return get(PublicServerConfigSchema, '/v1/meta/public-config');
    },
    async register(input) {
      return post(AuthSessionSchema, '/v1/auth/register', RegisterRequestSchema.parse(input));
    },
    async login(input) {
      return post(AuthSessionSchema, '/v1/auth/login', LoginRequestSchema.parse(input));
    },
    async refresh(input) {
      return post(AuthSessionSchema, '/v1/auth/refresh', RefreshTokenRequestSchema.parse(input));
    },
    async logout() {
      return post(LogoutResponseSchema, '/v1/auth/logout', {}, true);
    },
    async me() {
      return get(MeResponseSchema, '/v1/auth/me');
    },
    async updateMe(input) {
      return patch(MeResponseSchema, '/v1/auth/me', UpdateMeRequestSchema.parse(input));
    },
    async listGuilds() {
      return get(GuildListResponseSchema, '/v1/guilds');
    },
    async listChannels(guildId) {
      return get(ChannelListResponseSchema, `/v1/guilds/${guildId}/channels`);
    },
    async listMessages(channelId, params) {
      const query: Record<string, string> = {};
      if (params?.before) query['before'] = params.before;
      if (params?.limit !== undefined) query['limit'] = String(params.limit);
      return get(MessagePageSchema, `/v1/channels/${channelId}/messages`, Object.keys(query).length ? query : undefined);
    },
    async sendMessage(channelId, content) {
      return post(MessageSchema, `/v1/channels/${channelId}/messages`, SendMessageRequestSchema.parse({ content }), true);
    },
  };
}
