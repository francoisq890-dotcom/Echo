export const SAVE_VERSION = 2;
export const SAVE_STORAGE_KEY = 'echo_game_save_v2';

export const BASE_LOOP_DURATION = 12; // seconds
export const BASE_ECHO_SLOTS = 3;
export const BASE_ECHO_REPLICATION = 0.14; // 14% per echo -> 3 echoes = 42% of active -> active >= 2.3x idle early
export const MAX_ECHO_INSTANCES = 40;
export const ECHO_SAMPLE_HZ = 20;
export const ECHO_SAMPLE_INTERVAL = 1 / ECHO_SAMPLE_HZ;
export const OFFLINE_CAP_SECONDS = 8 * 3600; // 8 hours
export const ARENA_RADIUS = 28;
export const WORLD_SEED = 42197;
export const PRESTIGE_SCORE_THRESHOLD = 95000;

export const PALETTE = {
  skyTop: 0x3a1f52,
  skyHorizon: 0x833c55,
  fog: 0x4b2640,
  sand: 0xd9a773,
  sandDark: 0xb88150,
  terracotta: 0xb8563a,
  terracottaDark: 0x7d3625,
  obsidian: 0x3b2538,
  echoCyan: 0x38e8e1,
  shardGold: 0xffd15c,
  geodeBase: 0xe66b4c,
  geodeMobile: 0x5cdbd3,
  geodeArmored: 0x8f5d6b,
  geodeExplosive: 0xff7b3d,
  geodeGolden: 0xffd15c,
  geodeTwin: 0xff5eb3,
  devourerVoid: 0x6b1d45,
} as const;

export type UpgradeCategory = 'arme' | 'boucle' | 'arene' | 'aimant';

export type UpgradeId =
  | 'weapon_damage'
  | 'weapon_rate'
  | 'weapon_relay'
  | 'weapon_ricochet'
  | 'weapon_pierce'
  | 'weapon_blast'
  | 'loop_duration'
  | 'loop_slots'
  | 'loop_power'
  | 'loop_dash'
  | 'loop_overload'
  | 'arena_platforms'
  | 'arena_mobile'
  | 'arena_twins'
  | 'arena_armored'
  | 'arena_golden'
  | 'arena_explosive'
  | 'magnet_radius'
  | 'magnet_speed';

export interface UpgradeDef {
  id: UpgradeId;
  category: UpgradeCategory;
  name: string;
  description: string;
  baseCost: number;
  costFactor: number;
  maxLevel: number;
  effectLabel: (level: number) => string;
}

