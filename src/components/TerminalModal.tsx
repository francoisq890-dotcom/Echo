import React, { useState } from 'react';
import { X, Sparkles, Zap, RefreshCw, Map, Magnet } from 'lucide-react';
import {
  PRESTIGE_PERKS,
  PrestigePerkId,
  UPGRADE_DEFS,
  UpgradeCategory,
  UpgradeId,
} from '../game/config';
import {
  ComputedStats,
  computePrestigePotential,
  EchoRecord,
  formatShards,
  getPrestigeMultiplier,
  getUpgradeCost,
  UpgradeLevels,
} from '../game/economy';

interface TerminalModalProps {
  shards: number;
  runShardsEarned: number;
  upgrades: UpgradeLevels;
  echoes: EchoRecord[];
  stats: ComputedStats;
  temporalFragments: number;
  perks: PrestigePerkId[];
  onBuyUpgrade: (id: UpgradeId) => void;
  onPrestige: (chosenPerk: PrestigePerkId) => void;
  onClose: () => void;
}

const CATEGORIES: Array<{ id: UpgradeCategory | 'prestige'; label: string }> = [
  { id: 'arme', label: 'Arme' },
  { id: 'boucle', label: 'Boucle' },
  { id: 'arene', label: 'Arène' },
  { id: 'aimant', label: 'Aimant' },
  { id: 'prestige', label: 'Effondrement' },
];

