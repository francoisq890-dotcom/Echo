import React from 'react';
import { formatShards } from '../game/economy';

interface TitleScreenProps {
  hasProgress: boolean;
  shards: number;
  echoCount: number;
  onStart: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  hasProgress,
  shards,
  echoCount,
  onStart,
}) => {
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none"
      style={{
        padding:
          'max(20px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left))',
        background:
          'linear-gradient(105deg, rgba(35, 19, 48, 0.84) 0%, rgba(45, 25, 61, 0.42) 48%, rgba(45, 25, 61, 0.08) 100%)',
      }}
    >
      {/* Upper/Left Negative Space Title Lockup */}
      <div className="max-w-lg pt-2 sm:pt-6 pointer-events-auto">
        <svg
          viewBox="0 0 430 108"
          className="w-72 sm:w-96 h-auto drop-shadow-[0_4px_18px_rgba(24,10,36,0.75)]"
          aria-label="ÉCHO"
        >
          {/* Geometric Crystal & Echo Loop Emblem */}
          <circle
            cx="48"
            cy="54"
            r="36"
            fill="none"
            stroke="#38e8e1"
            strokeWidth="3.5"
            strokeDasharray="165 55"
            strokeLinecap="round"
          />
          <polygon
            points="48,18 68,54 48,90 28,54"
            fill="#38e8e1"
            fillOpacity="0.22"
            stroke="#38e8e1"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <polygon points="48,34 57,54 48,74 39,54" fill="#ffd15c" />
          {/* Wordmark */}
          <text
            x="108"
            y="68"
            fill="#f7efe6"
            fontSize="58"
            fontWeight="800"
            letterSpacing="8"
            fontFamily="Avenir Next, Segoe UI, system-ui, sans-serif"
          >
            ÉCHO
          </text>
          <text
            x="110"
            y="92"
            fill="#ffd15c"
            fontSize="13.5"
            fontWeight="700"
            letterSpacing="2.2"
            fontFamily="Avenir Next, Segoe UI, system-ui, sans-serif"
          >
            BOUCLES TEMPORELLES · 12S
          </text>
        </svg>

        <p className="mt-3 max-w-sm text-sm sm:text-base text-[#f7efe6]/90 leading-relaxed hud-text-shadow">
          Brise les géodes du canyon. Chaque boucle crée un écho fantôme qui rejoue tes tirs à l’infini.
        </p>

        {hasProgress && (
          <div className="mt-3 flex items-center gap-3 text-xs sm:text-sm text-[#f7efe6]/85 tabular-nums hud-text-shadow">
            <span className="text-[#ffd15c] font-semibold">{formatShards(shards)} éclats</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#38e8e1] font-semibold">
              {echoCount} écho{echoCount > 1 ? 's' : ''} actif{echoCount > 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="mt-6 flex items-center gap-4">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="min-h-[52px] px-8 py-3 rounded-lg font-bold text-base tracking-wide text-[#241230] bg-[#ffd15c] hover:bg-[#ffe08a] active:scale-[0.98] transition-transform cursor-pointer shadow-[0_6px_24px_rgba(255,209,92,0.35)] whitespace-nowrap shrink-0"
          >
            {hasProgress ? 'Reprendre la boucle' : 'Entrer dans l’arène'}
          </button>
        </div>
      </div>

      {/* Bottom Safe Margin Inline Control Hint */}
      <div className="text-xs sm:text-sm text-[#f7efe6]/75 tracking-wide hud-text-shadow">
        Pouce gauche / ZQSD Déplacer · Pouce droit / Souris Viser · Espace Sauter · E Terminal
      </div>
    </div>
  );
};
