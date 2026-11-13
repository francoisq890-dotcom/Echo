import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GameSettings,
  PrestigePerkId,
  TutorialStepId,
  UpgradeId,
} from './game/config';
import {
  computeOfflineEarnings,
  computePrestigePotential,
  computeStats,
  EchoRecord,
  evaluateNewEcho,
  getTotalEchoesRate,
  getUpgradeCost,
} from './game/economy';
import {
  createInitialSaveState,
  exportSaveText,
  importSaveText,
  loadSaveFromStorage,
  persistSaveToStorage,
  SaveState,
} from './game/storage';
import { SoundEngine } from './game/audio';
import { JoystickVisualState, UnifiedInputController } from './game/controls';
import {
  EchoWorldEngine,
  FloatingPopupEvent,
  WorldHudSnapshot,
} from './game/world';
import { TitleScreen } from './components/TitleScreen';
import { GameHUD } from './components/GameHUD';
import { TerminalModal } from './components/TerminalModal';
import { PauseModal } from './components/PauseModal';
import { OfflineModal } from './components/OfflineModal';
import { PortraitGuard } from './components/PortraitGuard';
import {
  advanceNotificationQueue,
  createNotificationQueueState,
  EnqueueInput,
  enqueueNotification,
} from './game/notifications';

type ScreenState = 'title' | 'playing' | 'terminal' | 'paused';

