import React from 'react';
import { formatShards } from '../game/economy';

interface OfflineModalProps {
  echoCount: number;
  gainedShards: number;
  elapsedSeconds: number;
  onClaim: () => void;
}

export const OfflineModal: React.FC<OfflineModalProps> = ({
  echoCount,
  gainedShards,
  elapsedSeconds,
  onClaim,
}) => {
  const mins = Math.floor(elapsedSeconds / 60);
  const hrs = Math.floor(mins / 60);
  const timeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${Math.max(1, mins)} min`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(24, 12, 34, 0.84)' }}
      role="dialog"
      aria-label="Récolte hors ligne"
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#38e8e1]/40 p-6 text-center shadow-2xl"
        style={{ backgroundColor: '#261534' }}
      >
        <div className="text-xs font-semibold tracking-widest uppercase text-[#38e8e1]">
          Résonance continue · {timeText}
        </div>
        <h2 className="mt-2 text-xl sm:text-2xl font-bold text-[#f7efe6] leading-snug">
          Pendant ton absence, tes {echoCount} écho{echoCount > 1 ? 's' : ''} ont récolté{' '}
          <span className="text-[#ffd15c] tabular-nums">{formatShards(gainedShards)}</span> éclats
        </h2>
        <p className="mt-2 text-xs text-[#f7efe6]/65">
          Plafond d’accumulation hors ligne : 8 heures.
        </p>
        <button
          type="button"
          onClick={onClaim}
          className="mt-6 w-full min-h-[50px] rounded-lg bg-[#ffd15c] hover:bg-[#ffe08a] text-[#241230] font-bold text-base cursor-pointer transition-colors"
        >
          Récupérer {formatShards(gainedShards)} éclats
        </button>
      </div>
    </div>
  );
};
