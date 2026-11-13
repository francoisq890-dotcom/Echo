import React, { useState } from 'react';
import { Download, Play, RotateCcw, Copy, Check } from 'lucide-react';
import type { GameSettings, QualityPreset } from '../game/config';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PauseModalProps {
  settings: GameSettings;
  saveExportString: string;
  onUpdateSettings: (next: GameSettings) => void;
  onImportSave: (text: string) => boolean;
  onResume: () => void;
  onReturnTitle: () => void;
  onHardReset: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  settings,
  saveExportString,
  onUpdateSettings,
  onImportSave,
  onResume,
  onReturnTitle,
  onHardReset,
}) => {
  const [importText, setImportText] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(saveExportString);
      setCopied(true);
      setStatusMsg('Sauvegarde copiée dans le presse-papiers.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setImportText(saveExportString);
      setStatusMsg('Code affiché ci-dessous pour copie manuelle.');
    }
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    const ok = onImportSave(importText);
    setStatusMsg(ok ? 'Sauvegarde importée avec succès !' : 'Code de sauvegarde invalide.');
    if (ok) setImportText('');
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(22, 11, 32, 0.85)' }}
      role="dialog"
      aria-label="Menu pause et paramètres"
    >
      <div
        className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-xl border border-[#ffd15c]/35 p-4 sm:p-5 shadow-2xl space-y-3.5"
        style={{ backgroundColor: '#251434' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-[#f7efe6]">Pause</h2>
          <button
            type="button"
            onClick={onResume}
            className="min-h-[48px] px-5 rounded-lg bg-[#ffd15c] hover:bg-[#ffe08a] text-[#241230] font-bold text-sm flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Reprendre</span>
          </button>
        </div>

        {/* Settings */}
        <div className="space-y-4 pt-2 border-t border-[#f7efe6]/10">
          <div>
            <div className="flex justify-between text-xs sm:text-sm font-semibold text-[#f7efe6]">
              <label htmlFor="sens-range">Sensibilité visée</label>
              <span className="tabular-nums text-[#38e8e1]">{settings.sensitivity.toFixed(1)}×</span>
            </div>
            <input
              id="sens-range"
              type="range"
              min={0.3}
              max={2.5}
              step={0.1}
              value={settings.sensitivity}
              onChange={(e) =>
                onUpdateSettings({ ...settings, sensitivity: parseFloat(e.target.value) })
              }
              className="mt-2 w-full accent-[#38e8e1] cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, vibration: !settings.vibration })}
              className={`min-h-[48px] px-3 rounded-lg border text-xs sm:text-sm font-bold cursor-pointer ${
                settings.vibration
                  ? 'border-[#38e8e1] bg-[#38e8e1]/15 text-[#38e8e1]'
                  : 'border-[#f7efe6]/15 bg-[#311b44] text-[#f7efe6]/70'
              }`}
            >
              Vibrations : {settings.vibration ? 'Oui' : 'Non'}
            </button>

            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, fps30: !settings.fps30 })}
              className={`min-h-[48px] px-3 rounded-lg border text-xs sm:text-sm font-bold cursor-pointer ${
                settings.fps30
                  ? 'border-[#ffd15c] bg-[#ffd15c]/15 text-[#ffd15c]'
                  : 'border-[#f7efe6]/15 bg-[#311b44] text-[#f7efe6]/70'
              }`}
            >
              Mode 30 FPS : {settings.fps30 ? 'Actif' : 'Non'}
            </button>
          </div>

          <div>
            <div className="text-xs sm:text-sm font-semibold text-[#f7efe6] mb-1.5">
              Qualité graphique
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['high', 'medium', 'low'] as QualityPreset[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, quality: q })}
                  className={`min-h-[46px] rounded-lg border text-xs font-bold cursor-pointer ${
                    settings.quality === q
                      ? 'border-[#38e8e1] bg-[#38e8e1] text-[#241230]'
                      : 'border-[#f7efe6]/15 bg-[#311b44] text-[#f7efe6]/80'
                  }`}
                >
                  {q === 'high' ? 'Haute' : q === 'medium' ? 'Équilibrée' : 'Légère'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Save Export / Import */}
        <div className="space-y-2.5 pt-3 border-t border-[#f7efe6]/10">
          <div className="text-xs font-bold uppercase tracking-wider text-[#f7efe6]/70">
            Sauvegarde texte
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 min-h-[48px] px-3 rounded-lg border border-[#38e8e1]/40 bg-[#311b44] text-xs sm:text-sm font-bold text-[#38e8e1] flex items-center justify-center gap-2 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>Exporter</span>
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="flex-1 min-h-[48px] px-3 rounded-lg border border-[#ffd15c]/40 bg-[#311b44] text-xs sm:text-sm font-bold text-[#ffd15c] cursor-pointer"
            >
              Importer
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Colle ici ton code ECHO1:... pour restaurer"
            rows={2}
            className="w-full rounded-lg border border-[#f7efe6]/15 bg-[#1b0e26] p-2.5 text-xs text-[#f7efe6] placeholder:text-[#f7efe6]/40 focus:outline-none focus:border-[#38e8e1]"
          />
          {statusMsg && <div className="text-xs text-[#38e8e1]">{statusMsg}</div>}
        </div>

        {/* PWA Install + Secondary Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-[#f7efe6]/10">
          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={() => void install()}
              className="min-h-[48px] px-4 rounded-lg bg-[#38e8e1] text-[#241230] text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Installer l’app</span>
            </button>
          )}
          {!isInstalled && isIOS && (
            <button
              type="button"
              onClick={() => setShowIOSGuide((v) => !v)}
              className="min-h-[48px] px-4 rounded-lg border border-[#38e8e1]/40 text-xs font-bold text-[#38e8e1] cursor-pointer"
            >
              Installer sur iOS
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onReturnTitle}
              className="min-h-[48px] px-4 rounded-lg border border-[#f7efe6]/20 text-xs sm:text-sm font-semibold text-[#f7efe6]/85 cursor-pointer"
            >
              Écran titre
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="min-h-[48px] px-3.5 rounded-lg border border-[#e66b4c]/50 text-xs font-semibold text-[#ffb199] flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Réinitialiser</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onHardReset}
                className="min-h-[48px] px-3.5 rounded-lg bg-[#b8563a] text-white text-xs font-bold cursor-pointer"
              >
                Confirmer effacement
              </button>
            )}
          </div>
        </div>

        {showIOSGuide && (
          <div className="p-3 rounded-lg bg-[#1b0e26] border border-[#38e8e1]/30 text-xs text-[#f7efe6]/85">
            Appuie sur Partager dans Safari puis sur « Sur l’écran d’accueil » pour jouer hors ligne en plein écran.
          </div>
        )}
      </div>
    </div>
  );
};
