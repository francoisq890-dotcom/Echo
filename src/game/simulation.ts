import { PrestigePerkId, UPGRADE_DEFS, UpgradeId } from './config';
import {
  computePrestigePotential,
  computeStats,
  createDefaultUpgrades,
  EchoRecord,
  evaluateNewEcho,
  getTotalEchoesRate,
  getUpgradeCost,
  UpgradeLevels,
} from './economy';

export interface SimulationReport {
  firstUpgradeTimeSec: number;
  earlyPurchaseIntervals: number[];
  avgEarlyPurchaseIntervalSec: number;
  maxGapBetweenPurchasesSec: number;
  earlyActiveToIdleRatio: number;
  firstPrestigeTimeSec: number | null;
  totalPurchases: number;
  finalShardsPerSec: number;
  postPrestigeTimeTo10kSec: number;
  prePrestigeTimeTo10kSec: number;
  postPrestigeSpeedup: number;
  passedAllRules: boolean;
  failures: string[];
}

function simulateRun(options: {
  temporalFragments: number;
  perks: PrestigePerkId[];
  maxSeconds: number;
  stopAtPrestige: boolean;
  stopAtShards?: number;
}): {
  elapsedSec: number;
  purchaseTimes: number[];
  earlyActiveRatios: number[];
  prestigeTime: number | null;
  timeToTargetShards: number | null;
  finalRate: number;
} {
  const upgrades: UpgradeLevels = createDefaultUpgrades();
  let echoes: EchoRecord[] = [];
  let shards = 0;
  let runShards = 0;
  let elapsed = 0;
  let prestigeTime: number | null = null;
  let timeToTargetShards: number | null = null;
  const purchaseTimes: number[] = [];
  const earlyActiveRatios: number[] = [];

  // Smart bot buys highest-ROI available upgrade each loop
  const pickNextUpgrade = (currentShards: number, st: ReturnType<typeof computeStats>): UpgradeId | null => {
    let bestId: UpgradeId | null = null;
    let bestScore = -1;

    for (const def of UPGRADE_DEFS) {
      const lvl = upgrades[def.id] ?? 0;
      if (lvl >= def.maxLevel) continue;
      const cost = getUpgradeCost(def.id, lvl);
      if (cost > currentShards) continue;

      // Priority heuristic matching a smart human player
      let weight = 1.0;
      if (def.id === 'weapon_damage' || def.id === 'weapon_rate') weight = 2.6;
      else if (def.id === 'loop_power' || def.id === 'loop_slots') weight = 2.4;
      else if (def.id === 'weapon_relay' || def.id === 'arena_twins') weight = 2.2;
      else if (def.id === 'arena_mobile' || def.id === 'arena_armored' || def.id === 'arena_golden') weight = 2.3;
      else if (def.id === 'arena_platforms' || def.id === 'arena_explosive') weight = 2.0;
      else if (def.id === 'loop_overload') weight = 2.5;
      else if (def.id === 'loop_dash') weight = 1.7;
      else if (def.id === 'weapon_ricochet' || def.id === 'weapon_pierce' || def.id === 'weapon_blast') weight = 2.1;
      else if (def.id === 'magnet_radius' || def.id === 'magnet_speed') weight = 1.25;
      else if (def.id === 'loop_duration') weight = 1.5;

      // Slight preference for lower-cost affordable upgrades early to keep cadence brisk
      const roi = weight / Math.max(10, cost / Math.max(1, st.damage * 0.2));
      if (roi > bestScore) {
        bestScore = roi;
        bestId = def.id;
      }
    }
    return bestId;
  };

  let loopIndex = 0;
  while (elapsed < options.maxSeconds) {
    const stats = computeStats(upgrades, options.temporalFragments, options.perks);
    const useOverload = stats.overloadUnlocked && loopIndex % 2 === 1;
    const loopDur = useOverload ? stats.loopDuration * 0.75 : stats.loopDuration;
    const overloadBonus = useOverload ? stats.overloadMultiplier : 1;

    // Model average player loop performance:
    // Time per geode = aim/travel overhead (1.1s reduced by speed/dash) + shots to break (hp / dps)
    const travelTime = Math.max(0.42, (1.15 - (stats.dashUnlocked ? 0.18 : 0)) * (9.4 / stats.moveSpeed));
    const avgGeodeHp = 20 + stats.armoredGeodeCount * 3.5;
    const relayUseFactor = echoes.length > 0 ? 1 + (stats.relayMultiplier - 1) * 0.28 : 1;
    const effectiveDps =
      stats.damage *
      stats.fireRate *
      relayUseFactor *
      (1 + (stats.pierceCount - 1) * 0.22 + stats.ricochetCount * 0.25 + (stats.blastRadius > 0 ? 0.35 : 0));

    const timePerGeode = travelTime + Math.max(0.28, avgGeodeHp / Math.max(1, effectiveDps));
    const geodesBroken = Math.max(3, Math.floor((loopDur / timePerGeode) * 0.92));

    // Average shard value per geode grows as arena variants & twins/switches unlock
    const baseVal =
      8.5 +
      stats.mobileGeodeBonusCount * 0.9 +
      stats.platformsLevel * 2.2 +
      stats.armoredGeodeCount * 3.4 +
      stats.explosiveGeodeCount * 2.8 +
      stats.goldenGeodeCount * 5.5;

    // Active synergy bonuses: Twin sync (after 1st echo), Switch vault (after 2nd echo), Devourer bounties
    const twinBonus = echoes.length >= 1 ? 1 + (stats.twinMult - 1) * 0.14 : 1;
    const switchBonus = echoes.length >= 2 ? 1.18 : 1;
    const devourerBounty = echoes.length >= 2 ? 1.08 : 1;

    const activeLoopShards =
      geodesBroken *
      baseVal *
      stats.shardMult *
      twinBonus *
      switchBonus *
      devourerBounty *
      overloadBonus;

    const idleRate = getTotalEchoesRate(echoes, stats);
    const idleLoopShards = idleRate * loopDur;
    const activeRate = activeLoopShards / loopDur;

    if (idleRate > 0 && elapsed < 600) {
      earlyActiveRatios.push(activeRate / idleRate);
    }

    shards += activeLoopShards + idleLoopShards;
    runShards += activeLoopShards + idleLoopShards;
    elapsed += loopDur;
    loopIndex++;

    if (options.stopAtShards && timeToTargetShards === null && runShards >= options.stopAtShards) {
      timeToTargetShards = elapsed;
    }

    // Record loop as Echo candidate
    const candidate: EchoRecord = {
      id: `bot_${loopIndex}`,
      createdAt: elapsed,
      baseRate: activeLoopShards / loopDur,
      loopShards: activeLoopShards,
      duration: loopDur,
      samples: [],
      shots: [],
    };
    echoes = evaluateNewEcho(echoes, candidate, stats).echoes;

    // Smart player visits terminal roughly every 36s (3 loops) once initial upgrade is unlocked
    const sinceLastBuy =
      purchaseTimes.length > 0 ? elapsed - purchaseTimes[purchaseTimes.length - 1] : elapsed;
    if (purchaseTimes.length === 0 || sinceLastBuy >= 36) {
      const bought = pickNextUpgrade(shards, stats);
      if (bought) {
        const cost = getUpgradeCost(bought, upgrades[bought] ?? 0);
        if (shards >= cost) {
          shards -= cost;
          upgrades[bought] = (upgrades[bought] ?? 0) + 1;
          purchaseTimes.push(elapsed);
        }
      }
    }

    // Check prestige threshold
    const pot = computePrestigePotential(
      runShards,
      echoes,
      computeStats(upgrades, options.temporalFragments, options.perks),
    );
    if (pot.canPrestige && prestigeTime === null) {
      prestigeTime = elapsed;
      if (options.stopAtPrestige) break;
    }
  }

  const endStats = computeStats(upgrades, options.temporalFragments, options.perks);
  return {
    elapsedSec: elapsed,
    purchaseTimes,
    earlyActiveRatios,
    prestigeTime,
    timeToTargetShards,
    finalRate: getTotalEchoesRate(echoes, endStats),
  };
}