export const UPGRADE_DEFS: UpgradeDef[] = [
  // ARME
  {
    id: 'weapon_damage',
    category: 'arme',
    name: 'Noyau Harmonique',
    description: '+22% dégâts par niveau et fait évoluer le cristal de l’arme.',
    baseCost: 48,
    costFactor: 1.15,
    maxLevel: 35,
    effectLabel: (lvl) => `${Math.round(12 * (1 + lvl * 0.22))} dég.`,
  },
  {
    id: 'weapon_rate',
    category: 'arme',
    name: 'Cadence Résonante',
    description: '+18% fréquence de tir automatique par niveau.',
    baseCost: 72,
    costFactor: 1.15,
    maxLevel: 25,
    effectLabel: (lvl) => `${(3.2 * (1 + lvl * 0.18)).toFixed(1)} tirs/s`,
  },
  {
    id: 'weapon_relay',
    category: 'arme',
    name: 'Prisme de Relais',
    description: 'Tirer à travers un écho amplifie les dégâts (+25%/niv) et perfore.',
    baseCost: 160,
    costFactor: 1.15,
    maxLevel: 15,
    effectLabel: (lvl) => `×${(2.5 + lvl * 0.25).toFixed(2)} relais`,
  },
  {
    id: 'weapon_ricochet',
    category: 'arme',
    name: 'Prisme à Ricochet',
    description: 'Les tirs rebondissent vers une géode voisine.',
    baseCost: 260,
    costFactor: 1.15,
    maxLevel: 6,
    effectLabel: (lvl) => `${lvl} rebond${lvl > 1 ? 's' : ''}`,
  },
  {
    id: 'weapon_pierce',
    category: 'arme',
    name: 'Rayon Perforant',
    description: 'Traverse plusieurs géodes alignées sur un même tir.',
    baseCost: 380,
    costFactor: 1.15,
    maxLevel: 5,
    effectLabel: (lvl) => `${1 + lvl} cible${lvl > 0 ? 's' : ''}`,
  },
  {
    id: 'weapon_blast',
    category: 'arme',
    name: 'Onde Sismique',
    description: 'Chaque impact déclenche une détonation de zone.',
    baseCost: 540,
    costFactor: 1.15,
    maxLevel: 10,
    effectLabel: (lvl) => (lvl === 0 ? 'Inactif' : `Rayon ${(2.4 + lvl * 0.5).toFixed(1)}m`),
  },

  // BOUCLE
  {
    id: 'loop_slots',
    category: 'boucle',
    name: 'Emplacements d’Échos',
    description: 'Ajoute un emplacement persistant pour tes copies fantômes.',
    baseCost: 190,
    costFactor: 1.18,
    maxLevel: 37,
    effectLabel: (lvl) => `${BASE_ECHO_SLOTS + lvl} échos max`,
  },
  {
    id: 'loop_power',
    category: 'boucle',
    name: 'Amplification Fantôme',
    description: '+20% rendement d’éclats/s de tous tes échos.',
    baseCost: 120,
    costFactor: 1.15,
    maxLevel: 30,
    effectLabel: (lvl) => `×${(1 + lvl * 0.2).toFixed(1)} échos`,
  },
  {
    id: 'loop_duration',
    category: 'boucle',
    name: 'Dilatation Temporelle',
    description: 'Allonge la boucle (+2.0s/niv) pour récolter davantage.',
    baseCost: 165,
    costFactor: 1.15,
    maxLevel: 12,
    effectLabel: (lvl) => `${(BASE_LOOP_DURATION + lvl * 2.0).toFixed(0)}s`,
  },
  {
    id: 'loop_dash',
    category: 'boucle',
    name: 'Propulsion de Phase',
    description: 'Débloque le Dash [Shift] et recharge instantanément près des échos.',
    baseCost: 220,
    costFactor: 1.15,
    maxLevel: 6,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `CD ${(2.6 * Math.pow(0.84, lvl - 1)).toFixed(1)}s`),
  },
  {
    id: 'loop_overload',
    category: 'boucle',
    name: 'Surcharge Contrôlée',
    description: 'Débloque la Surcharge (boucle courte, plus de Dévoreurs, ×1.8+ éclats).',
    baseCost: 480,
    costFactor: 1.15,
    maxLevel: 8,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `×${(1.8 + (lvl - 1) * 0.2).toFixed(1)} risque`),
  },

  // ARÈNE
  {
    id: 'arena_platforms',
    category: 'arene',
    name: 'Terrasses & Jump Pads',
    description: 'Déploie plateformes, jump pads et augmente la valeur du Sanctuaire.',
    baseCost: 110,
    costFactor: 1.15,
    maxLevel: 5,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `Palier ${lvl}`),
  },
  {
    id: 'arena_mobile',
    category: 'arene',
    name: 'Géodes Dérivantes',
    description: 'Fait léviter des géodes mobiles à +75% de valeur.',
    baseCost: 180,
    costFactor: 1.15,
    maxLevel: 10,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `${lvl * 2} mobiles`),
  },
  {
    id: 'arena_twins',
    category: 'arene',
    name: 'Résonance Jumelle',
    description: 'Multiplie la prime des Géodes Jumelles synchronisées avec un écho.',
    baseCost: 300,
    costFactor: 1.15,
    maxLevel: 10,
    effectLabel: (lvl) => `×${(3.5 + lvl * 0.6).toFixed(1)} synchro`,
  },
  {
    id: 'arena_armored',
    category: 'arene',
    name: 'Géodes Blindées',
    description: 'Fait émerger des monolithes d’obsidienne très lucratifs.',
    baseCost: 440,
    costFactor: 1.15,
    maxLevel: 10,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `${lvl} blindées`),
  },
  {
    id: 'arena_explosive',
    category: 'arene',
    name: 'Géodes Instables',
    description: 'Explosent en brisant toutes les géodes voisines.',
    baseCost: 680,
    costFactor: 1.15,
    maxLevel: 8,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `${lvl} instables`),
  },
  {
    id: 'arena_golden',
    category: 'arene',
    name: 'Géodes Solaires',
    description: 'Cristaux dorés rares libérant une pluie d’éclats.',
    baseCost: 980,
    costFactor: 1.15,
    maxLevel: 8,
    effectLabel: (lvl) => (lvl === 0 ? 'Verrouillé' : `${lvl} dorées`),
  },

  // AIMANT
  {
    id: 'magnet_radius',
    category: 'aimant',
    name: 'Champ Magnétique',
    description: '+20% portée d’attraction des éclats dorés par niveau.',
    baseCost: 48,
    costFactor: 1.15,
    maxLevel: 20,
    effectLabel: (lvl) => `${(5.5 * (1 + lvl * 0.2)).toFixed(1)}m`,
  },
  {
    id: 'magnet_speed',
    category: 'aimant',
    name: 'Spirale Cinétique',
    description: '+20% vitesse d’aspiration des éclats en orbite.',
    baseCost: 68,
    costFactor: 1.15,
    maxLevel: 20,
    effectLabel: (lvl) => `${Math.round(14 * (1 + lvl * 0.2))} m/s`,
  },
];

