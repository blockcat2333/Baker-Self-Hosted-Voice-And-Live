/**
 * Voice join smoke (no UI): register -> authenticate gateway -> voice.join -> expect ack.
 *
 * This validates the server-side media-session creation path (gateway -> media service).
 *
 * Run (after scripts/dev-up.ps1):
 *   node scripts/voice-join-smoke.mjs
 *
 * Override ports:
 *   API_ORIGIN=http://127.0.0.1:3101 GATEWAY_URL=ws://127.0.0.1:3102/ws node scripts/voice-join-smoke.mjs
 */

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3101';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'ws://127.0.0.1:3102/ws';

function uniqueEmail() {
  return `voice-smoke-${Date.now()}@test.local`;
}

async function apiJson(path, init) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(`API ${path} failed: HTTP ${res.status} ${text ? `body=${text.slice(0, 200)}` : '(empty)'}`);
  }
  return json;
}

function wsSend(ws, payload) {
  ws.send(JSON.stringify({
    ...payload,
    ts: new Date().toISOString(),
    v: 1,
  }));
}

function createWsInbox(ws) {
  const inbox = [];
  const waiters = new Set();

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      inbox.push(data);
      for (const waiter of Array.from(waiters)) {
        if (waiter.predicate(data)) {
          waiters.delete(waiter);
          waiter.resolve(data);
        }
      }
    } catch {
      // ignore
    }
  };

  return {
    waitFor(predicate, timeoutMs = 5000) {
      const existing = inbox.find((msg) => predicate(msg));
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for gateway message.'));
        }, timeoutMs);

        const waiter = {
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        };

        waiters.add(waiter);
      });
    },
  };
}

async function run() {
  const email = uniqueEmail();
  const password = 'password123';
  const username = 'voice-smoke';

  const session = await apiJson('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, username }),
  });

  const accessToken = session?.tokens?.accessToken;
  if (!accessToken) throw new Error('Missing accessToken from register response.');

  const guilds = await apiJson('/v1/guilds', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const guildId = guilds?.[0]?.id;
  if (!guildId) throw new Error('No guild returned from /v1/guilds.');

  const channels = await apiJson(`/v1/guilds/${guildId}/channels`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const voiceChannel = Array.isArray(channels) ? channels.find((c) => c?.type === 'voice') : null;
  if (!voiceChannel?.id) throw new Error('No voice channel found in default guild.');

  const ws = new WebSocket(GATEWAY_URL);
  const inbox = createWsInbox(ws);

  await new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Failed to connect to gateway WS.'));
  });

  // Wait for system.ready event (sent immediately on connect).
  await inbox.waitFor((msg) => msg?.op === 'event' && msg?.event === 'system.ready', 5000);

  const reqIdAuth = 'req-auth';
  wsSend(ws, { op: 'command', reqId: reqIdAuth, command: 'system.authenticate', data: { accessToken } });
  await inbox.waitFor((msg) => msg?.op === 'ack' && msg?.reqId === reqIdAuth, 5000);

  const reqIdJoin = 'req-voice-join';
  wsSend(ws, { op: 'command', reqId: reqIdJoin, command: 'voice.join', data: { channelId: voiceChannel.id } });

  const reply = await inbox.waitFor(
    (msg) => (msg?.op === 'ack' || msg?.op === 'error') && msg?.reqId === reqIdJoin,
    8000,
  );

  if (reply.op === 'error') {
    throw new Error(`voice.join failed: ${reply.message ?? 'unknown error'}`);
  }

  if (!reply?.data?.sessionId || !Array.isArray(reply?.data?.iceServers)) {
    throw new Error('voice.join ack missing sessionId/iceServers.');
  }

  ws.close();
  console.log(`OK voice join smoke: channelId=${voiceChannel.id} sessionId=${reply.data.sessionId}`);
}

run().catch((err) => {
  console.error(`Voice join smoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
