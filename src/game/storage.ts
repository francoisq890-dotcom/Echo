import {
  DEFAULT_SETTINGS,
  GameSettings,
  PrestigePerkId,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  TutorialStepId,
  UPGRADE_DEFS,
} from './config';
import { createDefaultUpgrades, EchoRecord, UpgradeLevels } from './economy';

export interface SaveState {
  version: number;
  savedAt: number;
  shards: number;
  runShardsEarned: number;
  lifetimeShards: number;
  totalGeodesBroken: number;
  loopsCompleted: number;
  upgrades: UpgradeLevels;
  echoes: EchoRecord[];
  temporalFragments: number;
  prestigeCount: number;
  perks: PrestigePerkId[];
  tutorialStep: TutorialStepId;
  hasSeenGhostHands: boolean;
  overloadArmed: boolean;
  settings: GameSettings;
}

export function createInitialSaveState(): SaveState {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    shards: 0,
    runShardsEarned: 0,
    lifetimeShards: 0,
    totalGeodesBroken: 0,
    loopsCompleted: 0,
    upgrades: createDefaultUpgrades(),
    echoes: [],
    temporalFragments: 0,
    prestigeCount: 0,
    perks: [],
    tutorialStep: 'break_5_geodes',
    hasSeenGhostHands: false,
    overloadArmed: false,
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function sanitizeSaveState(raw: unknown): SaveState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const base = createInitialSaveState();

  const shards = typeof obj.shards === 'number' && Number.isFinite(obj.shards) ? Math.max(0, obj.shards) : 0;
  const runShardsEarned =
    typeof obj.runShardsEarned === 'number' && Number.isFinite(obj.runShardsEarned)
      ? Math.max(0, obj.runShardsEarned)
      : shards;
  const lifetimeShards =
    typeof obj.lifetimeShards === 'number' && Number.isFinite(obj.lifetimeShards)
      ? Math.max(0, obj.lifetimeShards)
      : shards;

  const upgrades = { ...base.upgrades };
  if (obj.upgrades && typeof obj.upgrades === 'object') {
    const rawUp = obj.upgrades as Record<string, unknown>;
    for (const def of UPGRADE_DEFS) {
      const val = rawUp[def.id];
      if (typeof val === 'number' && Number.isFinite(val)) {
        upgrades[def.id] = Math.max(0, Math.min(def.maxLevel, Math.floor(val)));
      }
    }
  }

  const echoes: EchoRecord[] = [];
  if (Array.isArray(obj.echoes)) {
    for (const item of obj.echoes.slice(0, 40)) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (
        typeof e.id === 'string' &&
        typeof e.baseRate === 'number' &&
        Number.isFinite(e.baseRate) &&
        typeof e.duration === 'number' &&
        Array.isArray(e.samples) &&
        Array.isArray(e.shots)
      ) {
        echoes.push({
          id: e.id,
          createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
          baseRate: Math.max(0, e.baseRate),
          loopShards: typeof e.loopShards === 'number' ? Math.max(0, e.loopShards) : 0,
          duration: Math.max(1, e.duration),
          samples: e.samples.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
          shots: e.shots.filter(
            (s): s is EchoRecord['shots'][number] =>
              Boolean(s) &&
              typeof s === 'object' &&
              typeof (s as Record<string, unknown>).t === 'number',
          ),
        });
      }
    }
  }

  const validPerks = new Set<PrestigePerkId>(['chronos_edge', 'echo_chorus', 'golden_harvest']);
  const perks: PrestigePerkId[] = Array.isArray(obj.perks)
    ? obj.perks.filter((p): p is PrestigePerkId => typeof p === 'string' && validPerks.has(p as PrestigePerkId))
    : [];

  const settings = { ...DEFAULT_SETTINGS };
  if (obj.settings && typeof obj.settings === 'object') {
    const s = obj.settings as Record<string, unknown>;
    if (typeof s.sensitivity === 'number') settings.sensitivity = Math.max(0.3, Math.min(2.5, s.sensitivity));
    if (typeof s.vibration === 'boolean') settings.vibration = s.vibration;
    if (s.quality === 'high' || s.quality === 'medium' || s.quality === 'low') settings.quality = s.quality;
    if (typeof s.fps30 === 'boolean') settings.fps30 = s.fps30;
    if (typeof s.muted === 'boolean') settings.muted = s.muted;
  }

  const validTutorials = new Set<TutorialStepId>([
    'break_5_geodes',
    'finish_loop',
    'watch_echo',
    'buy_upgrade',
    'relay_shot',
    'twin_geode',
    'switch_vault',
    'defeat_devourer',
    'reach_prestige',
    'done',
  ]);
  const rawTut = obj.tutorialStep === 'better_loop' ? 'relay_shot' : obj.tutorialStep;
  const tutorialStep: TutorialStepId =
    typeof rawTut === 'string' && validTutorials.has(rawTut as TutorialStepId)
      ? (rawTut as TutorialStepId)
      : 'break_5_geodes';

  return {
    version: SAVE_VERSION,
    savedAt: typeof obj.savedAt === 'number' && Number.isFinite(obj.savedAt) ? obj.savedAt : Date.now(),
    shards,
    runShardsEarned,
    lifetimeShards,
    totalGeodesBroken:
      typeof obj.totalGeodesBroken === 'number' && Number.isFinite(obj.totalGeodesBroken)
        ? Math.max(0, Math.floor(obj.totalGeodesBroken))
        : 0,
    loopsCompleted:
      typeof obj.loopsCompleted === 'number' && Number.isFinite(obj.loopsCompleted)
        ? Math.max(0, Math.floor(obj.loopsCompleted))
        : 0,
    upgrades,
    echoes,
    temporalFragments:
      typeof obj.temporalFragments === 'number' && Number.isFinite(obj.temporalFragments)
        ? Math.max(0, Math.floor(obj.temporalFragments))
        : 0,
    prestigeCount:
      typeof obj.prestigeCount === 'number' && Number.isFinite(obj.prestigeCount)
        ? Math.max(0, Math.floor(obj.prestigeCount))
        : 0,
    perks,
    tutorialStep,
    hasSeenGhostHands: typeof obj.hasSeenGhostHands === 'boolean' ? obj.hasSeenGhostHands : false,
    overloadArmed: typeof obj.overloadArmed === 'boolean' ? obj.overloadArmed : false,
    settings,
  };
}

export function exportSaveText(state: SaveState): string {
  const payload = JSON.stringify({ ...state, savedAt: Date.now() });
  // UTF-8 safe base64 encoding
  const bytes = new TextEncoder().encode(payload);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return `ECHO1:${btoa(bin)}`;
}

export function importSaveText(text: string): SaveState | null {
  try {
    const trimmed = text.trim();
    const rawJson = trimmed.startsWith('ECHO1:')
      ? new TextDecoder().decode(
          Uint8Array.from(atob(trimmed.slice(6)), (c) => c.charCodeAt(0)),
        )
      : trimmed;
    const parsed = JSON.parse(rawJson);
    return sanitizeSaveState(parsed);
  } catch {
    return null;
  }
}

export function loadSaveFromStorage(): SaveState | null {
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSaveState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistSaveToStorage(state: SaveState): void {
  try {
    const toStore: SaveState = { ...state, savedAt: Date.now() };
    window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Ignore storage quota errors
  }
}
