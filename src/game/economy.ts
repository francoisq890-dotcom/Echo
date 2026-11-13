import {
  BASE_ECHO_REPLICATION,
  BASE_ECHO_SLOTS,
  BASE_LOOP_DURATION,
  MAX_ECHO_INSTANCES,
  OFFLINE_CAP_SECONDS,
  PRESTIGE_SCORE_THRESHOLD,
  PrestigePerkId,
  UPGRADE_DEFS,
  UpgradeId,
} from './config';

export type UpgradeLevels = Record<UpgradeId, number>;

export interface EchoRecord {
  id: string;
  createdAt: number;
  baseRate: number; // loopShards / duration
  loopShards: number;
  duration: number;
  overloaded?: boolean;
  samples: Float32Array | number[]; // flat [t, x, y, z, yaw, pitch, ...]
  shots: Array<{
    t: number;
    ox: number;
    oy: number;
    oz: number;
    dx: number;
    dy: number;
    dz: number;
  }>;
}

export interface ComputedStats {
  damage: number;
  fireRate: number;
  relayMultiplier: number;
  ricochetCount: number;
  pierceCount: number;
  blastRadius: number;
  weaponTier: number;
  loopDuration: number;
  echoSlots: number;
  echoPowerMult: number;
  dashUnlocked: boolean;
  dashCooldown: number;
  overloadUnlocked: boolean;
  overloadMultiplier: number;
  magnetRadius: number;
  magnetSpeed: number;
  moveSpeed: number;
  shardMult: number;
  prestigeMult: number;
  platformsLevel: number;
  mobileGeodeBonusCount: number;
  twinMult: number;
  armoredGeodeCount: number;
  explosiveGeodeCount: number;
  goldenGeodeCount: number;
}

export function createDefaultUpgrades(): UpgradeLevels {
  return {
    weapon_damage: 0,
    weapon_rate: 0,
    weapon_relay: 0,
    weapon_ricochet: 0,
    weapon_pierce: 0,
    weapon_blast: 0,
    loop_duration: 0,
    loop_slots: 0,
    loop_power: 0,
    loop_dash: 0,
    loop_overload: 0,
    arena_platforms: 0,
    arena_mobile: 0,
    arena_twins: 0,
    arena_armored: 0,
    arena_golden: 0,
    arena_explosive: 0,
    magnet_radius: 0,
    magnet_speed: 0,
  };
}

export function formatShards(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return Math.round(value).toString();
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  const tier = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  const scaled = value / Math.pow(1000, tier);
  const formatted = scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
  return `${formatted.replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1')}${units[tier]}`;
}