export type PrestigePerkId = 'chronos_edge' | 'echo_chorus' | 'golden_harvest';

export interface PrestigePerkDef {
  id: PrestigePerkId;
  name: string;
  description: string;
}

export const PRESTIGE_PERKS: PrestigePerkDef[] = [
  {
    id: 'chronos_edge',
    name: 'Tempo Solaire',
    description: '+55% cadence de tir et +22% vitesse de déplacement permanents.',
  },
  {
    id: 'echo_chorus',
    name: 'Chœur Spectral',
    description: '+2 emplacements d’échos initiaux et +40% rendement des échos.',
  },
  {
    id: 'golden_harvest',
    name: 'Moisson Dorée',
    description: '+75% d’éclats par géode et rayon d’aimant doublé.',
  },
];

export type TutorialStepId =
  | 'break_5_geodes'
  | 'finish_loop'
  | 'watch_echo'
  | 'buy_upgrade'
  | 'relay_shot'
  | 'twin_geode'
  | 'switch_vault'
  | 'defeat_devourer'
  | 'reach_prestige'
  | 'done';

export const TUTORIAL_LABELS: Record<TutorialStepId, string> = {
  break_5_geodes: 'Brise 5 géodes',
  finish_loop: 'Termine ta boucle',
  watch_echo: 'Observe ton écho rejouer',
  buy_upgrade: 'Achète une amélioration au Terminal',
  relay_shot: 'Tire à travers un écho (Relais ×2.5)',
  twin_geode: 'Synchronise une Géode Jumelle avec un écho',
  switch_vault: 'Active l’interrupteur du Sanctuaire avec un écho',
  defeat_devourer: 'Abats un Dévoreur qui attaque tes échos',
  reach_prestige: 'Atteins l’Effondrement (Prestige)',
  done: '',
};

export type QualityPreset = 'high' | 'medium' | 'low';

export interface GameSettings {
  sensitivity: number;
  vibration: boolean;
  quality: QualityPreset;
  fps30: boolean;
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1.0,
  vibration: true,
  quality: 'high',
  fps30: false,
  muted: false,
};

export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
