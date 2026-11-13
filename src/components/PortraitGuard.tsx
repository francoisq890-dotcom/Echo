import React, { useEffect, useState } from 'react';

export const PortraitGuard: React.FC = () => {
  const [showGuard, setShowGuard] = useState(false);

  useEffect(() => {
    const check = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      const isMobileSize = Math.min(window.innerWidth, window.innerHeight) < 620 || 'ontouchstart' in window;
      setShowGuard(isPortrait && isMobileSize && window.innerWidth < 760);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (!showGuard) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center p-8 text-center"
      style={{ backgroundColor: '#241332', color: '#f7efe6' }}
      role="dialog"
      aria-label="Tourne ton téléphone"
    >
      <svg viewBox="0 0 96 96" className="w-20 h-20 mb-5 text-[#38e8e1]" aria-hidden="true">
        <rect
          x="28"
          y="14"
          width="40"
          height="68"
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
        />
        <circle cx="48" cy="72" r="2.5" fill="currentColor" />
        <path
          d="M16 42 C16 26, 28 18, 28 18"
          fill="none"
          stroke="#ffd15c"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <polygon points="12,41 20,41 16,49" fill="#ffd15c" />
      </svg>
      <h2 className="text-2xl font-bold tracking-tight text-[#f7efe6]">Tourne ton téléphone</h2>
      <p className="mt-2 max-w-xs text-sm text-[#f7efe6]/75">
        ÉCHO se joue en mode paysage pour profiter du double contrôle aux pouces.
      </p>
    </div>
  );
};