export const TerminalModal: React.FC<TerminalModalProps> = ({
  shards,
  runShardsEarned,
  upgrades,
  echoes,
  stats,
  temporalFragments,
  perks,
  onBuyUpgrade,
  onPrestige,
  onClose,
}) => {
  const [tab, setTab] = useState<UpgradeCategory | 'prestige'>('arme');
  const [selectedPerk, setSelectedPerk] = useState<PrestigePerkId>('chronos_edge');

  const prestigeInfo = computePrestigePotential(runShardsEarned, echoes, stats);
  const currentMult = getPrestigeMultiplier(temporalFragments);
  const nextMult = getPrestigeMultiplier(temporalFragments + prestigeInfo.fragmentsEarned);

  const visibleUpgrades = UPGRADE_DEFS.filter((u) => u.category === tab);

  const renderCategoryIcon = (cat: UpgradeCategory | 'prestige') => {
    if (cat === 'arme') return <Zap className="w-4 h-4" />;
    if (cat === 'boucle') return <RefreshCw className="w-4 h-4" />;
    if (cat === 'arene') return <Map className="w-4 h-4" />;
    if (cat === 'aimant') return <Magnet className="w-4 h-4" />;
    return <Sparkles className="w-4 h-4" />;
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-6"
      style={{ backgroundColor: 'rgba(22, 11, 32, 0.84)' }}
      role="dialog"
      aria-label="Terminal holographique d’améliorations"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-[#38e8e1]/45 shadow-[0_0_40px_rgba(56,232,225,0.18)] overflow-hidden"
        style={{ backgroundColor: '#241332' }}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-[#38e8e1]/25">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold tracking-wide text-[#38e8e1]">
              Terminal de Résonance
            </h2>
            <div className="text-xs sm:text-sm text-[#f7efe6]/80 tabular-nums">
              Éclats disponibles :{' '}
              <span className="font-bold text-[#ffd15c]">{formatShards(shards)}</span>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              <span>Palier arme {stats.weaponTier + 1}/5</span>
            </div>
          </div>

          <button
            type="button"
            aria-label="Fermer le terminal"
            onClick={onClose}
            className="w-12 h-12 rounded-lg border border-[#f7efe6]/20 flex items-center justify-center text-[#f7efe6] hover:border-[#38e8e1] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 border-b border-[#f7efe6]/10 overflow-x-auto">
          {CATEGORIES.map((c) => {
            const active = tab === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setTab(c.id)}
                className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? c.id === 'prestige'
                      ? 'bg-[#ffd15c] text-[#241230]'
                      : 'bg-[#38e8e1] text-[#241230]'
                    : 'bg-[#331b46] text-[#f7efe6]/80 hover:text-[#f7efe6]'
                }`}
              >
                {renderCategoryIcon(c.id)}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {tab !== 'prestige' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {visibleUpgrades.map((def) => {
                const lvl = upgrades[def.id] ?? 0;
                const isMax = lvl >= def.maxLevel;
                const cost = getUpgradeCost(def.id, lvl);
                const canAfford = !isMax && shards >= cost;

                return (
                  <div
                    key={def.id}
                    className="flex flex-col justify-between gap-3 p-4 rounded-lg border border-[#f7efe6]/12"
                    style={{ backgroundColor: '#2f1a40' }}
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-[#f7efe6]">{def.name}</h3>
                        <span className="text-xs font-bold tabular-nums text-[#38e8e1] whitespace-nowrap">
                          Niv. {lvl}/{def.maxLevel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#f7efe6]/70 leading-relaxed">
                        {def.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#f7efe6]/10">
                      <div className="text-xs tabular-nums">
                        <span className="text-[#f7efe6]/60">Actuel : </span>
                        <span className="font-semibold text-[#f7efe6]">{def.effectLabel(lvl)}</span>
                        {!isMax && (
                          <span className="text-[#38e8e1]"> → {def.effectLabel(lvl + 1)}</span>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={!canAfford}
                        onClick={() => onBuyUpgrade(def.id)}
                        className={`min-h-[48px] px-4 py-2 rounded-lg font-bold text-xs sm:text-sm tabular-nums whitespace-nowrap shrink-0 transition-colors ${
                          isMax
                            ? 'bg-[#3c2452] text-[#f7efe6]/50 cursor-default'
                            : canAfford
                              ? 'bg-[#ffd15c] hover:bg-[#ffe08a] text-[#241230] cursor-pointer'
                              : 'bg-[#3c2452] text-[#f7efe6]/45 cursor-not-allowed'
                        }`}
                      >
                        {isMax ? 'Max' : `${formatShards(cost)} éclats`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Before / After Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div
                  className="p-4 rounded-lg border border-[#f7efe6]/15"
                  style={{ backgroundColor: '#2f1a40' }}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-[#f7efe6]/60">
                    Avant l’Effondrement
                  </div>
                  <div className="mt-2 space-y-1 text-sm tabular-nums">
                    <div>
                      Fragments temporels :{' '}
                      <span className="font-bold text-[#38e8e1]">{temporalFragments}</span>
                    </div>
                    <div>
                      Multiplicateur global :{' '}
                      <span className="font-bold text-[#ffd15c]">×{currentMult.toFixed(2)}</span>
                    </div>
                    <div>
                      Échos actifs : <span className="font-bold">{echoes.length}</span>
                    </div>
                  </div>
                </div>

                <div
                  className="p-4 rounded-lg border border-[#ffd15c]/45"
                  style={{ backgroundColor: '#341c45' }}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-[#ffd15c]">
                    Après l’Effondrement
                  </div>
                  <div className="mt-2 space-y-1 text-sm tabular-nums">
                    <div>
                      Fragments temporels :{' '}
                      <span className="font-bold text-[#38e8e1]">
                        {temporalFragments + prestigeInfo.fragmentsEarned} (+
                        {prestigeInfo.fragmentsEarned})
                      </span>
                    </div>
                    <div>
                      Nouveau multiplicateur :{' '}
                      <span className="font-bold text-[#ffd15c]">×{nextMult.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-[#f7efe6]/70">
                      Réinitialise éclats, améliorations et échos actuels.
                    </div>
                  </div>
                </div>
              </div>

              {/* Pick 1 of 3 Permanent Bonuses */}
              <div>
                <h3 className="text-sm font-bold text-[#f7efe6] mb-2.5">
                  Choisis 1 bénédiction permanente à conserver :
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PRESTIGE_PERKS.map((perk) => {
                    const owned = perks.includes(perk.id);
                    const chosen = selectedPerk === perk.id;
                    return (
                      <button
                        key={perk.id}
                        type="button"
                        onClick={() => setSelectedPerk(perk.id)}
                        className={`p-3.5 rounded-lg border text-left cursor-pointer transition-colors ${
                          chosen
                            ? 'border-[#ffd15c] bg-[#422359]'
                            : 'border-[#f7efe6]/15 bg-[#2f1a40] hover:border-[#38e8e1]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-[#ffd15c]">{perk.name}</span>
                          {owned && (
                            <span className="text-[11px] font-semibold text-[#38e8e1]">Acquis</span>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs text-[#f7efe6]/80 leading-relaxed">
                          {perk.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                {!prestigeInfo.canPrestige ? (
                  <p className="text-xs text-[#f7efe6]/75 tabular-nums">
                    Accumule encore de la puissance ({formatShards(prestigeInfo.nextThresholdShards)}{' '}
                    score temporel requis) pour déclencher l’Effondrement.
                  </p>
                ) : (
                  <p className="text-xs text-[#38e8e1]">
                    Effondrement prêt : +{prestigeInfo.fragmentsEarned} fragment
                    {prestigeInfo.fragmentsEarned > 1 ? 's' : ''} temporel
                    {prestigeInfo.fragmentsEarned > 1 ? 's' : ''}.
                  </p>
                )}

                <button
                  type="button"
                  disabled={!prestigeInfo.canPrestige}
                  onClick={() => onPrestige(selectedPerk)}
                  className={`min-h-[50px] px-6 py-2.5 rounded-lg font-bold text-sm whitespace-nowrap shrink-0 ${
                    prestigeInfo.canPrestige
                      ? 'bg-[#ffd15c] hover:bg-[#ffe08a] text-[#241230] cursor-pointer'
                      : 'bg-[#3c2452] text-[#f7efe6]/45 cursor-not-allowed'
                  }`}
                >
                  Déclencher l’Effondrement
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