export function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Prêt !';
  const s = Math.ceil(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

export function getUpgradeCost(id: UpgradeId, currentLevel: number): number {
  const def = UPGRADE_DEFS.find((u) => u.id === id);
  if (!def) return Infinity;
  if (currentLevel >= def.maxLevel) return Infinity;
  return Math.round(def.baseCost * Math.pow(def.costFactor, currentLevel));
}

export function getPrestigeMultiplier(temporalFragments: number): number {
  return 1 + temporalFragments * 0.15;
}

export function computeStats(
  upgrades: UpgradeLevels,
  temporalFragments: number,
  perks: PrestigePerkId[],
): ComputedStats {
  const hasChronos = perks.includes('chronos_edge');
  const hasChorus = perks.includes('echo_chorus');
  const hasHarvest = perks.includes('golden_harvest');

  const prestigeMult = getPrestigeMultiplier(temporalFragments);
  const damage = 12 * (1 + upgrades.weapon_damage * 0.22) * prestigeMult;
  const fireRate = 3.2 * (1 + upgrades.weapon_rate * 0.18) * (hasChronos ? 1.55 : 1);
  const relayMultiplier = 2.5 + upgrades.weapon_relay * 0.25;
  const ricochetCount = upgrades.weapon_ricochet;
  const pierceCount = 1 + upgrades.weapon_pierce;
  const blastRadius = upgrades.weapon_blast > 0 ? 2.4 + upgrades.weapon_blast * 0.5 : 0;

  const weaponPowerScore =
    upgrades.weapon_damage +
    upgrades.weapon_rate +
    upgrades.weapon_relay +
    upgrades.weapon_ricochet * 2 +
    upgrades.weapon_pierce * 2 +
    upgrades.weapon_blast;
  const weaponTier =
    weaponPowerScore >= 24
      ? 4
      : weaponPowerScore >= 16
        ? 3
        : weaponPowerScore >= 9
          ? 2
          : weaponPowerScore >= 3
            ? 1
            : 0;

  const loopDuration = BASE_LOOP_DURATION + upgrades.loop_duration * 2.0;
  const echoSlots = Math.min(
    MAX_ECHO_INSTANCES,
    BASE_ECHO_SLOTS + upgrades.loop_slots + (hasChorus ? 2 : 0),
  );
  const echoPowerMult =
    BASE_ECHO_REPLICATION *
    (1 + upgrades.loop_power * 0.2) *
    (hasChorus ? 1.4 : 1) *
    prestigeMult;

  const dashUnlocked = upgrades.loop_dash >= 1;
  const dashCooldown = dashUnlocked ? 2.6 * Math.pow(0.84, upgrades.loop_dash - 1) : 2.6;
  const overloadUnlocked = upgrades.loop_overload >= 1;
  const overloadMultiplier = overloadUnlocked ? 1.8 + (upgrades.loop_overload - 1) * 0.2 : 1;

  const magnetRadius = 5.5 * (1 + upgrades.magnet_radius * 0.2) * (hasHarvest ? 2 : 1);
  const magnetSpeed = 14 * (1 + upgrades.magnet_speed * 0.2);
  const moveSpeed = 9.4 * (hasChronos ? 1.22 : 1);
  const shardMult = (hasHarvest ? 1.75 : 1) * prestigeMult;

  return {
    damage,
    fireRate,
    relayMultiplier,
    ricochetCount,
    pierceCount,
    blastRadius,
    weaponTier,
    loopDuration,
    echoSlots,
    echoPowerMult,
    dashUnlocked,
    dashCooldown,
    overloadUnlocked,
    overloadMultiplier,
    magnetRadius,
    magnetSpeed,
    moveSpeed,
    shardMult,
    prestigeMult,
    platformsLevel: upgrades.arena_platforms,
    mobileGeodeBonusCount: upgrades.arena_mobile * 2,
    twinMult: 3.5 + upgrades.arena_twins * 0.6,
    armoredGeodeCount: upgrades.arena_armored,
    explosiveGeodeCount: upgrades.arena_explosive,
    goldenGeodeCount: upgrades.arena_golden,
  };
}

export function getEchoEffectiveRate(
  echo: Pick<EchoRecord, 'baseRate'>,
  stats: ComputedStats,
  suppressed = false,
): number {
  return echo.baseRate * stats.echoPowerMult * (suppressed ? 0.3 : 1);
}

export function getTotalEchoesRate(
  echoes: EchoRecord[],
  stats: ComputedStats,
  suppressedIds?: Set<string>,
): number {
  let sum = 0;
  for (let i = 0; i < echoes.length; i++) {
    const e = echoes[i];
    sum += getEchoEffectiveRate(e, stats, suppressedIds?.has(e.id));
  }
  return sum;
}

export interface EchoEvaluationResult {
  echoes: EchoRecord[];
  status: 'added' | 'replaced' | 'discarded';
  message: string;
  replacedRate?: number;
  newRate: number;
}

export function evaluateNewEcho(
  currentEchoes: EchoRecord[],
  candidate: EchoRecord,
  stats: ComputedStats,
): EchoEvaluationResult {
  const newEffectiveRate = getEchoEffectiveRate(candidate, stats);

  if (candidate.baseRate <= 0 || candidate.loopShards <= 0) {
    return {
      echoes: currentEchoes,
      status: 'discarded',
      message: 'Boucle vide : aucun éclat récolté, écho ignoré',
      newRate: 0,
    };
  }

  if (currentEchoes.length < stats.echoSlots) {
    const next = [...currentEchoes, candidate].sort((a, b) => b.baseRate - a.baseRate);
    return {
      echoes: next,
      status: 'added',
      message: `Nouvel écho : +${formatShards(newEffectiveRate)}/s`,
      newRate: newEffectiveRate,
    };
  }

  let weakestIdx = 0;
  for (let i = 1; i < currentEchoes.length; i++) {
    if (currentEchoes[i].baseRate < currentEchoes[weakestIdx].baseRate) {
      weakestIdx = i;
    }
  }

  const weakest = currentEchoes[weakestIdx];
  const weakestEffectiveRate = getEchoEffectiveRate(weakest, stats);

  if (candidate.baseRate > weakest.baseRate) {
    const next = [...currentEchoes];
    next[weakestIdx] = candidate;
    next.sort((a, b) => b.baseRate - a.baseRate);
    return {
      echoes: next,
      status: 'replaced',
      message: `Nouvel écho : +${formatShards(newEffectiveRate)}/s (remplace ${formatShards(weakestEffectiveRate)}/s)`,
      replacedRate: weakestEffectiveRate,
      newRate: newEffectiveRate,
    };
  }

  return {
    echoes: currentEchoes,
    status: 'discarded',
    message: `Boucle rejetée (+${formatShards(newEffectiveRate)}/s ≤ min ${formatShards(weakestEffectiveRate)}/s)`,
    newRate: newEffectiveRate,
  };
}

export function computeOfflineEarnings(
  echoes: EchoRecord[],
  stats: ComputedStats,
  elapsedSeconds: number,
): { gained: number; cappedSeconds: number; ratePerSec: number } {
  const cappedSeconds = Math.max(0, Math.min(OFFLINE_CAP_SECONDS, elapsedSeconds));
  const ratePerSec = getTotalEchoesRate(echoes, stats);
  const gained = Math.floor(ratePerSec * cappedSeconds);
  return { gained, cappedSeconds, ratePerSec };
}

export function computePrestigePotential(
  runShardsEarned: number,
  echoes: EchoRecord[],
  stats: ComputedStats,
): {
  fragmentsEarned: number;
  canPrestige: boolean;
  nextThresholdShards: number;
  score: number;
} {
  const rate = getTotalEchoesRate(echoes, stats);
  const score = runShardsEarned + rate * 60;
  const threshold = PRESTIGE_SCORE_THRESHOLD;
  if (score < threshold) {
    return {
      fragmentsEarned: 0,
      canPrestige: false,
      nextThresholdShards: threshold,
      score,
    };
  }
  const fragmentsEarned = Math.max(5, Math.floor(Math.pow(score / threshold, 0.55) * 6));
  const nextFragments = fragmentsEarned + 1;
  const nextThresholdShards = Math.ceil(threshold * Math.pow(nextFragments / 6, 1 / 0.55));
  return {
    fragmentsEarned,
    canPrestige: fragmentsEarned >= 1,
    nextThresholdShards,
    score,
  };
}

export function findNextAffordableUpgrade(
  shards: number,
  upgrades: UpgradeLevels,
): { id: UpgradeId; name: string; cost: number; missing: number } | null {
  let best: { id: UpgradeId; name: string; cost: number; missing: number } | null = null;
  for (const def of UPGRADE_DEFS) {
    const lvl = upgrades[def.id] ?? 0;
    if (lvl >= def.maxLevel) continue;
    const cost = getUpgradeCost(def.id, lvl);
    if (!best || cost < best.cost) {
      best = {
        id: def.id,
        name: def.name,
        cost,
        missing: Math.max(0, cost - shards),
      };
    }
  }
  return best;
}
