import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOfflineEarnings,
  computePrestigePotential,
  computeStats,
  createDefaultUpgrades,
  evaluateNewEcho,
  findNextAffordableUpgrade,
  formatShards,
  getEchoEffectiveRate,
  getUpgradeCost,
} from './economy';
import { collectEchoShotsInWindow, EchoRecorder, sampleEchoPose } from './echoes';
import { createInitialSaveState, exportSaveText, importSaveText, sanitizeSaveState } from './storage';
import { runEconomySimulation } from './simulation';
import {
  BASE_ECHO_REPLICATION,
  OFFLINE_CAP_SECONDS,
  PRESTIGE_SCORE_THRESHOLD,
} from './config';

test('formatShards formats compact numbers cleanly', () => {
  assert.equal(formatShards(0), '0');
  assert.equal(formatShards(420), '420');
  assert.equal(formatShards(1200), '1.2K');
  assert.equal(formatShards(3400000), '3.4M');
  assert.equal(formatShards(1500000000), '1.5B');
});

test('upgrade cost follows base * 1.15^n formula', () => {
  assert.equal(getUpgradeCost('weapon_damage', 0), 48);
  assert.equal(getUpgradeCost('weapon_damage', 1), Math.round(48 * 1.15));
  assert.equal(getUpgradeCost('weapon_damage', 5), Math.round(48 * Math.pow(1.15, 5)));
});

test('evaluateNewEcho adds, replaces weakest, and discards inferior loops with exact messages', () => {
  const stats = computeStats(createDefaultUpgrades(), 0, []);
  const makeEcho = (id: string, baseRate: number) => ({
    id,
    createdAt: 1,
    baseRate,
    loopShards: baseRate * 12,
    duration: 12,
    samples: [0, 0, 1.7, 0, 0, 0],
    shots: [],
  });

  let echoes = evaluateNewEcho([], makeEcho('e1', 100), stats).echoes;
  echoes = evaluateNewEcho(echoes, makeEcho('e2', 200), stats).echoes;
  echoes = evaluateNewEcho(echoes, makeEcho('e3', 300), stats).echoes;
  assert.equal(echoes.length, 3);

  const replaced = evaluateNewEcho(echoes, makeEcho('e4', 250), stats);
  assert.equal(replaced.status, 'replaced');
  assert.match(replaced.message, /Nouvel écho : \+35\/s \(remplace 14\/s\)/);
  assert.equal(replaced.echoes.length, 3);
  assert.ok(replaced.echoes.every((e) => e.baseRate >= 200));

  const discarded = evaluateNewEcho(replaced.echoes, makeEcho('e5', 150), stats);
  assert.equal(discarded.status, 'discarded');
  assert.match(discarded.message, /rejetée/i);
  assert.equal(discarded.echoes.length, 3);
});

test('getEchoEffectiveRate applies Devourer 70% suppression cleanly', () => {
  const stats = computeStats(createDefaultUpgrades(), 0, []);
  const normal = getEchoEffectiveRate({ baseRate: 100 }, stats, false);
  const suppressed = getEchoEffectiveRate({ baseRate: 100 }, stats, true);
  assert.ok(Math.abs(normal - 100 * BASE_ECHO_REPLICATION) < 0.001);
  assert.ok(Math.abs(suppressed - normal * 0.3) < 0.001);
});

test('computeOfflineEarnings caps at 8 hours', () => {
  const stats = computeStats(createDefaultUpgrades(), 0, []);
  const echoes = [
    {
      id: 'e1',
      createdAt: 1,
      baseRate: 100,
      loopShards: 1200,
      duration: 12,
      samples: [],
      shots: [],
    },
  ];
  const res = computeOfflineEarnings(echoes, stats, 24 * 3600);
  assert.equal(res.cappedSeconds, OFFLINE_CAP_SECONDS);
  assert.equal(res.gained, Math.floor(100 * BASE_ECHO_REPLICATION * OFFLINE_CAP_SECONDS));
});

test('EchoRecorder & sampleEchoPose interpolate 20Hz samples and wrap shots cleanly', () => {
  const rec = new EchoRecorder();
  rec.recordFrame(0, 0, 1.7, 0, 0, 0, true);
  rec.recordFrame(0.5, 10, 1.7, -5, 1, 0.2, true);
  rec.recordShot(0.25, 0, 1.7, 0, 0, 0, -1);
  const record = rec.finalize('test', 12, 120);

  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const ok = sampleEchoPose(record, 0.25, pose);
  assert.equal(ok, true);
  assert.ok(Math.abs(pose.x - 5) < 0.01);
  assert.ok(Math.abs(pose.z - -2.5) < 0.01);

  const shots = collectEchoShotsInWindow(record, 0.2, 0.3);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].t, 0.25);
});

test('save export, import, and legacy tutorial migration round-trip cleanly', () => {
  const save = createInitialSaveState();
  save.shards = 1234;
  save.upgrades.weapon_damage = 3;
  save.perks = ['echo_chorus'];
  save.overloadArmed = true;

  const encoded = exportSaveText(save);
  assert.ok(encoded.startsWith('ECHO1:'));
  const decoded = importSaveText(encoded);
  assert.ok(decoded !== null);
  assert.equal(decoded.shards, 1234);
  assert.equal(decoded.upgrades.weapon_damage, 3);
  assert.equal(decoded.overloadArmed, true);
  assert.deepEqual(decoded.perks, ['echo_chorus']);

  const migrated = sanitizeSaveState({ tutorialStep: 'better_loop' });
  assert.equal(migrated?.tutorialStep, 'relay_shot');
});

test('computePrestigePotential unlocks after sufficient progression', () => {
  const stats = computeStats(createDefaultUpgrades(), 0, []);
  const low = computePrestigePotential(5000, [], stats);
  assert.equal(low.canPrestige, false);
  const high = computePrestigePotential(PRESTIGE_SCORE_THRESHOLD + 5000, [], stats);
  assert.equal(high.canPrestige, true);
  assert.ok(high.fragmentsEarned >= 5);
});

test('findNextAffordableUpgrade identifies lowest-cost available upgrade', () => {
  const ups = createDefaultUpgrades();
  const next = findNextAffordableUpgrade(20, ups);
  assert.ok(next !== null);
  assert.equal(next.id, 'weapon_damage');
  assert.equal(next.cost, 48);
  assert.equal(next.missing, 28);
});

test('economy simulation verifies all balancing rules pass', () => {
  const report = runEconomySimulation();
  assert.equal(
    report.passedAllRules,
    true,
    `Simulation failed: ${report.failures.join('; ')}`,
  );
  assert.ok(report.firstUpgradeTimeSec <= 45);
  assert.ok(report.earlyActiveToIdleRatio >= 2.0);
  assert.ok(
    report.firstPrestigeTimeSec !== null &&
      report.firstPrestigeTimeSec >= 1800 &&
      report.firstPrestigeTimeSec <= 2700,
  );
  assert.ok(report.postPrestigeSpeedup >= 2.0);
});
