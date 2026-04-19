import {
  type GatewayCommandName,
  type GatewayEnvelope,
  GatewayCommandEnvelopeSchema,
  GatewayEnvelopeSchema,
  createHeartbeatEnvelope,
} from '@baker/protocol';

type EnvelopeHandler = (payload: GatewayEnvelope) => void;
type ErrorHandler = (error: unknown) => void;
type CloseHandler = () => void;
type SocketFactory = (url: string) => WebSocket;

export interface GatewayClientOptions {
  socketFactory?: SocketFactory;
}

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSING = 2;
const READY_STATE_CLOSED = 3;

export class GatewayClient {
  private readonly listeners = new Set<EnvelopeHandler>();
  private readonly errorListeners = new Set<ErrorHandler>();
  private readonly closeListeners = new Set<CloseHandler>();
  private readonly socketFactory: SocketFactory;
  private socket: WebSocket | null = null;
  private pendingMessages: string[] = [];

  constructor(
    private readonly url: string,
    options: GatewayClientOptions = {},
  ) {
    this.socketFactory = options.socketFactory ?? ((input) => new WebSocket(input));
  }

  private flushPending() {
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState !== READY_STATE_OPEN) return;
    if (this.pendingMessages.length === 0) return;

    const messages = this.pendingMessages;
    this.pendingMessages = [];
    for (const msg of messages) {
      socket.send(msg);
    }
  }

  private sendRaw(message: string) {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    if (socket.readyState === READY_STATE_OPEN) {
      socket.send(message);
      return;
    }

    if (socket.readyState === READY_STATE_CONNECTING) {
      this.pendingMessages.push(message);
      return;
    }

    // CLOSING/CLOSED - surface a real error for callers that assume connectivity.
    const state =
      socket.readyState === READY_STATE_CLOSING
        ? 'closing'
        : socket.readyState === READY_STATE_CLOSED
          ? 'closed'
          : `readyState:${socket.readyState}`;
    this.errorListeners.forEach((handler) => handler(new Error(`Gateway socket is ${state}`)));
  }

  connect() {
    if (this.socket) {
      return;
    }

    const socket = this.socketFactory(this.url);
    socket.addEventListener('open', () => {
      this.flushPending();
    });
    socket.addEventListener('message', (event) => {
      try {
        const json = JSON.parse(String(event.data));
        const envelope = GatewayEnvelopeSchema.parse(json);
        this.listeners.forEach((handler) => handler(envelope));
      } catch (error) {
        this.errorListeners.forEach((handler) => handler(error));
      }
    });
    socket.addEventListener('close', () => {
      // Allow callers to reconnect() after a close.
      this.socket = null;
      this.pendingMessages = [];
      this.closeListeners.forEach((handler) => handler());
    });
    socket.addEventListener('error', (error) => {
      this.errorListeners.forEach((handler) => handler(error));
    });
    this.socket = socket;
  }

  close() {
    this.socket?.close();
    this.socket = null;
    this.pendingMessages = [];
  }

  onEnvelope(handler: EnvelopeHandler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onError(handler: ErrorHandler) {
    this.errorListeners.add(handler);
    return () => this.errorListeners.delete(handler);
  }

  onClose(handler: CloseHandler) {
    this.closeListeners.add(handler);
    return () => this.closeListeners.delete(handler);
  }

  ping() {
    this.sendRaw(JSON.stringify(createHeartbeatEnvelope('ping')));
  }

  sendCommand(command: { command: GatewayCommandName; data: unknown; reqId?: string }) {
    const envelope = GatewayCommandEnvelopeSchema.parse({
      command: command.command,
      data: command.data,
      op: 'command',
      reqId: command.reqId ?? `req-${Date.now()}`,
      ts: new Date().toISOString(),
      v: 1,
    });
    this.sendRaw(JSON.stringify(envelope));
  }
}
