export type NotificationTone = 'cyan' | 'gold' | 'crimson' | 'coral';

export interface NotificationItem {
  id: number;
  dedupeKey: string;
  text: string;
  tone: NotificationTone;
  priority: 1 | 2 | 3;
  cooldownMs: number;
}

export interface NotificationQueueState {
  active: (NotificationItem & { expiresAt: number }) | null;
  pending: NotificationItem[];
  lastShownAt: Record<string, number>;
  nextId: number;
}

export const NOTIFICATION_DURATION_MS = 2000;
const MAX_PENDING = 2;

export function createNotificationQueueState(): NotificationQueueState {
  return {
    active: null,
    pending: [],
    lastShownAt: {},
    nextId: 1,
  };
}

export interface EnqueueInput {
  dedupeKey: string;
  text: string;
  tone: NotificationTone;
  priority: 1 | 2 | 3;
  cooldownMs?: number;
}

export function enqueueNotification(
  state: NotificationQueueState,
  input: EnqueueInput,
  nowMs: number,
): NotificationQueueState {
  const cooldownMs = input.cooldownMs ?? 3000;

  // Ignore duplicate if currently showing or already queued
  if (state.active?.dedupeKey === input.dedupeKey) {
    return state;
  }
  if (state.pending.some((item) => item.dedupeKey === input.dedupeKey)) {
    return state;
  }

  // Respect cooldown for noisy/repeated events unless high-priority echo replacement
  const prevShown = state.lastShownAt[input.dedupeKey];
  if (prevShown !== undefined && nowMs - prevShown < cooldownMs) {
    return state;
  }

  // Low-priority announcements (e.g. relay) are skipped whenever something is already active or queued
  if (input.priority === 1 && (state.active !== null || state.pending.length > 0)) {
    return state;
  }

  const item: NotificationItem = {
    id: state.nextId,
    dedupeKey: input.dedupeKey,
    text: input.text,
    tone: input.tone,
    priority: input.priority,
    cooldownMs,
  };

  if (state.active === null) {
    return {
      active: { ...item, expiresAt: nowMs + NOTIFICATION_DURATION_MS },
      pending: state.pending,
      lastShownAt: { ...state.lastShownAt, [input.dedupeKey]: nowMs },
      nextId: state.nextId + 1,
    };
  }

  // Merge/replace lower-priority items if pending queue is full
  const nextPending = [...state.pending, item].sort((a, b) => b.priority - a.priority);
  if (nextPending.length > MAX_PENDING) {
    nextPending.length = MAX_PENDING;
  }

  return {
    active: state.active,
    pending: nextPending,
    lastShownAt: state.lastShownAt,
    nextId: state.nextId + 1,
  };
}

export function advanceNotificationQueue(
  state: NotificationQueueState,
  nowMs: number,
): NotificationQueueState {
  if (state.active && nowMs < state.active.expiresAt) {
    return state;
  }

  if (state.pending.length === 0) {
    if (state.active === null) return state;
    return {
      ...state,
      active: null,
    };
  }

  const [nextItem, ...rest] = state.pending;
  return {
    active: { ...nextItem, expiresAt: nowMs + NOTIFICATION_DURATION_MS },
    pending: rest,
    lastShownAt: { ...state.lastShownAt, [nextItem.dedupeKey]: nowMs },
    nextId: state.nextId,
  };
}