export function runEconomySimulation(): SimulationReport {
  const firstRun = simulateRun({
    temporalFragments: 0,
    perks: [],
    maxSeconds: 3600,
    stopAtPrestige: false,
    stopAtShards: 10000,
  });

  const firstUpgradeTimeSec = firstRun.purchaseTimes[0] ?? Infinity;

  // Measure purchase intervals across early game (first 15 min)
  const earlyTimes = firstRun.purchaseTimes.filter((t) => t <= 900);
  const earlyPurchaseIntervals: number[] = [];
  for (let i = 1; i < earlyTimes.length; i++) {
    earlyPurchaseIntervals.push(earlyTimes[i] - earlyTimes[i - 1]);
  }
  // Also measure max gap across the full run up to prestige
  const endBound = firstRun.prestigeTime ?? 2700;
  const runTimes = [0, ...firstRun.purchaseTimes.filter((t) => t <= endBound)];
  let maxGap = 0;
  for (let i = 1; i < runTimes.length; i++) {
    maxGap = Math.max(maxGap, runTimes[i] - runTimes[i - 1]);
  }

  const avgEarlyPurchaseIntervalSec =
    earlyPurchaseIntervals.length > 0
      ? earlyPurchaseIntervals.reduce((a, b) => a + b, 0) / earlyPurchaseIntervals.length
      : Infinity;

  const earlyActiveToIdleRatio =
    firstRun.earlyActiveRatios.length > 0
      ? firstRun.earlyActiveRatios.reduce((a, b) => a + b, 0) / firstRun.earlyActiveRatios.length
      : 0;

  // Simulate post-prestige run with 8 fragments + 1 perk
  const postRun = simulateRun({
    temporalFragments: 8,
    perks: ['golden_harvest'],
    maxSeconds: 1800,
    stopAtPrestige: false,
    stopAtShards: 10000,
  });

  const pre10k = firstRun.timeToTargetShards ?? 1800;
  const post10k = postRun.timeToTargetShards ?? 1800;
  const postPrestigeSpeedup = pre10k / Math.max(1, post10k);

  const failures: string[] = [];
  if (firstUpgradeTimeSec > 45) {
    failures.push(`First upgrade took ${firstUpgradeTimeSec.toFixed(1)}s (> 45s)`);
  }
  if (avgEarlyPurchaseIntervalSec < 30 || avgEarlyPurchaseIntervalSec > 90) {
    failures.push(`Avg early purchase interval ${avgEarlyPurchaseIntervalSec.toFixed(1)}s outside 30-90s target`);
  }
  if (maxGap > 180) {
    failures.push(`Max wait between purchases was ${maxGap.toFixed(1)}s (> 180s)`);
  }
  if (earlyActiveToIdleRatio < 2.0) {
    failures.push(`Early active/idle ratio was ${earlyActiveToIdleRatio.toFixed(2)} (< 2.0)`);
  }
  if (
    firstRun.prestigeTime === null ||
    firstRun.prestigeTime < 1800 ||
    firstRun.prestigeTime > 2700
  ) {
    failures.push(
      `First prestige time ${firstRun.prestigeTime ? (firstRun.prestigeTime / 60).toFixed(1) + 'm' : 'never'} not in 30-45 min`,
    );
  }
  if (postPrestigeSpeedup < 2.0) {
    failures.push(`Post-prestige speedup ${postPrestigeSpeedup.toFixed(2)}x (< 2.0x)`);
  }

  return {
    firstUpgradeTimeSec,
    earlyPurchaseIntervals,
    avgEarlyPurchaseIntervalSec,
    maxGapBetweenPurchasesSec: maxGap,
    earlyActiveToIdleRatio,
    firstPrestigeTimeSec: firstRun.prestigeTime,
    totalPurchases: firstRun.purchaseTimes.length,
    finalShardsPerSec: firstRun.finalRate,
    postPrestigeTimeTo10kSec: post10k,
    prePrestigeTimeTo10kSec: pre10k,
    postPrestigeSpeedup,
    passedAllRules: failures.length === 0,
    failures,
  };
}
