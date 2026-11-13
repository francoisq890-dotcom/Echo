import React, { useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, Terminal, ArrowUp, Wind, Flame, X } from 'lucide-react';
import { TUTORIAL_LABELS, TutorialStepId } from '../game/config';
import {
  computePrestigePotential,
  EchoRecord,
  ComputedStats,
  findNextAffordableUpgrade,
  formatDurationCompact,
  formatShards,
  UpgradeLevels,
} from '../game/economy';
import { runEconomySimulation } from '../game/simulation';
import type { JoystickVisualState } from '../game/controls';
import type { NotificationItem } from '../game/notifications';
import type { FloatingPopupEvent, WorldHudSnapshot } from '../game/world';

interface GameHUDProps {
  shards: number;
  runShardsEarned: number;
  totalRatePerSec: number;
  echoCount: number;
  echoSlots: number;
  echoes: EchoRecord[];
  upgrades: UpgradeLevels;
  stats: ComputedStats;
  prestigeMult: number;
  tutorialStep: TutorialStepId;
  tutorialProgressText?: string;
  activeNotification: NotificationItem | null;
  hud: WorldHudSnapshot;
  popups: FloatingPopupEvent[];
  hitMarker: 'none' | 'hit' | 'crit';
  loopFlash: boolean;
  showGhostHands: boolean;
  joystick: JoystickVisualState;
  muted: boolean;
  overloadArmed: boolean;
  onToggleOverload: () => void;
  onToggleMute: () => void;
  onOpenPause: () => void;
  onJump: () => void;
  onDash: () => void;
  onInteract: () => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  shards,
  runShardsEarned,
  totalRatePerSec,
  echoCount,
  echoSlots,
  echoes,
  upgrades,
  stats,
  prestigeMult,
  tutorialStep,
  tutorialProgressText,
  activeNotification,
  hud,
  popups,
  hitMarker,
  loopFlash,
  showGhostHands,
  joystick,
  muted,
  overloadArmed,
  onToggleOverload,
  onToggleMute,
  onOpenPause,
  onJump,
  onDash,
  onInteract,
}) => {
  const [debugOpen, setDebugOpen] = useState(false);
  const tapTimesRef = useRef<number[]>([]);
  const simReportRef = useRef<ReturnType<typeof runEconomySimulation> | null>(null);

  const loopProgress = Math.max(0, Math.min(1, hud.loopTime / Math.max(1, hud.loopDuration)));
  const remaining = Math.max(0, hud.loopDuration - hud.loopTime);
  const ringRadius = 24;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const dashOffset = ringCircumference * (1 - loopProgress);

  const tutorialText = TUTORIAL_LABELS[tutorialStep];

  // Next reachable goal + ETA at current pace
  const combinedRate = Math.max(0, totalRatePerSec + hud.activeRatePerSec);
  const nextUp = findNextAffordableUpgrade(shards, upgrades);
  const nextUpEtaSec = nextUp
    ? nextUp.missing <= 0
      ? 0
      : combinedRate > 0.05
        ? nextUp.missing / combinedRate
        : Infinity
    : Infinity;

  const prestigePot = computePrestigePotential(runShardsEarned, echoes, stats);
  const prestigeRemainingScore = Math.max(0, prestigePot.nextThresholdShards - prestigePot.score);
  const prestigeEtaSec = prestigePot.canPrestige
    ? 0
    : combinedRate > 0.05
      ? prestigeRemainingScore / combinedRate
      : Infinity;

  const activeIdleRatio =
    totalRatePerSec > 0.05
      ? `${(hud.activeRatePerSec / totalRatePerSec).toFixed(2)}×`
      : hud.activeRatePerSec > 0
        ? 'Actif seul'
        : '—';

  const handleShardsTap = () => {
    const now = performance.now();
    const recent = tapTimesRef.current.filter((t) => now - t < 2500);
    recent.push(now);
    tapTimesRef.current = recent;
    if (recent.length >= 5) {
      tapTimesRef.current = [];
      if (!simReportRef.current) {
        simReportRef.current = runEconomySimulation();
      }
      setDebugOpen((prev) => !prev);
    }
  };

  const simReport = debugOpen
    ? (simReportRef.current ?? (simReportRef.current = runEconomySimulation()))
    : null;

  const notifStyle =
    activeNotification?.tone === 'crimson'
      ? 'border-[#ff4d9e]/75 text-[#ff9ec7]'
      : activeNotification?.tone === 'coral'
        ? 'border-[#e66b4c]/65 text-[#ffb199]'
        : activeNotification?.tone === 'gold'
          ? 'border-[#ffd15c]/65 text-[#ffd15c]'
          : 'border-[#38e8e1]/65 text-[#7df9f3]';

  const notifBg =
    activeNotification?.tone === 'crimson'
      ? 'rgba(62, 14, 40, 0.9)'
      : 'rgba(26, 15, 40, 0.86)';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden hud-safe-inset">
      {/* Loop Rewind Flash */}
      {loopFlash && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-300"
          style={{
            background:
              'radial-gradient(circle at center, rgba(125,249,243,0.48) 0%, rgba(255,209,92,0.22) 60%, rgba(45,25,61,0.1) 100%)',
          }}
        />
      )}

      {/* Projected 3D-to-2D Echo "+X/s" Labels (discrete & hidden near reticle) */}
      {hud.echoLabels.map((lbl) => (
        <div
          key={lbl.id}
          className={`fixed -translate-x-1/2 -translate-y-full pointer-events-none text-[9px] desktop:text-[11px] font-semibold tabular-nums hud-text-shadow px-1 py-px rounded opacity-85 ${
            lbl.suppressed ? 'text-[#ff70b3]' : 'text-[#38e8e1]'
          }`}
          style={{
            left: `${lbl.x}px`,
            top: `${lbl.y}px`,
            backgroundColor: 'rgba(32, 16, 46, 0.45)',
          }}
        >
          {lbl.rateText}
          {lbl.suppressed ? ' -70%' : ''}
        </div>
      ))}

      {/* Floating Damage & Golden Shard Popups (outside center reticle clear zone) */}
      {popups.map((p) => (
        <div
          key={p.id}
          className={`fixed pointer-events-none font-extrabold tabular-nums hud-text-shadow floating-dmg ${
            p.kind === 'shard'
              ? 'text-sm desktop:text-lg text-[#ffd15c]'
              : p.kind === 'crit'
                ? 'text-sm desktop:text-base text-[#ffe599]'
                : 'text-xs desktop:text-sm text-[#f7efe6]'
          }`}
          style={{ left: `${p.x}px`, top: `${p.y}px` }}
        >
          {p.text}
        </div>
      ))}

      {/* Top Bar Corners (Compact on mobile ~25% smaller, uncluttered center) */}
      <div className="relative flex items-start justify-between gap-2 desktop:gap-3">
        {/* Top-Left: Shards, Income Rate & Single Objective (5 taps opens hidden Debug Panel) */}
        <div className="flex flex-col gap-1 desktop:gap-1.5 pointer-events-auto">
          <div
            onClick={handleShardsTap}
            role="button"
            tabIndex={-1}
            aria-label="Compteur d'éclats"
            className="flex items-center gap-2 desktop:gap-3 px-2.5 py-1.5 desktop:px-3.5 desktop:py-2 rounded-lg border border-[#ffd15c]/30 cursor-pointer select-none"
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.8)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 desktop:w-6 desktop:h-6 shrink-0" aria-hidden="true">
              <polygon
                points="12,2 19,11 12,22 5,11"
                fill="#ffd15c"
                stroke="#4d2616"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <polygon points="12,2 19,11 12,13" fill="#fff0b3" opacity="0.65" />
            </svg>
            <div>
              <div
                data-testid="hud-shards"
                className="text-base desktop:text-2xl font-extrabold leading-none text-[#ffd15c] tabular-nums hud-text-shadow"
              >
                {formatShards(shards)}
              </div>
              <div className="mt-0.5 desktop:mt-1 flex items-center gap-1.5 desktop:gap-2 text-[10px] desktop:text-xs text-[#f7efe6]/80 tabular-nums">
                <span data-testid="hud-rate" className="text-[#38e8e1] font-semibold">
                  +{formatShards(totalRatePerSec)}/s
                </span>
                {prestigeMult > 1.01 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#ffd15c]">×{prestigeMult.toFixed(2)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Single Objective at a Time, in One Single Place */}
          <div
            data-testid="hud-objective"
            className="px-2 py-0.5 desktop:px-3 desktop:py-1 rounded-md border border-[#f7efe6]/15 text-[10px] desktop:text-xs font-semibold tabular-nums text-[#f7efe6]/90 hud-text-shadow max-w-[180px] desktop:max-w-[260px]"
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.74)' }}
          >
            {tutorialStep !== 'done' && tutorialText ? (
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate">{tutorialText}</span>
                {tutorialProgressText ? (
                  <span className="text-[#ffd15c] shrink-0">{tutorialProgressText}</span>
                ) : tutorialStep === 'reach_prestige' ? (
                  <span className="text-[#ffd15c] shrink-0">
                    {prestigePot.canPrestige
                      ? 'Prêt !'
                      : Number.isFinite(prestigeEtaSec)
                        ? formatDurationCompact(prestigeEtaSec)
                        : '—'}
                  </span>
                ) : null}
              </div>
            ) : nextUp ? (
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate">
                  Objectif : <span className="text-[#ffd15c]">{nextUp.name}</span>
                </span>
                <span
                  className={`shrink-0 ${
                    nextUp.missing <= 0 ? 'text-[#38e8e1] font-extrabold' : 'text-[#f7efe6]/75'
                  }`}
                >
                  {nextUp.missing <= 0
                    ? 'Prêt !'
                    : Number.isFinite(nextUpEtaSec)
                      ? formatDurationCompact(nextUpEtaSec)
                      : `${formatShards(nextUp.cost)} é.`}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate">Effondrement</span>
                <span className="text-[#ffd15c] shrink-0">
                  {prestigePot.canPrestige
                    ? 'Prêt !'
                    : Number.isFinite(prestigeEtaSec)
                      ? formatDurationCompact(prestigeEtaSec)
                      : '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Top-Center: Single Notification Queue Slot (1 at a time, 2s each, never overlapping) */}
        <div className="flex justify-center flex-1 px-1 pointer-events-none">
          {activeNotification && (
            <div
              key={activeNotification.id}
              data-testid="hud-notification"
              className={`px-3 py-1 desktop:px-4 desktop:py-1.5 rounded-lg border text-[11px] desktop:text-sm font-bold hud-text-shadow text-center max-w-[230px] desktop:max-w-md truncate ${notifStyle}`}
              style={{ backgroundColor: notifBg }}
            >
              {activeNotification.text}
            </div>
          )}
        </div>

        {/* Top-Right: Echo Slots, Overload Toggle & Utility Controls (>= 48px touch targets) */}
        <div className="flex items-center gap-1.5 desktop:gap-2 pointer-events-auto">
          <div
            className="flex items-center px-2 desktop:px-3 min-h-[38px] desktop:min-h-[48px] rounded-lg border border-[#38e8e1]/30 text-[11px] desktop:text-sm font-bold tabular-nums text-[#38e8e1]"
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.78)' }}
          >
            <span data-testid="hud-echoes">
              {echoCount}/{echoSlots}
              <span className="hidden desktop:inline"> Échos</span>
            </span>
          </div>

          {stats.overloadUnlocked && (
            <button
              type="button"
              tabIndex={-1}
              data-testid="btn-overload"
              aria-label="Basculer la Surcharge"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleOverload();
              }}
              className={`min-h-[48px] px-2 desktop:px-3 rounded-lg border font-bold text-[11px] desktop:text-xs flex items-center gap-1 desktop:gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                overloadArmed
                  ? 'border-[#ff7b3d] text-[#241230] bg-[#ff9b52]'
                  : 'border-[#f7efe6]/20 text-[#f7efe6] hover:border-[#ff7b3d]/70'
              }`}
              style={!overloadArmed ? { backgroundColor: 'rgba(34, 18, 48, 0.82)' } : undefined}
            >
              <Flame className="w-3.5 h-3.5 desktop:w-4 desktop:h-4" />
              <span>
                {hud.overloadActive
                  ? `×${stats.overloadMultiplier.toFixed(1)}`
                  : overloadArmed
                    ? 'Armée'
                    : 'Surcharge'}
              </span>
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? 'Activer le son' : 'Couper le son'}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-12 h-12 flex items-center justify-center rounded-lg border border-[#f7efe6]/20 text-[#f7efe6] hover:border-[#ffd15c]/60 cursor-pointer"
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.82)' }}
          >
            {muted ? (
              <VolumeX className="w-4 h-4 desktop:w-5 desktop:h-5" />
            ) : (
              <Volume2 className="w-4 h-4 desktop:w-5 desktop:h-5" />
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="Pause"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenPause();
            }}
            className="w-12 h-12 flex items-center justify-center rounded-lg border border-[#f7efe6]/20 text-[#f7efe6] hover:border-[#ffd15c]/60 cursor-pointer"
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.82)' }}
          >
            <Pause className="w-4 h-4 desktop:w-5 desktop:h-5" />
          </button>
        </div>
      </div>

      {/* Hidden Balancing Debug Panel (5 taps on shards counter) */}
      {debugOpen && simReport && (
        <div
          data-testid="debug-panel"
          className="fixed left-4 top-28 z-20 w-72 sm:w-80 p-3.5 rounded-xl border border-[#38e8e1]/55 text-xs text-[#f7efe6] pointer-events-auto shadow-xl"
          style={{ backgroundColor: 'rgba(24, 12, 36, 0.94)' }}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#f7efe6]/15">
            <span className="font-extrabold text-[#38e8e1] uppercase tracking-wider">
              Debug Équilibrage
            </span>
            <button
              type="button"
              aria-label="Fermer le debug"
              onClick={() => setDebugOpen(false)}
              className="w-10 h-10 rounded-lg border border-[#f7efe6]/20 flex items-center justify-center hover:border-[#ffd15c] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5 space-y-1.5 tabular-nums">
            <div className="flex justify-between gap-2">
              <span className="text-[#f7efe6]/70">Temps prochain achat :</span>
              <span className="font-bold text-[#ffd15c]">
                {nextUp
                  ? nextUp.missing <= 0
                    ? 'Prêt !'
                    : Number.isFinite(nextUpEtaSec)
                      ? formatDurationCompact(nextUpEtaSec)
                      : '—'
                  : 'Max'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#f7efe6]/70">Ratio actif / idle :</span>
              <span className="font-bold text-[#38e8e1]">{activeIdleRatio}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#f7efe6]/70">Temps estimé prestige :</span>
              <span className="font-bold text-[#ffd15c]">
                {prestigePot.canPrestige
                  ? 'Prêt !'
                  : Number.isFinite(prestigeEtaSec)
                    ? formatDurationCompact(prestigeEtaSec)
                    : '—'}
              </span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-[#f7efe6]/15 text-[11px] text-[#f7efe6]/75 space-y-1 tabular-nums">
            <div className="font-bold text-[#f7efe6]/90">
              Simulation bot ({simReport.passedAllRules ? 'VALIDÉE' : 'ALERTE'})
            </div>
            <div>
              1er achat : {simReport.firstUpgradeTimeSec}s · Moy. début :{' '}
              {simReport.avgEarlyPurchaseIntervalSec.toFixed(0)}s
            </div>
            <div>
              Ratio début : {simReport.earlyActiveToIdleRatio.toFixed(2)}× · Prestige :{' '}
              {simReport.firstPrestigeTimeSec
                ? `${(simReport.firstPrestigeTimeSec / 60).toFixed(1)} min`
                : 'N/A'}
            </div>
            <div>Accélération post-prestige : {simReport.postPrestigeSpeedup.toFixed(2)}×</div>
          </div>
        </div>
      )}

      {/* Center Reticle + Loop Timer Ring + Hitmarker + Combo ONLY */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center">
        <div className="relative w-13 h-13 desktop:w-16 desktop:h-16 flex items-center justify-center">
          <svg viewBox="0 0 60 60" className="w-13 h-13 desktop:w-16 desktop:h-16 -rotate-90" aria-hidden="true">
            <circle
              cx="30"
              cy="30"
              r={ringRadius}
              fill="none"
              stroke="rgba(247, 239, 230, 0.2)"
              strokeWidth="3"
            />
            <circle
              cx="30"
              cy="30"
              r={ringRadius}
              fill="none"
              stroke={hud.overloadActive ? '#ff7b3d' : remaining < 2.5 ? '#ffd15c' : '#38e8e1'}
              strokeWidth="3.2"
              strokeDasharray={ringCircumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>

          {/* Precision Center Dot */}
          <div
            className={`absolute w-1.5 h-1.5 desktop:w-2 desktop:h-2 rounded-full transition-transform duration-75 ${
              hud.aimingAtGeode ? 'bg-[#ffd15c] scale-125' : 'bg-[#f7efe6]'
            }`}
          />

          {/* Hitmarker Cross */}
          {hitMarker !== 'none' && (
            <svg viewBox="0 0 32 32" className="absolute w-6 h-6 desktop:w-7 desktop:h-7" aria-hidden="true">
              <path
                d="M7 7 L12 12 M25 7 L20 12 M7 25 L12 20 M25 25 L20 20"
                stroke={hitMarker === 'crit' ? '#ffd15c' : '#ffffff'}
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>

        <div
          data-testid="hud-timer"
          className="mt-0.5 text-[10px] desktop:text-[11px] font-bold tabular-nums text-[#f7efe6]/90 hud-text-shadow"
        >
          {remaining.toFixed(1)}s
        </div>

        {hud.combo >= 2 && (
          <div className="mt-0.5 desktop:mt-1 text-[11px] desktop:text-xs font-extrabold tracking-wider text-[#ffd15c] tabular-nums hud-text-shadow">
            COMBO ×{hud.combo}
          </div>
        )}
      </div>

      {/* Ghost Hands First-Time Onboarding Cue */}
      {showGhostHands && (
        <div className="fixed inset-x-0 bottom-16 desktop:bottom-20 flex items-center justify-between px-8 desktop:px-20 pointer-events-none">
          <div className="flex flex-col items-center gap-1 ghost-thumb-anim">
            <div
              className="w-10 h-10 desktop:w-12 desktop:h-12 rounded-full border-2 border-[#38e8e1] flex items-center justify-center text-[11px] desktop:text-xs font-bold text-[#38e8e1]"
              style={{ backgroundColor: 'rgba(34, 18, 48, 0.72)' }}
            >
              G
            </div>
            <span
              className="px-1.5 py-0.5 rounded text-[10px] desktop:text-xs font-bold text-[#f7efe6]"
              style={{ backgroundColor: 'rgba(34, 18, 48, 0.72)' }}
            >
              Glisser · Déplacer
            </span>
          </div>
          <div className="flex flex-col items-center gap-1 ghost-thumb-anim">
            <div
              className="w-10 h-10 desktop:w-12 desktop:h-12 rounded-full border-2 border-[#ffd15c] flex items-center justify-center text-[11px] desktop:text-xs font-bold text-[#ffd15c]"
              style={{ backgroundColor: 'rgba(34, 18, 48, 0.72)' }}
            >
              D
            </div>
            <span
              className="px-1.5 py-0.5 rounded text-[10px] desktop:text-xs font-bold text-[#f7efe6]"
              style={{ backgroundColor: 'rgba(34, 18, 48, 0.72)' }}
            >
              Glisser · Viser
            </span>
          </div>
        </div>
      )}

      {/* Dynamic Floating Left Joystick */}
      {joystick.active && (
        <div className="fixed inset-0 pointer-events-none">
          <div
            className="fixed w-24 h-24 desktop:w-28 desktop:h-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#38e8e1]/55"
            style={{
              left: `${joystick.originX}px`,
              top: `${joystick.originY}px`,
              backgroundColor: 'rgba(56, 232, 225, 0.1)',
            }}
          />
          <div
            className="fixed w-10 h-10 desktop:w-12 desktop:h-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#38e8e1]/75 border border-white/60"
            style={{ left: `${joystick.knobX}px`, top: `${joystick.knobY}px` }}
          />
        </div>
      )}

      {/* Bottom-Right Action Buttons (>= 48px Touch Targets, Safe Area Respected) */}
      <div
        className="fixed flex items-end gap-2 desktop:gap-3 pointer-events-auto"
        style={{
          right: 'max(12px, env(safe-area-inset-right))',
          bottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        {hud.nearTerminal && (
          <button
            type="button"
            tabIndex={-1}
            data-testid="btn-interact"
            aria-label="Ouvrir le terminal"
            onClick={(e) => {
              e.currentTarget.blur();
              onInteract();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              onInteract();
            }}
            className="min-h-[48px] px-3 desktop:min-h-[56px] desktop:px-4 rounded-xl border-2 border-[#38e8e1] text-[#241230] bg-[#38e8e1] hover:bg-[#7df9f3] font-bold text-xs desktop:text-sm flex items-center gap-1.5 desktop:gap-2 cursor-pointer shadow-[0_4px_20px_rgba(56,232,225,0.4)] whitespace-nowrap shrink-0"
          >
            <Terminal className="w-4 h-4 desktop:w-5 desktop:h-5" />
            <span>Terminal [E]</span>
          </button>
        )}

        {hud.dashUnlocked && (
          <button
            type="button"
            tabIndex={-1}
            data-testid="btn-dash"
            aria-label="Dash de phase"
            onClick={(e) => {
              e.currentTarget.blur();
              onDash();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              onDash();
            }}
            className={`min-w-[48px] min-h-[48px] px-2.5 desktop:min-w-[56px] desktop:min-h-[56px] desktop:px-3.5 rounded-xl border font-bold text-xs desktop:text-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform tabular-nums ${
              hud.dashCooldownRemaining <= 0.05
                ? 'border-[#38e8e1] text-[#7df9f3]'
                : 'border-[#f7efe6]/20 text-[#f7efe6]/50'
            }`}
            style={{ backgroundColor: 'rgba(34, 18, 48, 0.86)' }}
          >
            <Wind className="w-4 h-4 desktop:w-5 desktop:h-5" />
            <span className="hidden desktop:inline">
              {hud.dashCooldownRemaining <= 0.05
                ? 'Dash [Shift]'
                : `${hud.dashCooldownRemaining.toFixed(1)}s`}
            </span>
          </button>
        )}

        <button
          type="button"
          tabIndex={-1}
          data-testid="btn-jump"
          aria-label="Sauter"
          onClick={(e) => {
            e.currentTarget.blur();
            onJump();
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            onJump();
          }}
          className="min-w-[48px] min-h-[48px] px-3 desktop:min-w-[56px] desktop:min-h-[56px] desktop:px-4 rounded-xl border border-[#ffd15c]/50 text-[#f7efe6] font-bold text-xs desktop:text-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
          style={{ backgroundColor: 'rgba(34, 18, 48, 0.85)' }}
        >
          <ArrowUp className="w-4 h-4 desktop:w-5 desktop:h-5 text-[#ffd15c]" />
          <span className="hidden desktop:inline">Sauter</span>
        </button>
      </div>
    </div>
  );
};