export default function App() {
  const initialSave = useMemo(() => loadSaveFromStorage() ?? createInitialSaveState(), []);
  const [save, setSave] = useState<SaveState>(initialSave);
  const saveRef = useRef<SaveState>(initialSave);

  const autostart = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);

  const [screen, setScreen] = useState<ScreenState>(autostart ? 'playing' : 'title');
  const screenRef = useRef<ScreenState>(screen);

  // Offline earnings check
  const [offlineGain, setOfflineGain] = useState<{
    echoCount: number;
    gained: number;
    elapsed: number;
  } | null>(() => {
    if (autostart || initialSave.echoes.length === 0) return null;
    const elapsed = (Date.now() - initialSave.savedAt) / 1000;
    if (elapsed < 45) return null;
    const st = computeStats(initialSave.upgrades, initialSave.temporalFragments, initialSave.perks);
    const res = computeOfflineEarnings(initialSave.echoes, st, elapsed);
    if (res.gained < 1) return null;
    return {
      echoCount: initialSave.echoes.length,
      gained: res.gained,
      elapsed: res.cappedSeconds,
    };
  });

  // High-frequency HUD state (updated <= 12Hz)
  const [hud, setHud] = useState<WorldHudSnapshot>({
    loopTime: 0,
    loopDuration: 12,
    loopShards: 0,
    combo: 0,
    aimingAtGeode: false,
    nearTerminal: false,
    echoLabels: [],
    dashUnlocked: false,
    dashCooldownRemaining: 0,
    dashCooldownMax: 2.6,
    overloadActive: false,
    vaultOpen: false,
    vaultTimer: 0,
    suppressedCount: 0,
    activeDevourers: 0,
    activeRatePerSec: 0,
  });
  const [suppressedIds, setSuppressedIds] = useState<string[]>([]);
  const [displayShards, setDisplayShards] = useState(initialSave.shards);
  const pendingShardsRef = useRef(0);
  const [popups, setPopups] = useState<FloatingPopupEvent[]>([]);
  const [hitMarker, setHitMarker] = useState<'none' | 'hit' | 'crit'>('none');
  const [loopFlash, setLoopFlash] = useState(false);
  const [notifQueue, setNotifQueue] = useState(createNotificationQueueState);
  const prevSuppressedCountRef = useRef(0);
  const pushNotification = useCallback((input: EnqueueInput) => {
    setNotifQueue((q) => enqueueNotification(q, input, performance.now()));
  }, []);
  const [joystick, setJoystick] = useState<JoystickVisualState>({
    active: false,
    originX: 0,
    originY: 0,
    knobX: 0,
    knobY: 0,
  });

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EchoWorldEngine | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const inputRef = useRef<UnifiedInputController | null>(null);
  const bestEchoRateRef = useRef<number>(
    initialSave.echoes.reduce((m, e) => Math.max(m, e.baseRate), 0),
  );
  const watchEchoTimerRef = useRef<number | null>(null);

  const stats = useMemo(
    () => computeStats(save.upgrades, save.temporalFragments, save.perks),
    [save.upgrades, save.temporalFragments, save.perks],
  );
  const suppressedSet = useMemo(() => new Set(suppressedIds), [suppressedIds]);
  const totalRatePerSec = useMemo(
    () => getTotalEchoesRate(save.echoes, stats, suppressedSet),
    [save.echoes, stats, suppressedSet],
  );

  // Advance single top-center notification queue every 2s
  useEffect(() => {
    if (!notifQueue.active) return;
    const delay = Math.max(20, notifQueue.active.expiresAt - performance.now());
    const t = window.setTimeout(() => {
      setNotifQueue((q) => advanceNotificationQueue(q, performance.now()));
    }, delay);
    return () => clearTimeout(t);
  }, [notifQueue.active]);

  // Sync body dataset.state for game shell discipline
  useEffect(() => {
    screenRef.current = screen;
    const mapped =
      screen === 'title' ? 'title' : screen === 'playing' ? 'playing' : 'paused';
    document.body.dataset.state = mapped;
    engineRef.current?.setMode(mapped);
  }, [screen]);

  // Flush pending shards cleanly into save state
  const flushPendingShards = useCallback(() => {
    const delta = pendingShardsRef.current;
    if (delta <= 0) return;
    pendingShardsRef.current = 0;
    setSave((prev) => {
      const next = {
        ...prev,
        shards: prev.shards + delta,
        runShardsEarned: prev.runShardsEarned + delta,
        lifetimeShards: prev.lifetimeShards + delta,
      };
      saveRef.current = next;
      return next;
    });
  }, []);

  // Keep engine synced whenever upgrades/echoes/settings/overload change
  useEffect(() => {
    saveRef.current = save;
    engineRef.current?.syncProgression(stats, save.echoes, save.settings);
    engineRef.current?.setOverloadArmed(save.overloadArmed);
    setDisplayShards(save.shards + pendingShardsRef.current);
  }, [save, stats]);

  // Auto-save every 10s + on pagehide/visibilitychange
  useEffect(() => {
    const doSave = () => {
      flushPendingShards();
      persistSaveToStorage(saveRef.current);
    };
    const interval = window.setInterval(doSave, 10000);
    const onVis = () => {
      if (document.hidden) doSave();
    };
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', doSave);
    window.addEventListener('beforeunload', doSave);
    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', doSave);
      window.removeEventListener('beforeunload', doSave);
      doSave();
    };
  }, [flushPendingShards]);

  // Mount Three.js engine once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const sound = new SoundEngine();
    soundRef.current = sound;
    sound.setMuted(saveRef.current.settings.muted);
    sound.setVibration(saveRef.current.settings.vibration);

    const input = new UnifiedInputController({
      onFirstGesture: () => sound.unlock(),
      onPauseRequested: () => {
        if (screenRef.current === 'playing') {
          flushPendingShards();
          setScreen('paused');
        }
      },
      onJoystickChange: (js) => setJoystick(js),
    });
    inputRef.current = input;

    const initialStats = computeStats(
      saveRef.current.upgrades,
      saveRef.current.temporalFragments,
      saveRef.current.perks,
    );

    const engine = new EchoWorldEngine({
      container,
      sound,
      input,
      initialStats,
      initialEchoes: saveRef.current.echoes,
      initialSettings: saveRef.current.settings,
      callbacks: {
        onHudUpdate: (snap) => {
          setHud(snap);
          setDisplayShards(saveRef.current.shards + pendingShardsRef.current);
          if (pendingShardsRef.current >= 1) {
            flushPendingShards();
          }
        },
        onShardsCollected: (amount) => {
          pendingShardsRef.current += amount;
          setDisplayShards(saveRef.current.shards + pendingShardsRef.current);
        },
        onGeodeBroken: () => {
          setSave((prev) => {
            const nextBroken = prev.totalGeodesBroken + 1;
            let nextTut: TutorialStepId = prev.tutorialStep;
            if (prev.tutorialStep === 'break_5_geodes' && nextBroken >= 5) {
              nextTut = 'finish_loop';
            }
            const next = { ...prev, totalGeodesBroken: nextBroken, tutorialStep: nextTut };
            saveRef.current = next;
            return next;
          });
        },
        onLoopCompleted: (record: EchoRecord) => {
          flushPendingShards();
          setSave((prev) => {
            const currStats = computeStats(prev.upgrades, prev.temporalFragments, prev.perks);
            const result = evaluateNewEcho(prev.echoes, record, currStats);
            pushNotification({
              dedupeKey: 'echo',
              text: result.message,
              tone: result.status === 'discarded' ? 'coral' : 'cyan',
              priority: 3,
              cooldownMs: 0,
            });

            let nextTut: TutorialStepId = prev.tutorialStep;
            if (prev.tutorialStep === 'finish_loop' || prev.tutorialStep === 'break_5_geodes') {
              nextTut = 'watch_echo';
              if (watchEchoTimerRef.current) clearTimeout(watchEchoTimerRef.current);
              watchEchoTimerRef.current = window.setTimeout(() => {
                setSave((s) =>
                  s.tutorialStep === 'watch_echo' ? { ...s, tutorialStep: 'buy_upgrade' } : s,
                );
              }, 4200);
            }

            if (record.baseRate > bestEchoRateRef.current) {
              bestEchoRateRef.current = record.baseRate;
            }

            const next = {
              ...prev,
              echoes: result.echoes,
              loopsCompleted: prev.loopsCompleted + 1,
              tutorialStep: nextTut,
            };
            saveRef.current = next;
            persistSaveToStorage(next);
            return next;
          });
        },
        onOpenTerminal: () => {
          flushPendingShards();
          setScreen('terminal');
        },
        onFloatingPopup: (popup) => {
          setPopups((prev) => [...prev.slice(-11), popup]);
          window.setTimeout(() => {
            setPopups((prev) => prev.filter((item) => item.id !== popup.id));
          }, 820);
        },
        onHitMarker: (crit) => {
          setHitMarker(crit ? 'crit' : 'hit');
          window.setTimeout(() => setHitMarker('none'), 95);
        },
        onLoopFlash: () => {
          setLoopFlash(true);
          window.setTimeout(() => setLoopFlash(false), 320);
        },
        onFirstMoveOrAim: (moved, aimed) => {
          if (moved && aimed && !saveRef.current.hasSeenGhostHands) {
            setSave((prev) => {
              if (prev.hasSeenGhostHands) return prev;
              const next = { ...prev, hasSeenGhostHands: true };
              saveRef.current = next;
              return next;
            });
          }
        },
        onRelayShot: (multiplier) => {
          pushNotification({
            dedupeKey: 'relay',
            text: `Relais ×${multiplier.toFixed(1)}`,
            tone: 'gold',
            priority: 1,
            cooldownMs: 10000,
          });
          setSave((prev) => {
            if (prev.tutorialStep !== 'relay_shot') return prev;
            const next = { ...prev, tutorialStep: 'twin_geode' as TutorialStepId };
            saveRef.current = next;
            return next;
          });
        },
        onTwinSynced: (multiplier) => {
          pushNotification({
            dedupeKey: 'twin',
            text: `Synchro Jumelle ×${multiplier.toFixed(1)}`,
            tone: 'gold',
            priority: 3,
            cooldownMs: 3000,
          });
          setSave((prev) => {
            if (prev.tutorialStep !== 'twin_geode' && prev.tutorialStep !== 'relay_shot') return prev;
            const next = { ...prev, tutorialStep: 'switch_vault' as TutorialStepId };
            saveRef.current = next;
            return next;
          });
        },
        onSwitchActivated: (byEcho, justOpened) => {
          if (justOpened) {
            pushNotification({
              dedupeKey: 'vault',
              text: 'Sanctuaire ouvert',
              tone: 'gold',
              priority: 2,
              cooldownMs: 4000,
            });
          }
          setSave((prev) => {
            if (prev.tutorialStep !== 'switch_vault') return prev;
            if (!byEcho && prev.echoes.length === 0) return prev;
            const next = { ...prev, tutorialStep: 'defeat_devourer' as TutorialStepId };
            saveRef.current = next;
            return next;
          });
        },
        onDevourerSlain: () => {
          pushNotification({
            dedupeKey: 'devourer_slain',
            text: 'Dévoreur éliminé',
            tone: 'cyan',
            priority: 2,
            cooldownMs: 4000,
          });
          setSave((prev) => {
            if (prev.tutorialStep !== 'defeat_devourer') return prev;
            const next = { ...prev, tutorialStep: 'reach_prestige' as TutorialStepId };
            saveRef.current = next;
            return next;
          });
        },
        onConvergence: () => {
          pushNotification({
            dedupeKey: 'convergence',
            text: 'Convergence · Dash prêt',
            tone: 'cyan',
            priority: 2,
            cooldownMs: 6000,
          });
        },
        onSuppressedChange: (ids) => {
          if (ids.length > 0 && prevSuppressedCountRef.current === 0) {
            pushNotification({
              dedupeKey: 'devourer',
              text: 'Dévoreur sur tes échos (-70%)',
              tone: 'crimson',
              priority: 3,
              cooldownMs: 5000,
            });
          }
          prevSuppressedCountRef.current = ids.length;
          setSuppressedIds(ids);
        },
      },
    });

    engineRef.current = engine;
    engine.setOverloadArmed(saveRef.current.overloadArmed);
    engine.setMode(autostart ? 'playing' : 'title');

    return () => {
      if (watchEchoTimerRef.current) clearTimeout(watchEchoTimerRef.current);
      engine.dispose();
      engineRef.current = null;
    };
  }, [autostart, flushPendingShards, pushNotification]);

  const startPlaying = useCallback(() => {
    soundRef.current?.unlock();
    setScreen('playing');
  }, []);

  // Enter / Space on Title screen starts immediately; Escape closes modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen === 'title' && !offlineGain && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        startPlaying();
      } else if ((screen === 'terminal' || screen === 'paused') && e.code === 'Escape') {
        e.preventDefault();
        setScreen('playing');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, offlineGain, startPlaying]);

  const handleBuyUpgrade = (id: UpgradeId) => {
    flushPendingShards();
    setSave((prev) => {
      const lvl = prev.upgrades[id] ?? 0;
      const cost = getUpgradeCost(id, lvl);
      if (prev.shards < cost || !Number.isFinite(cost)) return prev;
      soundRef.current?.playUpgrade();
      const nextUpgrades = { ...prev.upgrades, [id]: lvl + 1 };
      let nextTut = prev.tutorialStep;
      if (prev.tutorialStep === 'buy_upgrade' || prev.tutorialStep === 'watch_echo') {
        nextTut = 'relay_shot';
      }
      const next: SaveState = {
        ...prev,
        shards: prev.shards - cost,
        upgrades: nextUpgrades,
        tutorialStep: nextTut,
      };
      saveRef.current = next;
      persistSaveToStorage(next);
      return next;
    });
  };

  const handleToggleOverload = () => {
    setSave((prev) => {
      const nextArmed = !prev.overloadArmed;
      engineRef.current?.setOverloadArmed(nextArmed);
      const next = { ...prev, overloadArmed: nextArmed };
      saveRef.current = next;
      persistSaveToStorage(next);
      return next;
    });
  };

  const handlePrestige = (chosenPerk: PrestigePerkId) => {
    flushPendingShards();
    setSave((prev) => {
      const currStats = computeStats(prev.upgrades, prev.temporalFragments, prev.perks);
      const pot = computePrestigePotential(prev.runShardsEarned, prev.echoes, currStats);
      if (!pot.canPrestige) return prev;
      soundRef.current?.playCollapse();
      const fresh = createInitialSaveState();
      const nextPerks = prev.perks.includes(chosenPerk)
        ? prev.perks
        : [...prev.perks, chosenPerk];
      const next: SaveState = {
        ...fresh,
        temporalFragments: prev.temporalFragments + pot.fragmentsEarned,
        prestigeCount: prev.prestigeCount + 1,
        perks: nextPerks,
        lifetimeShards: prev.lifetimeShards,
        totalGeodesBroken: prev.totalGeodesBroken,
        loopsCompleted: prev.loopsCompleted,
        hasSeenGhostHands: true,
        tutorialStep: 'done',
        settings: prev.settings,
      };
      const nextStats = computeStats(next.upgrades, next.temporalFragments, next.perks);
      saveRef.current = next;
      persistSaveToStorage(next);
      engineRef.current?.resetForPrestige(nextStats, []);
      return next;
    });
    setScreen('playing');
  };

  const handleUpdateSettings = (nextSettings: GameSettings) => {
    setSave((prev) => {
      const next = { ...prev, settings: nextSettings };
      saveRef.current = next;
      persistSaveToStorage(next);
      return next;
    });
  };

  const handleImportSave = (text: string): boolean => {
    const imported = importSaveText(text);
    if (!imported) return false;
    pendingShardsRef.current = 0;
    saveRef.current = imported;
    setSave(imported);
    persistSaveToStorage(imported);
    const nextStats = computeStats(imported.upgrades, imported.temporalFragments, imported.perks);
    engineRef.current?.resetForPrestige(nextStats, imported.echoes);
    return true;
  };

  const handleHardReset = () => {
    pendingShardsRef.current = 0;
    const fresh = createInitialSaveState();
    saveRef.current = fresh;
    setSave(fresh);
    persistSaveToStorage(fresh);
    const nextStats = computeStats(fresh.upgrades, fresh.temporalFragments, fresh.perks);
    engineRef.current?.resetForPrestige(nextStats, []);
    setScreen('title');
  };

  const tutorialProgressText =
    save.tutorialStep === 'break_5_geodes'
      ? `(${Math.min(5, save.totalGeodesBroken)}/5)`
      : undefined;

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-host"
        className="fixed inset-0"
      />

      {screen === 'title' && (
        <TitleScreen
          hasProgress={save.lifetimeShards > 0 || save.echoes.length > 0}
          shards={save.shards}
          echoCount={save.echoes.length}
          onStart={startPlaying}
        />
      )}

      {screen === 'playing' && (
        <GameHUD
          shards={displayShards}
          runShardsEarned={save.runShardsEarned}
          totalRatePerSec={totalRatePerSec}
          echoCount={save.echoes.length}
          echoSlots={stats.echoSlots}
          echoes={save.echoes}
          upgrades={save.upgrades}
          stats={stats}
          prestigeMult={stats.prestigeMult}
          tutorialStep={save.tutorialStep}
          tutorialProgressText={tutorialProgressText}
          activeNotification={notifQueue.active}
          hud={hud}
          popups={popups}
          hitMarker={hitMarker}
          loopFlash={loopFlash}
          showGhostHands={!save.hasSeenGhostHands && save.loopsCompleted === 0}
          joystick={joystick}
          muted={save.settings.muted}
          overloadArmed={save.overloadArmed}
          onToggleOverload={handleToggleOverload}
          onToggleMute={() =>
            handleUpdateSettings({ ...save.settings, muted: !save.settings.muted })
          }
          onOpenPause={() => {
            flushPendingShards();
            setScreen('paused');
          }}
          onJump={() => inputRef.current?.triggerJump()}
          onDash={() => inputRef.current?.triggerDash()}
          onInteract={() => {
            flushPendingShards();
            setScreen('terminal');
          }}
        />
      )}

      {screen === 'terminal' && (
        <TerminalModal
          shards={save.shards}
          runShardsEarned={save.runShardsEarned}
          upgrades={save.upgrades}
          echoes={save.echoes}
          stats={stats}
          temporalFragments={save.temporalFragments}
          perks={save.perks}
          onBuyUpgrade={handleBuyUpgrade}
          onPrestige={handlePrestige}
          onClose={() => setScreen('playing')}
        />
      )}

      {screen === 'paused' && (
        <PauseModal
          settings={save.settings}
          saveExportString={exportSaveText(save)}
          onUpdateSettings={handleUpdateSettings}
          onImportSave={handleImportSave}
          onResume={() => setScreen('playing')}
          onReturnTitle={() => setScreen('title')}
          onHardReset={handleHardReset}
        />
      )}

      {offlineGain && (
        <OfflineModal
          echoCount={offlineGain.echoCount}
          gainedShards={offlineGain.gained}
          elapsedSeconds={offlineGain.elapsed}
          onClaim={() => {
            setSave((prev) => {
              const next = {
                ...prev,
                shards: prev.shards + offlineGain.gained,
                runShardsEarned: prev.runShardsEarned + offlineGain.gained,
                lifetimeShards: prev.lifetimeShards + offlineGain.gained,
              };
              saveRef.current = next;
              persistSaveToStorage(next);
              return next;
            });
            soundRef.current?.unlock();
            soundRef.current?.playUpgrade();
            setOfflineGain(null);
          }}
        />
      )}

      <PortraitGuard />
    </div>
  );
}
