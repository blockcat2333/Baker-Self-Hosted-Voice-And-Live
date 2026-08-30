import { create } from 'zustand';

export type MediaRecoveryKind =
  | 'gateway'
  | 'music_listen'
  | 'music_publish'
  | 'stream_publish'
  | 'stream_watch'
  | 'voice';

export interface MediaRecoveryIncident {
  attempt: number;
  escalated: boolean;
  id: string;
  kind: MediaRecoveryKind;
  lastError: string | null;
  nextRetryAt: number | null;
}

interface MediaRecoveryState {
  incidents: Record<string, MediaRecoveryIncident>;
}

interface RecoveryController {
  abandon: () => void;
  attempt: () => Promise<void>;
  generation: number;
  id: string;
  kind: MediaRecoveryKind;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PassiveRecoveryActions {
  abandon: () => void;
  retry: () => void;
}

const controllers = new Map<string, RecoveryController>();
const passiveActions = new Map<string, PassiveRecoveryActions>();
let nextGeneration = 0;

export class NonRetryableMediaRecoveryError extends Error {}

export function isMediaReconnectUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown command|unsupported|invalid envelope|invalid payload/i.test(message);
}

export const useMediaRecoveryStore = create<MediaRecoveryState>(() => ({ incidents: {} }));

function retryDelayMs(failedAttempts: number) {
  const base = Math.min(1_000 * 2 ** Math.max(0, failedAttempts - 1), 30_000);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(250, Math.round(base + jitter));
}

function updateIncident(id: string, patch: Partial<MediaRecoveryIncident>) {
  useMediaRecoveryStore.setState((state) => {
    const current = state.incidents[id];
    if (!current) return state;
    return { incidents: { ...state.incidents, [id]: { ...current, ...patch } } };
  });
}

function removeIncident(id: string) {
  useMediaRecoveryStore.setState((state) => {
    if (!state.incidents[id]) return state;
    const { [id]: _removed, ...rest } = state.incidents;
    return { incidents: rest };
  });
}

async function runRecovery(controller: RecoveryController) {
  if (controllers.get(controller.id)?.generation !== controller.generation) return;
  if (controller.running) return;
  controller.running = true;
  controller.timer = null;
  updateIncident(controller.id, { nextRetryAt: null });
  try {
    await controller.attempt();
    if (controllers.get(controller.id)?.generation !== controller.generation) return;
    controllers.delete(controller.id);
    removeIncident(controller.id);
  } catch (error) {
    if (controllers.get(controller.id)?.generation !== controller.generation) return;
    if (error instanceof NonRetryableMediaRecoveryError) {
      controllers.delete(controller.id);
      controller.abandon();
      removeIncident(controller.id);
      return;
    }
    const previousAttempt = useMediaRecoveryStore.getState().incidents[controller.id]?.attempt ?? 0;
    const attempt = previousAttempt + 1;
    const delay = retryDelayMs(attempt);
    updateIncident(controller.id, {
      attempt,
      escalated: attempt >= 5,
      lastError: error instanceof Error ? error.message : String(error),
      nextRetryAt: Date.now() + delay,
    });
    controller.timer = setTimeout(() => void runRecovery(controller), delay);
  } finally {
    controller.running = false;
  }
}

export function startMediaRecovery(input: {
  abandon: () => void;
  attempt: () => Promise<void>;
  id: string;
  kind: MediaRecoveryKind;
  reason?: string | null;
}) {
  if (controllers.has(input.id)) return;
  const controller: RecoveryController = {
    abandon: input.abandon,
    attempt: input.attempt,
    generation: ++nextGeneration,
    id: input.id,
    kind: input.kind,
    running: false,
    timer: null,
  };
  controllers.set(input.id, controller);
  useMediaRecoveryStore.setState((state) => ({
    incidents: {
      ...state.incidents,
      [input.id]: {
        attempt: 0,
        escalated: false,
        id: input.id,
        kind: input.kind,
        lastError: input.reason ?? null,
        nextRetryAt: null,
      },
    },
  }));
  void runRecovery(controller);
}

export function resolveMediaRecovery(id: string) {
  const controller = controllers.get(id);
  if (controller?.timer) clearTimeout(controller.timer);
  controllers.delete(id);
  passiveActions.delete(id);
  removeIncident(id);
}

export function setPassiveMediaRecovery(input: {
  abandon: () => void;
  attempt: number;
  id: string;
  kind: MediaRecoveryKind;
  lastError: string | null;
  nextRetryAt: number | null;
  retry: () => void;
}) {
  passiveActions.set(input.id, { abandon: input.abandon, retry: input.retry });
  useMediaRecoveryStore.setState((state) => ({
    incidents: {
      ...state.incidents,
      [input.id]: {
        attempt: input.attempt,
        escalated: input.attempt >= 5,
        id: input.id,
        kind: input.kind,
        lastError: input.lastError,
        nextRetryAt: input.nextRetryAt,
      },
    },
  }));
}

export function retryMediaRecoveryNow() {
  for (const controller of controllers.values()) {
    if (controller.timer) clearTimeout(controller.timer);
    void runRecovery(controller);
  }
  for (const actions of passiveActions.values()) actions.retry();
}

export function abandonAllMediaRecovery() {
  for (const controller of controllers.values()) {
    if (controller.timer) clearTimeout(controller.timer);
    controller.abandon();
  }
  controllers.clear();
  for (const actions of passiveActions.values()) actions.abandon();
  passiveActions.clear();
  useMediaRecoveryStore.setState({ incidents: {} });
}

export function resetMediaRecoveryStore() {
  for (const controller of controllers.values()) {
    if (controller.timer) clearTimeout(controller.timer);
  }
  controllers.clear();
  passiveActions.clear();
  useMediaRecoveryStore.setState({ incidents: {} });
}
