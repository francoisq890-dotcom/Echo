import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ARENA_RADIUS,
  createSeededRng,
  GameSettings,
  MAX_ECHO_INSTANCES,
  PALETTE,
  WORLD_SEED,
} from './config';
import {
  ComputedStats,
  EchoRecord,
  formatShards,
  getEchoEffectiveRate,
} from './economy';
import { collectEchoShotsInWindow, EchoRecorder, PoseSample, sampleEchoPose } from './echoes';
import { SoundEngine } from './audio';
import { UnifiedInputController } from './controls';

export type GeodeType = 'normal' | 'mobile' | 'armored' | 'golden' | 'explosive' | 'twin';

interface GeodeEntity {
  active: boolean;
  slotIndex: number;
  type: GeodeType;
  baseX: number;
  baseY: number;
  baseZ: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  crackStage: number; // 0, 1, 2
  shardValue: number;
  hitFlash: number;
  respawnTimer: number;
  phase: number;
  rotSpeed: number;
  scale: number;
  orbitAmp: number;
  orbitFreq: number;
  pairId: number;
  resonanceTimer: number;
  lastShooterTag: string;
  vaultBound: boolean;
}

interface DevourerEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  targetEchoId: string;
  latched: boolean;
  hitFlash: number;
  phase: number;
}

interface ChronoSwitchEntity {
  x: number;
  y: number;
  z: number;
  flash: number;
  group: THREE.Group;
  crystalMat: THREE.MeshStandardMaterial;
}

interface EchoGeodeEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  scale: number;
  flash: number;
  phase: number;
}

interface ShardEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  value: number;
  age: number;
  spin: number;
  magnetized: boolean;
}

interface BeamEntity {
  active: boolean;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  life: number;
  maxLife: number;
  isEcho: boolean;
  isGolden: boolean;
}

interface ParticleEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  r: number;
  g: number;
  b: number;
}

interface RingEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  life: number;
  maxLife: number;
  maxRadius: number;
  r: number;
  g: number;
  b: number;
}

interface PlatformBox {
  x: number;
  y: number;
  z: number;
  halfW: number;
  halfD: number;
  topY: number;
  minLevel: number;
}

interface JumpPad {
  x: number;
  y: number;
  z: number;
  radius: number;
  boostY: number;
  minLevel: number;
}

export interface ProjectedEchoLabel {
  id: string;
  x: number;
  y: number;
  rateText: string;
  suppressed?: boolean;
}

export interface FloatingPopupEvent {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: 'damage' | 'shard' | 'crit';
}

export interface WorldHudSnapshot {
  loopTime: number;
  loopDuration: number;
  loopShards: number;
  combo: number;
  aimingAtGeode: boolean;
  nearTerminal: boolean;
  echoLabels: ProjectedEchoLabel[];
  dashUnlocked: boolean;
  dashCooldownRemaining: number;
  dashCooldownMax: number;
  overloadActive: boolean;
  vaultOpen: boolean;
  vaultTimer: number;
  suppressedCount: number;
  activeDevourers: number;
  activeRatePerSec: number;
}

export interface WorldCallbacks {
  onHudUpdate: (snap: WorldHudSnapshot) => void;
  onShardsCollected: (amount: number, fromLoopEnd?: boolean) => void;
  onGeodeBroken: (type: GeodeType, isPlayer: boolean) => void;
  onLoopCompleted: (record: EchoRecord) => void;
  onOpenTerminal: () => void;
  onFloatingPopup: (popup: FloatingPopupEvent) => void;
  onHitMarker: (crit: boolean) => void;
  onLoopFlash: () => void;
  onFirstMoveOrAim: (moved: boolean, aimed: boolean) => void;
  onRelayShot?: () => void;
  onTwinSynced?: () => void;
  onSwitchActivated?: (byEcho: boolean) => void;
  onDevourerSlain?: () => void;
  onSuppressedChange?: (suppressedIds: string[]) => void;
}

const MAX_GEODES = 64;
const MAX_ECHO_GEODES = 48;
const MAX_SHARDS = 180;
const MAX_BEAMS = 96;
const MAX_PARTICLES = 180;
const MAX_RINGS = 28;
const MAX_DEVOURERS = 6;
const MAX_TWIN_LINKS = 4;

// Reusable scratch math objects (Zero-GC render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

export function groundHeightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 18) return 0;
  const edge = Math.min(1, (r - 18) / 14);
  const dunes =
    Math.sin(x * 0.14) * Math.cos(z * 0.14) * 0.65 +
    Math.sin(x * 0.06 + z * 0.08) * 0.8;
  return Math.max(0, edge * edge * (1.2 + dunes));
}

function createSandTexture(isBump: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (isBump) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = '#d9a773';
    ctx.fillRect(0, 0, size, size);
  }

  const rng = createSeededRng(1091);
  // Subtle wind-swept desert ripples
  for (let y = 0; y < size; y += 2) {
    const wave = Math.sin((y / size) * Math.PI * 10) * 0.5 + 0.5;
    ctx.fillStyle = isBump
      ? `rgba(${Math.round(115 + wave * 35)}, ${Math.round(115 + wave * 35)}, ${Math.round(115 + wave * 35)}, 0.35)`
      : `rgba(184, 129, 80, ${(0.06 + wave * 0.08).toFixed(3)})`;
    ctx.fillRect(0, y, size, 2);
  }

  for (let i = 0; i < 2400; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 1 + rng() * 2;
    if (isBump) {
      const v = Math.round(95 + rng() * 65);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
    } else {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(245, 206, 158, 0.25)' : 'rgba(154, 96, 58, 0.2)';
    }
    ctx.fillRect(x, y, s, s);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  if (!isBump) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGeodeClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Stone cradle base (DodecahedronGeometry is already non-indexed)
  const base = new THREE.DodecahedronGeometry(0.42, 0);
  base.scale(1.1, 0.65, 1.1);
  base.translate(0, 0.16, 0);
  parts.push(base);

  // Main central crystal spire
  const mainRaw = new THREE.ConeGeometry(0.32, 1.12, 6);
  const main = mainRaw.index ? mainRaw.toNonIndexed() : mainRaw;
  if (main !== mainRaw) mainRaw.dispose();
  main.translate(0, 0.68, 0);
  parts.push(main);

  // 4 surrounding angled shards
  const angles = [0.2, 1.85, 3.4, 4.9];
  angles.forEach((a, idx) => {
    const raw = new THREE.ConeGeometry(0.18 + (idx % 2) * 0.04, 0.68 + (idx % 2) * 0.16, 5);
    const spire = raw.index ? raw.toNonIndexed() : raw;
    if (spire !== raw) raw.dispose();
    spire.rotateZ(0.38 + (idx % 2) * 0.1);
    spire.rotateY(a);
    spire.translate(Math.cos(a) * 0.24, 0.44, Math.sin(a) * 0.24);
    parts.push(spire);
  });

  for (const p of parts) {
    p.deleteAttribute('uv');
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) {
    return new THREE.OctahedronGeometry(0.7, 0);
  }
  merged.computeVertexNormals();
  return merged;
}

export class EchoWorldEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private sound: SoundEngine;
  private input: UnifiedInputController;
  private callbacks: WorldCallbacks;

  private frameId = 0;
  private disposed = false;
  private lastTime = 0;
  private accumulator = 0;
  private simTime = 0;
  private hudEmitTimer = 0;

  // Game mode & loop state
  private mode: 'title' | 'playing' | 'paused' = 'title';
  private stats!: ComputedStats;
  private echoes: EchoRecord[] = [];
  private settings: GameSettings;
  private recorder = new EchoRecorder();
  private loopTime = 0;
  private loopShards = 0;
  private prevEchoLoopTime = 0;
  private combo = 0;
  private comboTimer = 0;
  private nextPopupId = 1;

  // Hit-stop, recoil & shake
  private hitstopTimer = 0;
  private trauma = 0;
  private recoilZ = 0;
  private recoilPitch = 0;
  private muzzleFlashTimer = 0;
  private fireCooldown = 0;
  private fovKick = 0;

  // Player kinematics
  private playerX = 0;
  private playerY = 0;
  private playerZ = 9;
  private playerVy = 0;
  private yaw = 0;
  private pitch = -0.04;
  private grounded = true;
  private coyoteTimer = 0;
  private walkBobDist = 0;
  private readonly eyeHeight = 1.68;

  // Weapon viewmodel
  private weaponGroup = new THREE.Group();
  private weaponCoreMesh!: THREE.Mesh;
  private weaponFins!: THREE.Group;
  private weaponRing!: THREE.Mesh;
  private weaponCrown!: THREE.Group;
  private muzzleMesh!: THREE.Mesh;
  private muzzleLight!: THREE.PointLight;

  // Terminal & Arena props
  private terminalGroup = new THREE.Group();
  private terminalHoloRing!: THREE.Mesh;
  private terminalScreenMat!: THREE.MeshStandardMaterial;
  private readonly terminalPos = new THREE.Vector3(5.5, 0, -4.0);
  private platformMeshes: Array<{ mesh: THREE.Mesh; minLevel: number }> = [];
  private jumpPadMeshes: Array<{ group: THREE.Group; ring: THREE.Mesh; minLevel: number }> = [];
  private platforms: PlatformBox[] = [
    { x: -11, y: 0, z: -4, halfW: 3.2, halfD: 3.2, topY: 3.2, minLevel: 1 },
    { x: 11, y: 0, z: 3, halfW: 3.2, halfD: 3.2, topY: 3.6, minLevel: 2 },
    { x: 0, y: 0, z: -18, halfW: 4.0, halfD: 3.0, topY: 4.2, minLevel: 3 },
    { x: -14, y: 0, z: 12, halfW: 3.0, halfD: 3.0, topY: 3.4, minLevel: 4 },
    { x: 14, y: 0, z: -13, halfW: 3.4, halfD: 3.4, topY: 4.8, minLevel: 5 },
  ];
  private jumpPads: JumpPad[] = [
    { x: -6.8, y: 0, z: -4, radius: 1.45, boostY: 13.5, minLevel: 1 },
    { x: 6.8, y: 0, z: 3, radius: 1.45, boostY: 14.2, minLevel: 2 },
    { x: 0, y: 0, z: -12.5, radius: 1.5, boostY: 15.2, minLevel: 3 },
    { x: -9.8, y: 0, z: 12, radius: 1.45, boostY: 13.8, minLevel: 4 },
    { x: 9.8, y: 0, z: -13, radius: 1.5, boostY: 16.0, minLevel: 5 },
  ];

  // Dash, Overload, Chrono-Vault & Devourers state
  private dashCooldownTimer = 0;
  private dashBurstTimer = 0;
  private dashDirX = 0;
  private dashDirZ = 0;
  private overloadArmed = false;
  private loopOverloaded = false;
  private vaultTimer = 0;
  private vaultTopY = 0.25;
  private vaultMesh!: THREE.Mesh;
  private chronoSwitches: ChronoSwitchEntity[] = [];
  private devourerSpawnTimer = 9;
  private devourers: DevourerEntity[] = [];
  private suppressedEchoIds = new Set<string>();
  private prevSuppressedSig = '';
  private activeShardSamples: Array<{ t: number; amount: number }> = [];

  // Instanced pools
  private geodeMesh!: THREE.InstancedMesh;
  private echoGeodeMesh!: THREE.InstancedMesh;
  private echoBodyMesh!: THREE.InstancedMesh;
  private echoWeaponMesh!: THREE.InstancedMesh;
  private shardMesh!: THREE.InstancedMesh;
  private beamMesh!: THREE.InstancedMesh;
  private particleMesh!: THREE.InstancedMesh;
  private ringMesh!: THREE.InstancedMesh;
  private devourerMesh!: THREE.InstancedMesh;
  private twinLinkMesh!: THREE.InstancedMesh;

  private geodes: GeodeEntity[] = [];
  private echoGeodes: EchoGeodeEntity[] = [];
  private shards: ShardEntity[] = [];
  private beams: BeamEntity[] = [];
  private particles: ParticleEntity[] = [];
  private rings: RingEntity[] = [];
  private poseScratch: PoseSample = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  private resizeObserver: ResizeObserver;
  private cleanupInput: () => void;

  constructor(options: {
    container: HTMLElement;
    sound: SoundEngine;
    input: UnifiedInputController;
    initialStats: ComputedStats;
    initialEchoes: EchoRecord[];
    initialSettings: GameSettings;
    callbacks: WorldCallbacks;
  }) {
    this.container = options.container;
    this.sound = options.sound;
    this.input = options.input;
    this.stats = options.initialStats;
    this.echoes = options.initialEchoes;
    this.settings = { ...options.initialSettings };
    this.callbacks = options.callbacks;

    // Probe for software WebGL
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyQualityPixelRatio();

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.fog);
    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0155);

    this.camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 180);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Environment map (RoomEnvironment)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.buildSkyAndLighting();
    this.buildArenaAndPerimeters();
    this.buildUpgradeTerminal();
    this.buildPlatformsAndPads();
    this.buildChronoVaultAndSwitches();
    this.buildWeaponViewmodel();
    this.buildInstancedPools();
    this.populateDeterministicGeodes();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.cleanupInput = this.input.attach(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);

    // Handle WebGL context loss gracefully
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stopLoop();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.startLoop();
    });

    this.applyWeaponTierVisuals();
    this.updatePlatformVisibility();
    this.startLoop();
  }

  private applyQualityPixelRatio(): void {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      return;
    }
    const maxCap = this.settings.quality === 'low' ? 1.0 : this.settings.quality === 'medium' ? 1.25 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxCap));
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.applyQualityPixelRatio();
  };

  private buildSkyAndLighting(): void {
    // Twilight violet -> warm dusk terracotta sky dome
    const skyGeo = new THREE.SphereGeometry(130, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a1f52) },
        midColor: { value: new THREE.Color(0x833c55) },
        bottomColor: { value: new THREE.Color(0xd27748) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col = mix(bottomColor, midColor, smoothstep(-0.02, 0.22, h));
          col = mix(col, topColor, smoothstep(0.18, 0.62, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    // Warm desert sun key light + cool twilight violet hemisphere fill
    const hemi = new THREE.HemisphereLight(0x9b72cf, 0xb86d43, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffdfb0, 1.65);
    sun.position.set(22, 34, 16);
    sun.castShadow = !this.isSoftwareGl && this.settings.quality !== 'low';
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 90;
    const d = 32;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x8844aa, 0.45);
    rim.position.set(-20, 14, -24);
    this.scene.add(rim);
  }

  private buildArenaAndPerimeters(): void {
    const sandMap = createSandTexture(false);
    const sandBump = createSandTexture(true);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    sandMap.anisotropy = maxAniso;
    sandBump.anisotropy = maxAniso;

    // Ground mesh extending far to horizon so there's never an empty void
    const groundGeo = new THREE.PlaneGeometry(140, 140, 48, 48);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, groundHeightAt(x, z));
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandMap,
      bumpMap: sandBump,
      bumpScale: 0.08,
      roughness: 0.88,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Decorative sandstone ring markers on central plaza (offset Y >= 0.02 to prevent Z-fighting)
    const plazaRingGeo = new THREE.RingGeometry(17.4, 17.9, 48);
    plazaRingGeo.rotateX(-Math.PI / 2);
    const plazaRingMat = new THREE.MeshStandardMaterial({
      color: PALETTE.terracotta,
      roughness: 0.72,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const plazaRing = new THREE.Mesh(plazaRingGeo, plazaRingMat);
    plazaRing.position.y = 0.025;
    plazaRing.receiveShadow = true;
    this.scene.add(plazaRing);

    // Natural perimeter: stratified terracotta cliffs & sandstone monoliths (no boxy indoor walls)
    const cliffMat = new THREE.MeshStandardMaterial({
      color: PALETTE.terracotta,
      roughness: 0.86,
      metalness: 0.05,
      flatShading: true,
    });
    const rockMat = new THREE.MeshStandardMaterial({
      color: PALETTE.terracottaDark,
      roughness: 0.9,
      metalness: 0.04,
      flatShading: true,
    });

    const mesaGeo = new THREE.CylinderGeometry(3.2, 5.4, 12, 7);
    const rng = createSeededRng(7721);
    const mesaCount = 26;
    const mesaInst = new THREE.InstancedMesh(mesaGeo, cliffMat, mesaCount);
    mesaInst.receiveShadow = true;
    mesaInst.castShadow = !this.isSoftwareGl;

    for (let i = 0; i < mesaCount; i++) {
      const angle = (i / mesaCount) * Math.PI * 2 + (rng() - 0.5) * 0.12;
      const dist = ARENA_RADIUS + 4 + rng() * 14;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const sy = 0.65 + rng() * 1.4;
      const sx = 0.85 + rng() * 0.9;
      const sz = 0.85 + rng() * 0.9;
      _euler.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
      _quat.setFromEuler(_euler);
      _scale.set(sx, sy, sz);
      _v1.set(x, groundHeightAt(x, z) + 4.5 * sy - 1.2, z);
      _mat4.compose(_v1, _quat, _scale);
      mesaInst.setMatrixAt(i, _mat4);
      _color.setHex(PALETTE.terracotta).lerp(new THREE.Color(PALETTE.sandDark), rng() * 0.35);
      mesaInst.setColorAt(i, _color);
    }
    mesaInst.instanceMatrix.needsUpdate = true;
    if (mesaInst.instanceColor) mesaInst.instanceColor.needsUpdate = true;
    mesaInst.computeBoundingSphere();
    this.scene.add(mesaInst);

    // Inner desert boulders around arena perimeter for natural collision boundary cue
    const boulderGeo = new THREE.DodecahedronGeometry(1.3, 0);
    const boulderCount = 28;
    const boulderInst = new THREE.InstancedMesh(boulderGeo, rockMat, boulderCount);
    boulderInst.castShadow = !this.isSoftwareGl;
    boulderInst.receiveShadow = true;
    for (let i = 0; i < boulderCount; i++) {
      const a = (i / boulderCount) * Math.PI * 2 + 0.15;
      const d = ARENA_RADIUS + 0.8 + rng() * 2.5;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = 0.7 + rng() * 0.9;
      _euler.set(rng() * 0.5, rng() * Math.PI, rng() * 0.5);
      _quat.setFromEuler(_euler);
      _scale.set(s * 1.2, s * 0.8, s);
      _v1.set(x, groundHeightAt(x, z) + 0.45 * s, z);
      _mat4.compose(_v1, _quat, _scale);
      boulderInst.setMatrixAt(i, _mat4);
    }
    boulderInst.instanceMatrix.needsUpdate = true;
    boulderInst.computeBoundingSphere();
    this.scene.add(boulderInst);
  }

  private buildUpgradeTerminal(): void {
    const gx = this.terminalPos.x;
    const gz = this.terminalPos.z;
    const gy = groundHeightAt(gx, gz);
    this.terminalGroup.position.set(gx, gy, gz);
    this.terminalGroup.lookAt(0, gy, 9);

    const obsidianMat = new THREE.MeshStandardMaterial({
      color: PALETTE.obsidian,
      roughness: 0.42,
      metalness: 0.65,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4964c,
      roughness: 0.28,
      metalness: 0.85,
    });
    this.terminalScreenMat = new THREE.MeshStandardMaterial({
      color: PALETTE.echoCyan,
      emissive: PALETTE.echoCyan,
      emissiveIntensity: 1.1,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    });

    // 1. Stepped sandstone/obsidian plinth
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.95, 0.36, 8), obsidianMat);
    plinth.position.y = 0.18;
    plinth.receiveShadow = true;
    plinth.castShadow = !this.isSoftwareGl;
    this.terminalGroup.add(plinth);

    // 2. Contact shadow disc
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x1a0d24, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.02;
    this.terminalGroup.add(shadowDisc);

    // 3. Stanchion column
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.45, 0.55), obsidianMat);
    col.position.y = 1.05;
    col.castShadow = !this.isSoftwareGl;
    this.terminalGroup.add(col);

    // 4. Brass bezel trim
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.15, 0.14), brassMat);
    trim.position.set(0, 2.05, 0.18);
    trim.rotation.x = -0.22;
    this.terminalGroup.add(trim);

    // 5. Holographic screen
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.96), this.terminalScreenMat);
    screen.position.set(0, 2.07, 0.26);
    screen.rotation.x = -0.22;
    this.terminalGroup.add(screen);

    // 6. Floating hologram ring beacon above terminal
    this.terminalHoloRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.68, 0.045, 8, 24),
      this.terminalScreenMat,
    );
    this.terminalHoloRing.position.set(0, 3.15, 0);
    this.terminalGroup.add(this.terminalHoloRing);

    this.scene.add(this.terminalGroup);
  }

  private buildPlatformsAndPads(): void {
    const platMat = new THREE.MeshStandardMaterial({
      color: PALETTE.sandDark,
      roughness: 0.78,
      metalness: 0.08,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: PALETTE.terracotta,
      roughness: 0.6,
      metalness: 0.18,
    });
    const padBaseMat = new THREE.MeshStandardMaterial({
      color: PALETTE.obsidian,
      roughness: 0.38,
      metalness: 0.7,
    });
    const padGlowMat = new THREE.MeshStandardMaterial({
      color: PALETTE.echoCyan,
      emissive: PALETTE.echoCyan,
      emissiveIntensity: 1.35,
      roughness: 0.2,
      metalness: 0.2,
    });

    for (const p of this.platforms) {
      const height = p.topY;
      const geo = new THREE.BoxGeometry(p.halfW * 2, height, p.halfD * 2);
      const mesh = new THREE.Mesh(geo, platMat);
      mesh.position.set(p.x, height * 0.5, p.z);
      mesh.castShadow = !this.isSoftwareGl;
      mesh.receiveShadow = true;

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(p.halfW * 2 + 0.2, 0.22, p.halfD * 2 + 0.2),
        trimMat,
      );
      cap.position.y = height * 0.5 - 0.11;
      mesh.add(cap);

      this.scene.add(mesh);
      this.platformMeshes.push({ mesh, minLevel: p.minLevel });
    }

    for (const pad of this.jumpPads) {
      const group = new THREE.Group();
      const gy = groundHeightAt(pad.x, pad.z);
      group.position.set(pad.x, gy, pad.z);

      const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.radius, pad.radius * 1.15, 0.22, 16), padBaseMat);
      disc.position.y = 0.11;
      group.add(disc);

      const core = new THREE.Mesh(new THREE.CylinderGeometry(pad.radius * 0.7, pad.radius * 0.7, 0.26, 16), padGlowMat);
      core.position.y = 0.13;
      group.add(core);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(pad.radius * 0.75, 0.05, 8, 24), padGlowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.45;
      group.add(ring);

      this.scene.add(group);
      this.jumpPadMeshes.push({ group, ring, minLevel: pad.minLevel });
    }
  }

  private buildChronoVaultAndSwitches(): void {
    // Rising Sanctuary Vault platform at (0, 0, -13.5)
    const vaultGeo = new THREE.BoxGeometry(7.2, 2.4, 5.4);
    const vaultMat = new THREE.MeshStandardMaterial({
      color: PALETTE.obsidian,
      roughness: 0.45,
      metalness: 0.45,
    });
    this.vaultMesh = new THREE.Mesh(vaultGeo, vaultMat);
    this.vaultMesh.position.set(0, -0.95, -13.5);
    this.vaultMesh.castShadow = !this.isSoftwareGl;
    this.vaultMesh.receiveShadow = true;

    const vaultRim = new THREE.Mesh(
      new THREE.BoxGeometry(7.45, 0.22, 5.65),
      new THREE.MeshStandardMaterial({
        color: PALETTE.shardGold,
        emissive: 0x996515,
        emissiveIntensity: 0.55,
        roughness: 0.3,
        metalness: 0.75,
      }),
    );
    vaultRim.position.y = 1.1;
    this.vaultMesh.add(vaultRim);
    this.scene.add(this.vaultMesh);

    // Two Chrono-Switch crystal pylons (hittable by both player & echoes!)
    const switchCoords: Array<[number, number]> = [
      [-6.5, -9.5],
      [7.8, -8.5],
    ];
    const baseMat = new THREE.MeshStandardMaterial({
      color: PALETTE.obsidian,
      roughness: 0.4,
      metalness: 0.65,
    });

    for (const [sx, sz] of switchCoords) {
      const gy = groundHeightAt(sx, sz);
      const group = new THREE.Group();
      group.position.set(sx, gy, sz);

      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 1.5, 6), baseMat);
      pillar.position.y = 0.75;
      pillar.castShadow = !this.isSoftwareGl;
      group.add(pillar);

      const crystalMat = new THREE.MeshStandardMaterial({
        color: PALETTE.echoCyan,
        emissive: PALETTE.echoCyan,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.2,
      });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
      crystal.position.y = 2.05;
      group.add(crystal);

      this.scene.add(group);
      this.chronoSwitches.push({
        x: sx,
        y: gy + 2.05,
        z: sz,
        flash: 0,
        group,
        crystalMat,
      });
    }
  }

  private buildWeaponViewmodel(): void {
    this.weaponGroup.position.set(0.28, -0.24, -0.48);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: PALETTE.obsidian,
      roughness: 0.48,
      metalness: 0.62,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd99b52,
      roughness: 0.22,
      metalness: 0.88,
    });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: PALETTE.echoCyan,
      emissive: PALETTE.echoCyan,
      emissiveIntensity: 1.4,
      roughness: 0.15,
      metalness: 0.2,
    });

    // 1. Primary receiver chassis
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.42), bodyMat);
    this.weaponGroup.add(body);

    // 2. Brass barrel shroud
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.34, 8), brassMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.22);
    this.weaponGroup.add(barrel);

    // 3. Rotating harmonic core crystal
    this.weaponCoreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), crystalMat);
    this.weaponCoreMesh.position.set(0, 0.09, -0.08);
    this.weaponGroup.add(this.weaponCoreMesh);

    // 4. Tier 1+ Side stabilizer fins
    this.weaponFins = new THREE.Group();
    const finGeo = new THREE.BoxGeometry(0.02, 0.09, 0.26);
    const finL = new THREE.Mesh(finGeo, brassMat);
    finL.position.set(-0.085, 0.01, -0.14);
    finL.rotation.z = 0.25;
    const finR = new THREE.Mesh(finGeo, brassMat);
    finR.position.set(0.085, 0.01, -0.14);
    finR.rotation.z = -0.25;
    this.weaponFins.add(finL, finR);
    this.weaponGroup.add(this.weaponFins);

    // 5. Tier 2+ Orbital harmonic ring
    this.weaponRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 18), crystalMat);
    this.weaponRing.position.set(0, 0.025, -0.26);
    this.weaponGroup.add(this.weaponRing);

    // 6. Tier 3-4 Triple-prism muzzle crown
    this.weaponCrown = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.14, 4), brassMat);
      prong.rotation.x = -Math.PI / 2;
      prong.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06 + 0.025, -0.4);
      this.weaponCrown.add(prong);
    }
    this.weaponGroup.add(this.weaponCrown);

    // Muzzle flash star + point light
    this.muzzleMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe49e, transparent: true, opacity: 0.92 }),
    );
    this.muzzleMesh.position.set(0, 0.025, -0.45);
    this.muzzleMesh.visible = false;
    this.weaponGroup.add(this.muzzleMesh);

    this.muzzleLight = new THREE.PointLight(0xffcb6b, 0, 7, 2);
    this.muzzleLight.position.set(0, 0.05, -0.5);
    this.weaponGroup.add(this.muzzleLight);

    this.camera.add(this.weaponGroup);
  }

  private applyWeaponTierVisuals(): void {
    const tier = this.stats.weaponTier;
    this.weaponFins.visible = tier >= 1;
    this.weaponRing.visible = tier >= 2;
    this.weaponCrown.visible = tier >= 3;
    const mat = this.weaponCoreMesh.material as THREE.MeshStandardMaterial;
    if (tier >= 4) {
      mat.color.setHex(PALETTE.shardGold);
      mat.emissive.setHex(PALETTE.shardGold);
      mat.emissiveIntensity = 1.9;
    } else if (tier >= 2) {
      mat.color.setHex(0x88fff7);
      mat.emissive.setHex(0x38e8e1);
      mat.emissiveIntensity = 1.6;
    } else {
      mat.color.setHex(PALETTE.echoCyan);
      mat.emissive.setHex(PALETTE.echoCyan);
      mat.emissiveIntensity = 1.25;
    }
  }

  private updatePlatformVisibility(): void {
    const lvl = this.stats.platformsLevel;
    for (const pm of this.platformMeshes) {
      pm.mesh.visible = lvl >= pm.minLevel;
    }
    for (const jp of this.jumpPadMeshes) {
      jp.group.visible = lvl >= jp.minLevel;
    }
  }

  private buildInstancedPools(): void {
    const geodeGeo = createGeodeClusterGeometry();
    const geodeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.22,
      emissive: 0x3b120e,
      emissiveIntensity: 0.45,
      flatShading: true,
    });
    this.geodeMesh = new THREE.InstancedMesh(geodeGeo, geodeMat, MAX_GEODES);
    this.geodeMesh.castShadow = !this.isSoftwareGl;
    this.geodeMesh.receiveShadow = true;
    this.geodeMesh.frustumCulled = false;
    this.scene.add(this.geodeMesh);

    const echoGeodeMat = new THREE.MeshStandardMaterial({
      color: PALETTE.echoCyan,
      emissive: PALETTE.echoCyan,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      roughness: 0.2,
    });
    this.echoGeodeMesh = new THREE.InstancedMesh(geodeGeo, echoGeodeMat, MAX_ECHO_GEODES);
    this.echoGeodeMesh.frustumCulled = false;
    this.scene.add(this.echoGeodeMesh);

    // Echo silhouettes (translucent cyan body + weapon)
    const echoBodyGeo = new THREE.CapsuleGeometry(0.32, 0.95, 4, 8);
    const echoMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: PALETTE.echoCyan,
      emissiveIntensity: 0.72,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      roughness: 0.2,
    });
    this.echoBodyMesh = new THREE.InstancedMesh(echoBodyGeo, echoMat, MAX_ECHO_INSTANCES);
    this.echoBodyMesh.frustumCulled = false;
    this.echoBodyMesh.setColorAt(0, new THREE.Color(PALETTE.echoCyan));
    this.scene.add(this.echoBodyMesh);

    const echoWepGeo = new THREE.BoxGeometry(0.12, 0.14, 0.52);
    this.echoWeaponMesh = new THREE.InstancedMesh(echoWepGeo, echoMat, MAX_ECHO_INSTANCES);
    this.echoWeaponMesh.frustumCulled = false;
    this.scene.add(this.echoWeaponMesh);

    // Golden Shards pool
    const shardGeo = new THREE.OctahedronGeometry(0.24, 0);
    const shardMat = new THREE.MeshStandardMaterial({
      color: PALETTE.shardGold,
      emissive: 0xe6951d,
      emissiveIntensity: 0.95,
      roughness: 0.18,
      metalness: 0.72,
    });
    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, MAX_SHARDS);
    this.shardMesh.frustumCulled = false;
    this.scene.add(this.shardMesh);

    // Beam tracer pool
    const beamGeo = new THREE.CylinderGeometry(0.032, 0.032, 1, 6);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, MAX_BEAMS);
    this.beamMesh.frustumCulled = false;
    this.scene.add(this.beamMesh);

    // Mineral particles pool
    const partGeo = new THREE.TetrahedronGeometry(0.13, 0);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    // Expanding shockwave rings pool
    const ringGeo = new THREE.TorusGeometry(1, 0.045, 6, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.ringMesh.frustumCulled = false;
    this.scene.add(this.ringMesh);

    // Temporal Devourers pool (spiky void-crimson octo-shards)
    const devGeo = new THREE.OctahedronGeometry(0.72, 0);
    devGeo.scale(1.1, 1.45, 1.1);
    const devMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x520b2d,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.35,
      flatShading: true,
    });
    this.devourerMesh = new THREE.InstancedMesh(devGeo, devMat, MAX_DEVOURERS);
    this.devourerMesh.frustumCulled = false;
    this.scene.add(this.devourerMesh);

    // Twin Geode resonance link beams
    const linkGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 6);
    linkGeo.rotateX(Math.PI / 2);
    const linkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.twinLinkMesh = new THREE.InstancedMesh(linkGeo, linkMat, MAX_TWIN_LINKS);
    this.twinLinkMesh.frustumCulled = false;
    this.scene.add(this.twinLinkMesh);

    for (let i = 0; i < MAX_GEODES; i++) {
      this.geodes.push({
        active: false,
        slotIndex: i,
        type: 'normal',
        baseX: 0,
        baseY: 0,
        baseZ: 0,
        x: 0,
        y: 0,
        z: 0,
        radius: 0.95,
        hp: 30,
        maxHp: 30,
        crackStage: 0,
        shardValue: 6,
        hitFlash: 0,
        respawnTimer: 0,
        phase: i * 0.7,
        rotSpeed: 0.3,
        scale: 1,
        orbitAmp: 0,
        orbitFreq: 1,
        pairId: -1,
        resonanceTimer: 0,
        lastShooterTag: '',
        vaultBound: false,
      });
    }
    for (let i = 0; i < MAX_DEVOURERS; i++) {
      this.devourers.push({
        active: false,
        x: 0,
        y: 2,
        z: 0,
        hp: 26,
        maxHp: 26,
        targetEchoId: '',
        latched: false,
        hitFlash: 0,
        phase: i * 1.1,
      });
    }
    for (let i = 0; i < MAX_ECHO_GEODES; i++) {
      this.echoGeodes.push({ active: false, x: 0, y: 0, z: 0, scale: 1, flash: 0, phase: i * 0.6 });
    }
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.shards.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        value: 1,
        age: 0,
        spin: 0,
        magnetized: false,
      });
    }
    for (let i = 0; i < MAX_BEAMS; i++) {
      this.beams.push({
        active: false,
        sx: 0,
        sy: 0,
        sz: 0,
        ex: 0,
        ey: 0,
        ez: 0,
        life: 0,
        maxLife: 0.14,
        isEcho: false,
        isGolden: false,
      });
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        scale: 1,
        r: 1,
        g: 1,
        b: 1,
      });
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        life: 0,
        maxLife: 0.4,
        maxRadius: 3,
        r: 1,
        g: 1,
        b: 1,
      });
    }
  }

  private populateDeterministicGeodes(): void {
    const rng = createSeededRng(WORLD_SEED);

    // First 3 geodes placed in clear forward arc from player spawn (0, 0, 9) facing -Z
    const starterPositions: Array<[number, number]> = [
      [0, -1.5],
      [-4.2, -3.5],
      [4.5, -2.5],
      [-8.5, 2.0],
      [8.5, 1.5],
      [-2.5, -9.5],
    ];

    const twinCoords: Array<[number, number, number]> = [
      [-5.2, -5.0, 0],
      [-2.2, -6.5, 0],
      [6.2, -1.2, 1],
      [8.6, 2.2, 1],
    ];
    const vaultCoords: Array<[number, number]> = [
      [-1.8, -13.5],
      [0.0, -13.8],
      [1.8, -13.5],
    ];

    const baseCount = 24;
    const twinReserve = 4;
    const vaultReserve = 3;
    const totalActive = Math.min(
      MAX_GEODES,
      baseCount +
        twinReserve +
        vaultReserve +
        this.stats.mobileGeodeBonusCount +
        this.stats.armoredGeodeCount +
        this.stats.explosiveGeodeCount +
        this.stats.goldenGeodeCount +
        this.stats.platformsLevel * 2,
    );

    for (let i = 0; i < MAX_GEODES; i++) {
      const g = this.geodes[i];
      if (i >= totalActive) {
        g.active = false;
        continue;
      }

      let x = 0;
      let z = 0;
      let y = 0;
      let type: GeodeType = 'normal';
      let pairId = -1;
      let vaultBound = false;

      if (i < starterPositions.length) {
        x = starterPositions[i][0];
        z = starterPositions[i][1];
        y = groundHeightAt(x, z);
      } else if (i >= baseCount && i < baseCount + twinReserve) {
        const tIdx = i - baseCount;
        x = twinCoords[tIdx][0];
        z = twinCoords[tIdx][1];
        y = groundHeightAt(x, z);
        type = 'twin';
        pairId = twinCoords[tIdx][2];
      } else if (i >= baseCount + twinReserve && i < baseCount + twinReserve + vaultReserve) {
        const vIdx = i - baseCount - twinReserve;
        x = vaultCoords[vIdx][0];
        z = vaultCoords[vIdx][1];
        y = this.vaultTopY;
        type = vIdx === 1 ? 'golden' : 'armored';
        vaultBound = true;
      } else if (
        i >= baseCount + twinReserve + vaultReserve &&
        i < baseCount + twinReserve + vaultReserve + this.stats.platformsLevel * 2
      ) {
        const platIdx = (i - baseCount - twinReserve - vaultReserve) % this.stats.platformsLevel;
        const p = this.platforms[platIdx];
        x = p.x + (rng() - 0.5) * p.halfW * 1.1;
        z = p.z + (rng() - 0.5) * p.halfD * 1.1;
        y = p.topY;
      } else {
        for (let attempt = 0; attempt < 8; attempt++) {
          const a = rng() * Math.PI * 2;
          const dist = 4.5 + rng() * (ARENA_RADIUS - 7);
          x = Math.cos(a) * dist;
          z = Math.sin(a) * dist;
          if (Math.hypot(x - this.terminalPos.x, z - this.terminalPos.z) > 3.8) break;
        }
        y = groundHeightAt(x, z);

        const extraIdx = i - baseCount - twinReserve - vaultReserve - this.stats.platformsLevel * 2;
        if (extraIdx >= 0) {
          if (extraIdx < this.stats.goldenGeodeCount) type = 'golden';
          else if (extraIdx < this.stats.goldenGeodeCount + this.stats.explosiveGeodeCount) type = 'explosive';
          else if (
            extraIdx <
            this.stats.goldenGeodeCount + this.stats.explosiveGeodeCount + this.stats.armoredGeodeCount
          )
            type = 'armored';
          else if (
            extraIdx <
            this.stats.goldenGeodeCount +
              this.stats.explosiveGeodeCount +
              this.stats.armoredGeodeCount +
              this.stats.mobileGeodeBonusCount
          )
            type = 'mobile';
        }
      }

      this.configureGeodeEntity(g, type, x, y, z, rng(), pairId, vaultBound);
    }

    // Echo geodes: translucent cyan copies of the core deterministic arena pattern
    const echoRng = createSeededRng(WORLD_SEED + 99);
    for (let i = 0; i < MAX_ECHO_GEODES; i++) {
      const eg = this.echoGeodes[i];
      if (i < 22) {
        eg.active = true;
        if (i < starterPositions.length) {
          eg.x = starterPositions[i][0];
          eg.z = starterPositions[i][1];
        } else {
          const a = echoRng() * Math.PI * 2;
          const dist = 5 + echoRng() * (ARENA_RADIUS - 8);
          eg.x = Math.cos(a) * dist;
          eg.z = Math.sin(a) * dist;
        }
        eg.y = groundHeightAt(eg.x, eg.z) + 0.15;
        eg.scale = 0.85 + echoRng() * 0.35;
        eg.flash = 0;
      } else {
        eg.active = false;
      }
    }
  }

  private configureGeodeEntity(
    g: GeodeEntity,
    type: GeodeType,
    x: number,
    y: number,
    z: number,
    randSeed: number,
    pairId = -1,
    vaultBound = false,
  ): void {
    g.active = true;
    g.type = type;
    g.baseX = x;
    g.baseY = y + (type === 'mobile' ? 1.8 + randSeed * 1.1 : 0);
    g.baseZ = z;
    g.x = g.baseX;
    g.y = g.baseY;
    g.z = g.baseZ;
    g.crackStage = 0;
    g.hitFlash = 0;
    g.respawnTimer = 0;
    g.phase = randSeed * Math.PI * 2;
    g.rotSpeed = (randSeed - 0.5) * 0.4;
    g.orbitAmp = type === 'mobile' ? 2.2 : 0;
    g.orbitFreq = type === 'mobile' ? 0.95 + randSeed * 0.5 : 0;
    g.pairId = pairId;
    g.resonanceTimer = 0;
    g.lastShooterTag = '';
    g.vaultBound = vaultBound;

    if (type === 'armored') {
      g.maxHp = 95;
      g.scale = 1.35;
      g.radius = 1.25;
      g.shardValue = vaultBound ? 44 : 28;
    } else if (type === 'golden') {
      g.maxHp = 55;
      g.scale = 1.22;
      g.radius = 1.1;
      g.shardValue = vaultBound ? 85 : 52;
    } else if (type === 'twin') {
      g.maxHp = 28;
      g.scale = 1.18;
      g.radius = 1.08;
      g.shardValue = 18;
    } else if (type === 'explosive') {
      g.maxHp = 26;
      g.scale = 1.15;
      g.radius = 1.05;
      g.shardValue = 16;
    } else if (type === 'mobile') {
      g.maxHp = 32;
      g.scale = 1.05;
      g.radius = 1.0;
      g.shardValue = 14;
    } else {
      g.maxHp = 20;
      g.scale = 0.95 + randSeed * 0.25;
      g.radius = 0.98;
      g.shardValue = 8;
    }
    g.hp = g.maxHp;
  }

  public setOverloadArmed(armed: boolean): void {
    this.overloadArmed = armed;
    if (this.loopTime < 0.25) {
      this.loopOverloaded = armed && this.stats.overloadUnlocked;
    }
  }

  public syncProgression(
    stats: ComputedStats,
    echoes: EchoRecord[],
    settings: GameSettings,
  ): void {
    const prevTier = this.stats?.weaponTier ?? 0;
    const prevArenaSig =
      (this.stats?.platformsLevel ?? 0) * 1000 +
      (this.stats?.mobileGeodeBonusCount ?? 0) * 100 +
      (this.stats?.armoredGeodeCount ?? 0) * 10 +
      (this.stats?.goldenGeodeCount ?? 0) +
      (this.stats?.explosiveGeodeCount ?? 0);

    this.stats = stats;
    this.echoes = echoes;
    this.settings = { ...settings };
    this.input.setSensitivity(settings.sensitivity);
    this.sound.setMuted(settings.muted);
    this.sound.setVibration(settings.vibration);
    this.applyQualityPixelRatio();
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && settings.quality !== 'low';

    if (stats.weaponTier !== prevTier) {
      this.applyWeaponTierVisuals();
    }
    this.updatePlatformVisibility();

    const newArenaSig =
      stats.platformsLevel * 1000 +
      stats.mobileGeodeBonusCount * 100 +
      stats.armoredGeodeCount * 10 +
      stats.goldenGeodeCount +
      stats.explosiveGeodeCount;
    if (newArenaSig !== prevArenaSig) {
      this.populateDeterministicGeodes();
    }
  }

  public setMode(mode: 'title' | 'playing' | 'paused'): void {
    const prev = this.mode;
    this.mode = mode;
    this.weaponGroup.visible = mode !== 'title';
    if (mode === 'playing' && prev === 'title') {
      this.resetPlayerToSpawn();
      this.loopTime = 0;
      this.prevEchoLoopTime = 0;
      this.loopShards = 0;
      this.loopOverloaded = this.overloadArmed && this.stats.overloadUnlocked;
      this.recorder.reset();
      this.recorder.recordFrame(0, this.playerX, this.playerY + this.eyeHeight, this.playerZ, this.yaw, this.pitch, true);
    }
    if (mode !== 'playing') {
      this.input.clearAll();
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock?.();
      }
    }
  }

  public resetForPrestige(stats: ComputedStats, echoes: EchoRecord[]): void {
    this.stats = stats;
    this.echoes = echoes;
    this.loopTime = 0;
    this.prevEchoLoopTime = 0;
    this.loopShards = 0;
    this.combo = 0;
    this.loopOverloaded = false;
    this.overloadArmed = false;
    this.vaultTimer = 0;
    this.vaultTopY = 0.25;
    this.dashCooldownTimer = 0;
    this.dashBurstTimer = 0;
    this.activeShardSamples = [];
    this.suppressedEchoIds.clear();
    for (const d of this.devourers) d.active = false;
    for (const s of this.shards) s.active = false;
    this.recorder.reset();
    this.resetPlayerToSpawn();
    this.applyWeaponTierVisuals();
    this.updatePlatformVisibility();
    this.populateDeterministicGeodes();
  }

  private resetPlayerToSpawn(): void {
    this.playerX = 0;
    this.playerZ = 9;
    this.playerY = groundHeightAt(0, 9);
    this.playerVy = 0;
    this.yaw = 0;
    this.pitch = -0.04;
    this.grounded = true;
  }

  private startLoop(): void {
    this.lastTime = performance.now();
    const tick = (now?: number) => {
      if (this.disposed) return;
      const t = typeof now === 'number' ? now : performance.now();
      const rawDt = Math.min(0.05, Math.max(0.001, (t - this.lastTime) / 1000));
      this.lastTime = t;

      if (this.settings.fps30 && !this.isSoftwareGl) {
        this.accumulator += rawDt;
        if (this.accumulator < 1 / 31) {
          this.frameId = requestAnimationFrame(tick);
          return;
        }
        const stepDt = Math.min(0.05, this.accumulator);
        this.accumulator = 0;
        this.update(stepDt);
      } else {
        this.update(rawDt);
      }

      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(() => tick(performance.now()));
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(() => tick(performance.now()), 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.ALREADY_SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  }

  private update(dt: number): void {
    this.simTime += dt;

    // Terminal holographic animation
    this.terminalHoloRing.rotation.y += dt * 1.4;
    this.terminalHoloRing.rotation.x = Math.sin(this.simTime * 1.7) * 0.25;
    this.terminalScreenMat.emissiveIntensity = 1.0 + Math.sin(this.simTime * 3) * 0.2;

    if (this.mode === 'title') {
      // Live world camera tour orbit
      const angle = this.simTime * 0.16;
      const radius = 17.5;
      this.camera.position.set(
        Math.cos(angle) * radius,
        6.2 + Math.sin(this.simTime * 0.35) * 0.8,
        Math.sin(angle) * radius,
      );
      this.camera.lookAt(0, 1.4, -2);
      this.updateGeodes(dt);
      this.updateEchoes(dt, false);
      this.syncAllInstancedMeshes();
      return;
    }

    if (this.mode === 'paused') {
      return;
    }

    // Playing mode!
    const snap = this.input.consumeSnapshot();
    if (snap.hasMoved || snap.hasAimed) {
      this.callbacks.onFirstMoveOrAim(snap.hasMoved, snap.hasAimed);
    }

    // Visual effects tick even during 40ms hitstop
    this.trauma = Math.max(0, this.trauma - dt * 2.8);
    this.recoilZ = THREE.MathUtils.damp(this.recoilZ, 0, 22, dt);
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 20, dt);
    this.fovKick = THREE.MathUtils.damp(this.fovKick, 0, 12, dt);

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleMesh.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.applyCameraAndWeaponTransform(dt, 0);
      return;
    }

    // Dash cooldown & active dash burst
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    if (this.dashBurstTimer > 0) {
      this.dashBurstTimer = Math.max(0, this.dashBurstTimer - dt);
    }

    // Player look
    this.yaw -= snap.lookDeltaX;
    this.pitch = THREE.MathUtils.clamp(this.pitch - snap.lookDeltaY, -1.25, 1.25);

    // Player movement relative to yaw
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const forwardX = -sinY;
    const forwardZ = -cosY;
    const rightX = cosY;
    const rightZ = -sinY;

    const wishX = forwardX * -snap.moveZ + rightX * snap.moveX;
    const wishZ = forwardZ * -snap.moveZ + rightZ * snap.moveX;

    // Trigger Phase Dash if unlocked & ready
    if (snap.dashPressed && this.stats.dashUnlocked && this.dashCooldownTimer <= 0) {
      const mag = Math.hypot(wishX, wishZ);
      if (mag > 0.08) {
        this.dashDirX = wishX / mag;
        this.dashDirZ = wishZ / mag;
      } else {
        this.dashDirX = forwardX;
        this.dashDirZ = forwardZ;
      }
      this.dashBurstTimer = 0.18;
      this.dashCooldownTimer = this.stats.dashCooldown;
      this.fovKick = 7.5;
      this.sound.playDash(false);
      this.sound.vibrate(14);
      this.spawnRing(this.playerX, this.playerY + 0.25, this.playerZ, 2.2, 0.22, 0.91, 0.88);
    }

    const speed = this.stats.moveSpeed;
    if (this.dashBurstTimer > 0) {
      this.playerX += this.dashDirX * 24 * dt;
      this.playerZ += this.dashDirZ * 24 * dt;
    } else {
      this.playerX += wishX * speed * dt;
      this.playerZ += wishZ * speed * dt;
    }

    // Arena perimeter soft boundary
    const radial = Math.hypot(this.playerX, this.playerZ);
    const maxR = ARENA_RADIUS - 1.4;
    if (radial > maxR) {
      const k = maxR / radial;
      this.playerX *= k;
      this.playerZ *= k;
    }

    // Chrono-Vault elevation animation
    if (this.vaultTimer > 0) {
      this.vaultTimer = Math.max(0, this.vaultTimer - dt);
    }
    const targetVaultY = this.vaultTimer > 0 ? 2.15 : 0.25;
    this.vaultTopY = THREE.MathUtils.damp(this.vaultTopY, targetVaultY, 7.5, dt);
    this.vaultMesh.position.y = this.vaultTopY - 1.2;
    for (const sw of this.chronoSwitches) {
      sw.flash = Math.max(0, sw.flash - dt * 3.5);
      const isActive = this.vaultTimer > 0;
      sw.crystalMat.color.setHex(isActive ? PALETTE.shardGold : PALETTE.echoCyan);
      sw.crystalMat.emissive.setHex(isActive ? PALETTE.shardGold : PALETTE.echoCyan);
      sw.crystalMat.emissiveIntensity = isActive ? 1.8 + sw.flash : 0.85 + sw.flash;
    }

    // Compute floor height (terrain + unlocked platforms + Chrono-Vault)
    let floorY = groundHeightAt(this.playerX, this.playerZ);
    if (
      Math.abs(this.playerX) <= 3.9 &&
      Math.abs(this.playerZ - -13.5) <= 3.0 &&
      this.playerY >= this.vaultTopY - 0.9
    ) {
      floorY = Math.max(floorY, this.vaultTopY);
    }
    for (const p of this.platforms) {
      if (this.stats.platformsLevel < p.minLevel) continue;
      if (
        Math.abs(this.playerX - p.x) <= p.halfW + 0.35 &&
        Math.abs(this.playerZ - p.z) <= p.halfD + 0.35 &&
        this.playerY >= p.topY - 0.85
      ) {
        floorY = Math.max(floorY, p.topY);
      }
    }

    // Jump pads check
    for (const pad of this.jumpPads) {
      if (this.stats.platformsLevel < pad.minLevel) continue;
      const dist = Math.hypot(this.playerX - pad.x, this.playerZ - pad.z);
      if (dist <= pad.radius && Math.abs(this.playerY - groundHeightAt(pad.x, pad.z)) < 0.7) {
        this.playerVy = pad.boostY;
        this.grounded = false;
        this.fovKick = 5.5;
        this.sound.playJump(true);
        this.sound.vibrate(18);
      }
    }

    // Jump & gravity with coyote time
    if (this.grounded) this.coyoteTimer = 0.1;
    else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

    if (snap.jumpPressed && this.coyoteTimer > 0) {
      this.playerVy = 8.4;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.sound.playJump(false);
    }

    this.playerVy -= 21 * dt;
    this.playerY += this.playerVy * dt;

    if (this.playerY <= floorY) {
      this.playerY = floorY;
      this.playerVy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Terminal interaction proximity
    const distTerm = Math.hypot(
      this.playerX - this.terminalPos.x,
      this.playerZ - this.terminalPos.z,
    );
    const nearTerminal = distTerm < 5.2;
    if (nearTerminal && snap.interactPressed) {
      this.callbacks.onOpenTerminal();
      return;
    }

    // Advance loop timer & record 20Hz pose
    this.loopTime += dt;
    this.recorder.recordFrame(
      this.loopTime,
      this.playerX,
      this.playerY + this.eyeHeight,
      this.playerZ,
      this.yaw,
      this.pitch,
    );

    // Aim assist & auto-fire check (Geodes, Devourers, or Chrono-Switches)
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const moveMag = Math.hypot(wishX, wishZ);
    if (this.grounded && moveMag > 0.05) {
      this.walkBobDist += moveMag * speed * dt;
    }

    this.applyCameraAndWeaponTransform(dt, moveMag);

    const aimPoint = this.findAimAssistTarget(snap.isTouchActive ? 0.996 : 0.9982);
    const aimingAtGeode = aimPoint !== null;

    if ((aimingAtGeode || snap.fireHeld) && this.fireCooldown <= 0) {
      this.firePlayerShot(aimPoint);
      this.fireCooldown = 1 / this.stats.fireRate;
    }

    // Combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Prune rolling 8s active shard window
    const cutoff = this.simTime - 8;
    while (this.activeShardSamples.length > 0 && this.activeShardSamples[0].t < cutoff) {
      this.activeShardSamples.shift();
    }

    // Update entities
    this.updateGeodes(dt);
    this.updateDevourers(dt);
    this.updateEchoes(dt, true);
    this.updateShards(dt);
    this.updateBeamsAndParticles(dt);

    // Check loop completion
    const effectiveLoopDur = this.loopOverloaded
      ? this.stats.loopDuration * 0.75
      : this.stats.loopDuration;
    if (this.loopTime >= effectiveLoopDur) {
      this.completeCurrentLoop(effectiveLoopDur);
    }

    this.syncAllInstancedMeshes();

    // Throttled HUD update (<= 12Hz)
    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.08) {
      this.hudEmitTimer = 0;
      this.emitHudSnapshot(aimingAtGeode, nearTerminal, effectiveLoopDur);
    }
  }

  private applyCameraAndWeaponTransform(dt: number, moveMag: number): void {
    const shake = this.trauma * this.trauma;
    const shakeYaw = (Math.random() - 0.5) * 0.035 * shake;
    const shakePitch = (Math.random() - 0.5) * 0.035 * shake;

    const bobY = this.grounded && moveMag > 0.05 ? Math.sin(this.walkBobDist * 2.1) * 0.045 : 0;
    this.camera.position.set(this.playerX, this.playerY + this.eyeHeight + bobY, this.playerZ);
    this.camera.rotation.set(this.pitch + this.recoilPitch + shakePitch, this.yaw + shakeYaw, 0, 'YXZ');

    const targetFov = 72 + this.fovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
      this.camera.updateProjectionMatrix();
    }

    // Weapon sway + recoil
    const swayX = Math.cos(this.walkBobDist * 1.05) * 0.012 * (this.grounded ? moveMag : 0);
    const swayY = Math.abs(Math.sin(this.walkBobDist * 1.05)) * 0.014 * (this.grounded ? moveMag : 0);
    this.weaponGroup.position.set(0.28 + swayX, -0.24 - swayY, -0.48 + this.recoilZ);
    this.weaponGroup.rotation.x = this.recoilPitch * 1.8;
    this.weaponCoreMesh.rotation.y += dt * (2.2 + this.stats.weaponTier * 1.1);
    this.weaponRing.rotation.z -= dt * 2.4;
  }

  private findAimAssistTarget(minDot: number): { x: number; y: number; z: number } | null {
    this.camera.getWorldDirection(_v1); // forward
    const camPos = this.camera.position;

    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = -1;

    for (let i = 0; i < this.geodes.length; i++) {
      const g = this.geodes[i];
      if (!g.active) continue;
      if (g.vaultBound && this.vaultTopY < 1.3) continue;
      _v2.set(g.x - camPos.x, g.y + 0.55 - camPos.y, g.z - camPos.z);
      const dist = _v2.length();
      if (dist > 42 || dist < 0.8) continue;
      _v2.divideScalar(dist);
      const dot = _v1.dot(_v2);
      const radiusCone = Math.min(0.065, (g.radius * 0.88) / dist);
      const threshold = Math.min(minDot, 1 - radiusCone * 0.65);
      if (dot >= threshold && dot > bestScore) {
        bestScore = dot;
        best = { x: g.x, y: g.y + 0.52, z: g.z };
      }
    }

    for (const d of this.devourers) {
      if (!d.active) continue;
      _v2.set(d.x - camPos.x, d.y - camPos.y, d.z - camPos.z);
      const dist = _v2.length();
      if (dist > 42 || dist < 0.8) continue;
      _v2.divideScalar(dist);
      const dot = _v1.dot(_v2);
      const radiusCone = Math.min(0.075, 1.05 / dist);
      const threshold = Math.min(minDot, 1 - radiusCone * 0.65);
      if (dot >= threshold && dot > bestScore) {
        bestScore = dot;
        best = { x: d.x, y: d.y, z: d.z };
      }
    }

    for (const sw of this.chronoSwitches) {
      _v2.set(sw.x - camPos.x, sw.y - camPos.y, sw.z - camPos.z);
      const dist = _v2.length();
      if (dist > 40 || dist < 0.8) continue;
      _v2.divideScalar(dist);
      const dot = _v1.dot(_v2);
      const radiusCone = Math.min(0.06, 0.8 / dist);
      const threshold = Math.min(minDot, 1 - radiusCone * 0.65);
      if (dot >= threshold && dot > bestScore) {
        bestScore = dot;
        best = { x: sw.x, y: sw.y, z: sw.z };
      }
    }

    return best;
  }

  private firePlayerShot(assistTarget: { x: number; y: number; z: number } | null): void {
    this.camera.getWorldDirection(_v1);
    const camPos = this.camera.position;

    if (assistTarget) {
      _v2.set(
        assistTarget.x - camPos.x,
        assistTarget.y - camPos.y,
        assistTarget.z - camPos.z,
      ).normalize();
      _v1.lerp(_v2, 0.45).normalize();
    }

    // Muzzle origin in world space
    this.muzzleMesh.getWorldPosition(_v3);

    // Record shot for future echo replay
    this.recorder.recordShot(this.loopTime, _v3.x, _v3.y, _v3.z, _v1.x, _v1.y, _v1.z);

    // Recoil + flash + audio
    this.recoilZ = 0.075;
    this.recoilPitch = 0.022;
    this.trauma = Math.min(0.42, this.trauma + 0.14);
    this.muzzleFlashTimer = 0.048;
    this.muzzleMesh.visible = true;
    this.muzzleMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 2.4;
    this.sound.playShot(this.stats.weaponTier);

    // Echo Shot Relay check: does shot ray pass through any active Echo?
    let relayed = false;
    const eCount = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
    for (let i = 0; i < eCount; i++) {
      sampleEchoPose(this.echoes[i], this.loopTime, this.poseScratch);
      const ex = this.poseScratch.x - camPos.x;
      const ey = this.poseScratch.y - 0.35 - camPos.y;
      const ez = this.poseScratch.z - camPos.z;
      const proj = ex * _v1.x + ey * _v1.y + ez * _v1.z;
      if (proj < 0.7 || proj > 34) continue;
      const px = camPos.x + _v1.x * proj;
      const py = camPos.y + _v1.y * proj;
      const pz = camPos.z + _v1.z * proj;
      const dSq =
        (px - this.poseScratch.x) ** 2 +
        (py - (this.poseScratch.y - 0.35)) ** 2 +
        (pz - this.poseScratch.z) ** 2;
      if (dSq <= 1.45 * 1.45) {
        relayed = true;
        this.spawnRing(this.poseScratch.x, this.poseScratch.y - 0.2, this.poseScratch.z, 1.8, 1.0, 0.85, 0.36);
        this.emitWorldPopup(
          this.poseScratch.x,
          this.poseScratch.y + 0.65,
          this.poseScratch.z,
          `RELAIS ×${this.stats.relayMultiplier.toFixed(1)}`,
          'crit',
        );
        break;
      }
    }

    const shotDamage = this.stats.damage * (relayed ? this.stats.relayMultiplier : 1);
    const effectivePierce = this.stats.pierceCount + (relayed ? 1 : 0);
    const effectiveRicochet = this.stats.ricochetCount + (relayed ? 1 : 0);
    if (relayed) {
      this.sound.playRelayShot();
      this.callbacks.onRelayShot?.();
    }

    // Check Chrono-Switch hit
    for (const sw of this.chronoSwitches) {
      const cx = sw.x - camPos.x;
      const cy = sw.y - camPos.y;
      const cz = sw.z - camPos.z;
      const proj = cx * _v1.x + cy * _v1.y + cz * _v1.z;
      if (proj < 0.4 || proj > 44) continue;
      const px = camPos.x + _v1.x * proj;
      const py = camPos.y + _v1.y * proj;
      const pz = camPos.z + _v1.z * proj;
      const dSq = (px - sw.x) ** 2 + (py - sw.y) ** 2 + (pz - sw.z) ** 2;
      if (dSq <= 1.05 * 1.05) {
        this.vaultTimer = 8.5;
        sw.flash = 1;
        this.spawnBeam(_v3.x, _v3.y, _v3.z, sw.x, sw.y, sw.z, false, true);
        this.spawnRing(sw.x, sw.y, sw.z, 2.2, 1, 0.82, 0.35);
        this.emitWorldPopup(sw.x, sw.y + 0.7, sw.z, 'SANCTUAIRE OUVERT', 'crit');
        this.sound.playSwitchToggle(true);
        this.callbacks.onHitMarker(true);
        this.callbacks.onSwitchActivated?.(false);
        return;
      }
    }

    // Check Temporal Devourer hit
    for (const d of this.devourers) {
      if (!d.active) continue;
      const cx = d.x - camPos.x;
      const cy = d.y - camPos.y;
      const cz = d.z - camPos.z;
      const proj = cx * _v1.x + cy * _v1.y + cz * _v1.z;
      if (proj < 0.4 || proj > 44) continue;
      const px = camPos.x + _v1.x * proj;
      const py = camPos.y + _v1.y * proj;
      const pz = camPos.z + _v1.z * proj;
      const dSq = (px - d.x) ** 2 + (py - d.y) ** 2 + (pz - d.z) ** 2;
      if (dSq <= 1.25 * 1.25) {
        d.hp -= shotDamage;
        d.hitFlash = 1;
        this.spawnBeam(_v3.x, _v3.y, _v3.z, px, py, pz, false, relayed);
        this.callbacks.onHitMarker(d.hp <= 0);
        this.emitWorldPopup(d.x, d.y + 0.8, d.z, formatShards(shotDamage), d.hp <= 0 ? 'crit' : 'damage');
        if (d.hp <= 0) {
          d.active = false;
          d.latched = false;
          const bounty =
            22 *
            this.stats.shardMult *
            (this.loopOverloaded ? this.stats.overloadMultiplier : 1);
          for (let s = 0; s < 5; s++) {
            this.spawnShard(d.x, d.y, d.z, bounty / 5);
          }
          this.spawnParticles(d.x, d.y, d.z, 16, 0.9, 0.28, 0.65);
          this.spawnRing(d.x, d.y, d.z, 3.2, 0.9, 0.28, 0.65);
          this.sound.playDevourerSlain();
          this.callbacks.onDevourerSlain?.();
        } else {
          this.sound.playHit(1);
        }
        return;
      }
    }

    // Ray-sphere intersection against active geodes (sorted by distance for pierce!)
    const hits: Array<{ geode: GeodeEntity; dist: number; hx: number; hy: number; hz: number }> = [];
    for (let i = 0; i < this.geodes.length; i++) {
      const g = this.geodes[i];
      if (!g.active) continue;
      if (g.vaultBound && this.vaultTopY < 1.3) continue;
      const cx = g.x - camPos.x;
      const cy = g.y + 0.52 - camPos.y;
      const cz = g.z - camPos.z;
      const proj = cx * _v1.x + cy * _v1.y + cz * _v1.z;
      if (proj < 0.4 || proj > 46) continue;
      const px = camPos.x + _v1.x * proj;
      const py = camPos.y + _v1.y * proj;
      const pz = camPos.z + _v1.z * proj;
      const dSq = (px - g.x) ** 2 + (py - (g.y + 0.52)) ** 2 + (pz - g.z) ** 2;
      if (dSq <= (g.radius * 1.1) ** 2) {
        hits.push({ geode: g, dist: proj, hx: px, hy: py, hz: pz });
      }
    }

    hits.sort((a, b) => a.dist - b.dist);
    const hitSlice = hits.slice(0, effectivePierce);

    if (hitSlice.length === 0) {
      this.spawnBeam(
        _v3.x,
        _v3.y,
        _v3.z,
        camPos.x + _v1.x * 36,
        camPos.y + _v1.y * 36,
        camPos.z + _v1.z * 36,
        false,
        relayed || this.stats.weaponTier >= 4,
      );
      return;
    }

    let prevX = _v3.x;
    let prevY = _v3.y;
    let prevZ = _v3.z;
    const hitSet = new Set<GeodeEntity>();

    for (const h of hitSlice) {
      hitSet.add(h.geode);
      this.spawnBeam(prevX, prevY, prevZ, h.hx, h.hy, h.hz, false, relayed || this.stats.weaponTier >= 4);
      prevX = h.hx;
      prevY = h.hy;
      prevZ = h.hz;
      this.damageGeode(h.geode, shotDamage, h.hx, h.hy, h.hz, false, 'player');
    }

    // Ricochet to nearby geodes
    if (effectiveRicochet > 0 && hitSlice.length > 0) {
      let curX = prevX;
      let curY = prevY;
      let curZ = prevZ;
      for (let b = 0; b < effectiveRicochet; b++) {
        let nearest: GeodeEntity | null = null;
        let minD = 12.5;
        for (let i = 0; i < this.geodes.length; i++) {
          const g = this.geodes[i];
          if (!g.active || hitSet.has(g)) continue;
          if (g.vaultBound && this.vaultTopY < 1.3) continue;
          const d = Math.hypot(g.x - curX, g.z - curZ);
          if (d < minD) {
            minD = d;
            nearest = g;
          }
        }
        if (!nearest) break;
        hitSet.add(nearest);
        const nx = nearest.x;
        const ny = nearest.y + 0.52;
        const nz = nearest.z;
        this.spawnBeam(curX, curY, curZ, nx, ny, nz, false, true);
        this.damageGeode(nearest, shotDamage * 0.78, nx, ny, nz, true, 'player');
        curX = nx;
        curY = ny;
        curZ = nz;
      }
    }
  }

  private shatterGeodeEntity(g: GeodeEntity, multOverride = 1, isTwinBonus = false): void {
    g.active = false;
    g.respawnTimer = 2.6;
    g.resonanceTimer = 0;
    g.lastShooterTag = '';
    this.hitstopTimer = 0.04;
    this.trauma = Math.min(0.85, this.trauma + (g.type === 'explosive' ? 0.45 : 0.24));
    if (isTwinBonus) {
      this.sound.playTwinSync();
    } else {
      this.sound.playShatter(g.type === 'golden', g.type === 'explosive');
    }
    this.sound.vibrate(g.type === 'explosive' ? [22, 18, 30] : 16);

    const shardCount = g.type === 'golden' ? 10 : g.type === 'armored' ? 8 : isTwinBonus ? 7 : 5;
    const overloadMult = this.loopOverloaded ? this.stats.overloadMultiplier : 1;
    const totalVal = g.shardValue * multOverride * this.stats.shardMult * overloadMult;
    const perShard = Math.max(1, totalVal / shardCount);
    for (let s = 0; s < shardCount; s++) {
      this.spawnShard(g.x, g.y + 0.55, g.z, perShard);
    }

    this.spawnParticles(
      g.x,
      g.y + 0.5,
      g.z,
      16,
      g.type === 'golden' ? 1 : isTwinBonus ? 1 : 0.95,
      g.type === 'golden' ? 0.82 : isTwinBonus ? 0.4 : 0.45,
      isTwinBonus ? 0.75 : 0.3,
    );
    this.spawnRing(
      g.x,
      g.y + 0.12,
      g.z,
      g.type === 'explosive' ? 5.6 : isTwinBonus ? 3.8 : 2.6,
      g.type === 'golden' ? 1 : isTwinBonus ? 1 : 0.95,
      g.type === 'golden' ? 0.82 : isTwinBonus ? 0.4 : 0.55,
      isTwinBonus ? 0.78 : 0.3,
    );

    // Invented Convergence Mechanic: breaking a geode within 4.2m of an Echo resets Dash cooldown!
    if (this.stats.dashUnlocked && this.dashCooldownTimer > 0) {
      const eCount = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
      for (let i = 0; i < eCount; i++) {
        sampleEchoPose(this.echoes[i], this.loopTime, this.poseScratch);
        const dist = Math.hypot(this.playerX - this.poseScratch.x, this.playerZ - this.poseScratch.z);
        if (dist <= 4.2) {
          this.dashCooldownTimer = 0;
          this.sound.playDash(true);
          this.spawnRing(this.playerX, this.playerY + 0.25, this.playerZ, 2.8, 0.22, 0.91, 0.88);
          this.emitWorldPopup(this.playerX, this.playerY + 1.9, this.playerZ, 'CONVERGENCE !', 'crit');
          break;
        }
      }
    }

    this.callbacks.onGeodeBroken(g.type, true);
  }

  private damageGeode(
    g: GeodeEntity,
    dmg: number,
    hx: number,
    hy: number,
    hz: number,
    isChain = false,
    shooterTag = 'player',
  ): void {
    if (!g.active) return;

    // Twin Geodes require 2 distinct shooters within 0.95s!
    if (g.type === 'twin') {
      g.hitFlash = 1;
      const partner = this.geodes.find(
        (other) => other !== g && other.active && other.type === 'twin' && other.pairId === g.pairId,
      );
      const syncedOnSelf = g.resonanceTimer > 0 && g.lastShooterTag !== '' && g.lastShooterTag !== shooterTag;
      const syncedOnPartner =
        partner !== undefined &&
        partner.resonanceTimer > 0 &&
        partner.lastShooterTag !== '' &&
        partner.lastShooterTag !== shooterTag;

      if (syncedOnSelf || syncedOnPartner) {
        this.callbacks.onHitMarker(true);
        this.emitWorldPopup(
          hx,
          hy + 0.55,
          hz,
          `SYNCHRO ×${this.stats.twinMult.toFixed(1)}`,
          'crit',
        );
        this.shatterGeodeEntity(g, this.stats.twinMult, true);
        if (partner && partner.active) {
          this.shatterGeodeEntity(partner, this.stats.twinMult, true);
        }
        this.callbacks.onTwinSynced?.();
        return;
      }

      // Prime this twin geode waiting for a partner/echo shot
      g.resonanceTimer = 0.95;
      g.lastShooterTag = shooterTag;
      g.hp = Math.max(1, g.hp - dmg * 0.4);
      g.crackStage = 1;
      if (shooterTag === 'player') {
        this.callbacks.onHitMarker(false);
        this.emitWorldPopup(hx, hy + 0.35, hz, 'Synchro...', 'damage');
        this.sound.playHit(1);
      }
      this.spawnRing(g.x, g.y + 0.25, g.z, 1.9, 1.0, 0.37, 0.7);
      return;
    }

    g.hp -= dmg;
    g.hitFlash = 1;

    // 3 fracture stages: intact (0) -> cracked (1) -> critical (2)
    const ratio = g.hp / g.maxHp;
    const newStage = ratio <= 0.34 ? 2 : ratio <= 0.67 ? 1 : 0;
    const stageChanged = newStage > g.crackStage;
    g.crackStage = newStage;

    this.callbacks.onHitMarker(g.hp <= 0 || g.type === 'golden');
    this.emitWorldPopup(hx, hy + 0.35, hz, formatShards(dmg), g.hp <= 0 ? 'crit' : 'damage');

    // Mineral impact sparks
    this.spawnParticles(
      hx,
      hy,
      hz,
      stageChanged ? 8 : 4,
      g.type === 'golden' ? 1 : 0.92,
      g.type === 'golden' ? 0.85 : 0.48,
      0.32,
    );

    // Weapon blast AoE on direct hit
    if (!isChain && this.stats.blastRadius > 0) {
      this.spawnRing(hx, hy, hz, this.stats.blastRadius, 1.0, 0.72, 0.32);
      for (const other of this.geodes) {
        if (!other.active || other === g || other.type === 'twin') continue;
        const d = Math.hypot(other.x - g.x, other.y - g.y, other.z - g.z);
        if (d <= this.stats.blastRadius) {
          this.damageGeode(other, dmg * 0.55, other.x, other.y + 0.5, other.z, true, shooterTag);
        }
      }
    }

    if (g.hp > 0) {
      this.sound.playHit(g.crackStage);
      return;
    }

    this.shatterGeodeEntity(g, 1, false);

    // Explosive geode chain detonation!
    if (g.type === 'explosive' && !isChain) {
      for (const other of this.geodes) {
        if (!other.active || other === g || other.type === 'twin') continue;
        const d = Math.hypot(other.x - g.x, other.z - g.z);
        if (d <= 6.2) {
          this.damageGeode(other, other.maxHp * 1.2, other.x, other.y + 0.5, other.z, true, shooterTag);
        }
      }
    }
  }

  private completeCurrentLoop(durationUsed: number): void {
    const id = `echo_${Date.now()}_${Math.floor(Math.random() * 999)}`;
    const record = this.recorder.finalize(id, durationUsed, this.loopShards);
    record.overloaded = this.loopOverloaded;

    // Spectacular loop end flash + rewind synth + shockwave
    this.sound.playLoopRewind();
    this.sound.vibrate([25, 30, 40]);
    this.fovKick = 9;
    this.trauma = 0.5;
    this.callbacks.onLoopFlash();
    this.callbacks.onLoopCompleted(record);

    // Reset loop
    this.loopTime = 0;
    this.prevEchoLoopTime = 0;
    this.loopShards = 0;
    this.loopOverloaded = this.overloadArmed && this.stats.overloadUnlocked;
    this.recorder.reset();
    this.resetPlayerToSpawn();
    this.recorder.recordFrame(0, this.playerX, this.playerY + this.eyeHeight, this.playerZ, this.yaw, this.pitch, true);
    this.populateDeterministicGeodes();
    this.spawnRing(this.playerX, this.playerY + 0.2, this.playerZ, 4.5, 0.22, 0.91, 0.88);
  }

  private updateGeodes(dt: number): void {
    for (let i = 0; i < this.geodes.length; i++) {
      const g = this.geodes[i];
      if (!g.active) {
        if (g.respawnTimer > 0) {
          g.respawnTimer -= dt;
          if (g.respawnTimer <= 0) {
            g.active = true;
            g.hp = g.maxHp;
            g.crackStage = 0;
            g.hitFlash = 0.6;
            g.resonanceTimer = 0;
            g.lastShooterTag = '';
          }
        }
        continue;
      }
      g.hitFlash = Math.max(0, g.hitFlash - dt * 5.5);
      if (g.resonanceTimer > 0) {
        g.resonanceTimer = Math.max(0, g.resonanceTimer - dt);
        if (g.resonanceTimer === 0) g.lastShooterTag = '';
      }
      g.phase += dt * g.rotSpeed;
      if (g.vaultBound) {
        g.baseY = this.vaultTopY;
      }
      if (g.orbitAmp > 0) {
        g.x = g.baseX + Math.sin(this.simTime * g.orbitFreq + g.phase) * g.orbitAmp;
        g.y = g.baseY + Math.cos(this.simTime * g.orbitFreq * 1.4 + g.phase) * 0.42;
      } else {
        g.x = g.baseX;
        g.y = g.baseY;
      }
      g.z = g.baseZ;
    }

    for (const eg of this.echoGeodes) {
      if (eg.active) {
        eg.flash = Math.max(0, eg.flash - dt * 4.5);
      }
    }
  }

  private updateDevourers(dt: number): void {
    this.suppressedEchoIds.clear();
    const eCount = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
    if (eCount === 0) {
      for (const d of this.devourers) d.active = false;
      this.syncSuppressedNotification();
      return;
    }

    // Spawn timer
    this.devourerSpawnTimer -= dt;
    const maxConcurrent = this.loopOverloaded ? 4 : 2;
    let activeCount = 0;
    for (const d of this.devourers) if (d.active) activeCount++;

    if (this.devourerSpawnTimer <= 0) {
      this.devourerSpawnTimer = this.loopOverloaded ? 7.5 : 16.0;
      if (activeCount < maxConcurrent) {
        const slot = this.devourers.find((d) => !d.active);
        if (slot) {
          const targetEcho = this.echoes[Math.floor(Math.random() * eCount)];
          const angle = Math.random() * Math.PI * 2;
          slot.active = true;
          slot.x = Math.cos(angle) * (ARENA_RADIUS - 3);
          slot.y = 2.6;
          slot.z = Math.sin(angle) * (ARENA_RADIUS - 3);
          slot.maxHp = 26 + this.stats.weaponTier * 14;
          slot.hp = slot.maxHp;
          slot.targetEchoId = targetEcho.id;
          slot.latched = false;
          slot.hitFlash = 0;
          slot.phase = Math.random() * Math.PI * 2;
        }
      }
    }

    for (const d of this.devourers) {
      if (!d.active) continue;
      d.hitFlash = Math.max(0, d.hitFlash - dt * 5);
      d.phase += dt * 3.5;

      const targetEcho = this.echoes.find((e) => e.id === d.targetEchoId) ?? this.echoes[0];
      if (!targetEcho) {
        d.active = false;
        continue;
      }
      d.targetEchoId = targetEcho.id;
      sampleEchoPose(targetEcho, this.loopTime, this.poseScratch);

      const tx = this.poseScratch.x;
      const ty = this.poseScratch.y + 0.15;
      const tz = this.poseScratch.z;
      const dx = tx - d.x;
      const dy = ty - d.y;
      const dz = tz - d.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist <= 1.35) {
        if (!d.latched) {
          d.latched = true;
          this.sound.playDevourerAlert();
        }
        d.x = tx + Math.cos(d.phase) * 0.55;
        d.y = ty + Math.sin(d.phase * 1.3) * 0.2;
        d.z = tz + Math.sin(d.phase) * 0.55;
        this.suppressedEchoIds.add(targetEcho.id);
      } else {
        d.latched = false;
        const inv = 1 / Math.max(0.01, dist);
        const speed = this.loopOverloaded ? 4.4 : 3.4;
        d.x += dx * inv * speed * dt;
        d.y += dy * inv * speed * dt;
        d.z += dz * inv * speed * dt;
      }
    }

    this.syncSuppressedNotification();
  }

  private syncSuppressedNotification(): void {
    const ids = Array.from(this.suppressedEchoIds).sort();
    const sig = ids.join(',');
    if (sig !== this.prevSuppressedSig) {
      this.prevSuppressedSig = sig;
      this.callbacks.onSuppressedChange?.(ids);
    }
  }

  private updateEchoes(dt: number, emitIncome: boolean): void {
    const count = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
    const currT = emitIncome ? this.loopTime : this.simTime;
    const prevT = emitIncome ? this.prevEchoLoopTime : Math.max(0, this.simTime - dt);

    let passiveRateSum = 0;

    for (let i = 0; i < count; i++) {
      const echo = this.echoes[i];
      if (emitIncome) {
        passiveRateSum += getEchoEffectiveRate(
          echo,
          this.stats,
          this.suppressedEchoIds.has(echo.id),
        );
      }

      const shots = collectEchoShotsInWindow(echo, prevT, currT);
      const shooterTag = `echo_${i}`;
      for (const s of shots) {
        let targetX = s.ox + s.dx * 18;
        let targetY = s.oy + s.dy * 18;
        let targetZ = s.oz + s.dz * 18;
        let bestDist = 28;
        let hitEg: EchoGeodeEntity | null = null;

        // Echoes can trigger Chrono-Switches & Twin Geodes along their recorded shot path!
        if (emitIncome) {
          for (const sw of this.chronoSwitches) {
            const cx = sw.x - s.ox;
            const cy = sw.y - s.oy;
            const cz = sw.z - s.oz;
            const proj = cx * s.dx + cy * s.dy + cz * s.dz;
            if (proj > 0.5 && proj < 42) {
              const dSq =
                (s.ox + s.dx * proj - sw.x) ** 2 +
                (s.oy + s.dy * proj - sw.y) ** 2 +
                (s.oz + s.dz * proj - sw.z) ** 2;
              if (dSq <= 1.25 * 1.25) {
                this.vaultTimer = 8.5;
                sw.flash = 1;
                targetX = sw.x;
                targetY = sw.y;
                targetZ = sw.z;
                bestDist = proj;
                this.callbacks.onSwitchActivated?.(true);
              }
            }
          }

          for (const g of this.geodes) {
            if (!g.active || g.type !== 'twin') continue;
            const cx = g.x - s.ox;
            const cy = g.y + 0.52 - s.oy;
            const cz = g.z - s.oz;
            const proj = cx * s.dx + cy * s.dy + cz * s.dz;
            if (proj > 0.5 && proj < 42) {
              const dSq =
                (s.ox + s.dx * proj - g.x) ** 2 +
                (s.oy + s.dy * proj - (g.y + 0.52)) ** 2 +
                (s.oz + s.dz * proj - g.z) ** 2;
              if (dSq <= (g.radius * 1.2) ** 2) {
                targetX = g.x;
                targetY = g.y + 0.52;
                targetZ = g.z;
                bestDist = proj;
                this.damageGeode(g, this.stats.damage * 0.5, targetX, targetY, targetZ, true, shooterTag);
                break;
              }
            }
          }
        }

        for (const eg of this.echoGeodes) {
          if (!eg.active) continue;
          const cx = eg.x - s.ox;
          const cy = eg.y + 0.4 - s.oy;
          const cz = eg.z - s.oz;
          const proj = cx * s.dx + cy * s.dy + cz * s.dz;
          if (proj > 0.5 && proj < bestDist) {
            const dSq =
              (s.ox + s.dx * proj - eg.x) ** 2 +
              (s.oy + s.dy * proj - (eg.y + 0.4)) ** 2 +
              (s.oz + s.dz * proj - eg.z) ** 2;
            if (dSq < 1.9) {
              bestDist = proj;
              targetX = eg.x;
              targetY = eg.y + 0.4;
              targetZ = eg.z;
              hitEg = eg;
            }
          }
        }
        if (hitEg) hitEg.flash = 1;
        this.spawnBeam(s.ox, s.oy - 0.14, s.oz, targetX, targetY, targetZ, true, false);
      }
    }

    if (emitIncome && passiveRateSum > 0) {
      this.callbacks.onShardsCollected(passiveRateSum * dt, true);
    }

    if (emitIncome) {
      this.prevEchoLoopTime = this.loopTime;
    }
  }

  private updateShards(dt: number): void {
    const px = this.playerX;
    const py = this.playerY + 1.05;
    const pz = this.playerZ;
    const magR = this.stats.magnetRadius;
    const magSpeed = this.stats.magnetSpeed;

    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (!s.active) continue;
      s.age += dt;
      s.spin += dt * 7;

      const dx = px - s.x;
      const dy = py - s.y;
      const dz = pz - s.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist < magR || s.age > 0.55) {
        s.magnetized = true;
      }

      if (s.magnetized) {
        if (dist < 0.72) {
          s.active = false;
          this.combo += 1;
          this.comboTimer = 2.0;
          this.loopShards += s.value;
          this.activeShardSamples.push({ t: this.simTime, amount: s.value });
          this.callbacks.onShardsCollected(s.value, false);
          this.sound.playShardTick(this.combo);
          this.emitWorldPopup(s.x, s.y + 0.35, s.z, `+${formatShards(s.value)}`, 'shard');
          continue;
        }
        // Spiral inward trajectory!
        const inv = 1 / Math.max(0.01, dist);
        const nx = dx * inv;
        const ny = dy * inv;
        const nz = dz * inv;
        // Tangential swirl perpendicular to Y
        const swirlStrength = Math.min(0.65, dist * 0.14);
        const tx = -nz * swirlStrength;
        const tz = nx * swirlStrength;
        const speed = magSpeed * (1 + Math.max(0, 1 - dist / magR) * 0.75);
        s.x += (nx + tx) * speed * dt;
        s.y += ny * speed * dt;
        s.z += (nz + tz) * speed * dt;
      } else {
        // Bounce on desert sand
        s.vy -= 18 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        const gY = groundHeightAt(s.x, s.z) + 0.22;
        if (s.y < gY) {
          s.y = gY;
          s.vy = Math.abs(s.vy) * 0.45;
          s.vx *= 0.75;
          s.vz *= 0.75;
        }
      }
    }
  }

  private updateBeamsAndParticles(dt: number): void {
    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }

    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }

    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) r.active = false;
    }
  }

  private syncAllInstancedMeshes(): void {
    // 1. Geodes
    let gCount = 0;
    for (let i = 0; i < this.geodes.length; i++) {
      const g = this.geodes[i];
      if (!g.active) continue;
      const crackJitter = g.crackStage > 0 ? Math.sin(this.simTime * 30 + g.phase) * 0.02 * g.crackStage : 0;
      const hitScale = 1 + g.hitFlash * 0.14;
      _euler.set(crackJitter, g.phase, -crackJitter);
      _quat.setFromEuler(_euler);
      _scale.setScalar(g.scale * hitScale);
      _v1.set(g.x, g.y, g.z);
      _mat4.compose(_v1, _quat, _scale);
      this.geodeMesh.setMatrixAt(gCount, _mat4);

      if (g.type === 'golden') _color.setHex(PALETTE.geodeGolden);
      else if (g.type === 'twin') {
        _color.setHex(PALETTE.geodeTwin);
        if (g.resonanceTimer > 0) _color.lerp(new THREE.Color(0xffffff), 0.55);
      } else if (g.type === 'armored') _color.setHex(PALETTE.geodeArmored);
      else if (g.type === 'explosive') _color.setHex(PALETTE.geodeExplosive);
      else if (g.type === 'mobile') _color.setHex(PALETTE.geodeMobile);
      else _color.setHex(PALETTE.geodeBase);

      // 3 visual crack stages shift tint toward white-amber glow + hit flash
      if (g.crackStage === 1) _color.lerp(new THREE.Color(0xffb454), 0.35);
      else if (g.crackStage === 2) _color.lerp(new THREE.Color(0xfff1a8), 0.65);
      if (g.hitFlash > 0.05) _color.lerp(new THREE.Color(0xffffff), g.hitFlash * 0.75);
      this.geodeMesh.setColorAt(gCount, _color);
      gCount++;
    }
    this.geodeMesh.count = gCount;
    this.geodeMesh.instanceMatrix.needsUpdate = true;
    if (this.geodeMesh.instanceColor) this.geodeMesh.instanceColor.needsUpdate = true;

    // 2. Echo Geodes
    let egCount = 0;
    for (let i = 0; i < this.echoGeodes.length; i++) {
      const eg = this.echoGeodes[i];
      if (!eg.active) continue;
      _euler.set(0, eg.phase + this.simTime * 0.25, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(eg.scale * (1 + eg.flash * 0.2));
      _v1.set(eg.x, eg.y, eg.z);
      _mat4.compose(_v1, _quat, _scale);
      this.echoGeodeMesh.setMatrixAt(egCount, _mat4);
      _color.setHex(PALETTE.echoCyan).lerp(new THREE.Color(0xffffff), eg.flash * 0.7);
      this.echoGeodeMesh.setColorAt(egCount, _color);
      egCount++;
    }
    this.echoGeodeMesh.count = egCount;
    this.echoGeodeMesh.instanceMatrix.needsUpdate = true;
    if (this.echoGeodeMesh.instanceColor) this.echoGeodeMesh.instanceColor.needsUpdate = true;

    // 3. Echoes (up to 40)
    const eCount = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
    const loopT = this.mode === 'title' ? this.simTime : this.loopTime;
    for (let i = 0; i < eCount; i++) {
      const echo = this.echoes[i];
      sampleEchoPose(echo, loopT, this.poseScratch);
      _euler.set(0, this.poseScratch.yaw, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _v1.set(this.poseScratch.x, this.poseScratch.y - 0.72, this.poseScratch.z);
      _mat4.compose(_v1, _quat, _scale);
      this.echoBodyMesh.setMatrixAt(i, _mat4);

      const suppressed = this.suppressedEchoIds.has(echo.id);
      _color.setHex(suppressed ? 0xff4d9e : PALETTE.echoCyan);
      this.echoBodyMesh.setColorAt(i, _color);

      _euler.set(this.poseScratch.pitch, this.poseScratch.yaw, 0, 'YXZ');
      _quat.setFromEuler(_euler);
      _v2.set(0.24, -0.14, -0.35).applyQuaternion(_quat);
      _v1.set(
        this.poseScratch.x + _v2.x,
        this.poseScratch.y + _v2.y,
        this.poseScratch.z + _v2.z,
      );
      _mat4.compose(_v1, _quat, _scale);
      this.echoWeaponMesh.setMatrixAt(i, _mat4);
    }
    this.echoBodyMesh.count = eCount;
    this.echoWeaponMesh.count = eCount;
    this.echoBodyMesh.instanceMatrix.needsUpdate = true;
    if (this.echoBodyMesh.instanceColor) this.echoBodyMesh.instanceColor.needsUpdate = true;
    this.echoWeaponMesh.instanceMatrix.needsUpdate = true;

    // 4. Shards
    let sCount = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (!s.active) continue;
      _euler.set(s.spin, s.spin * 0.7, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(1);
      _v1.set(s.x, s.y, s.z);
      _mat4.compose(_v1, _quat, _scale);
      this.shardMesh.setMatrixAt(sCount, _mat4);
      sCount++;
    }
    this.shardMesh.count = sCount;
    this.shardMesh.instanceMatrix.needsUpdate = true;

    // 5. Beams
    let bCount = 0;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (!b.active) continue;
      _v1.set(b.sx, b.sy, b.sz);
      _v2.set(b.ex, b.ey, b.ez);
      const len = Math.max(0.05, _v1.distanceTo(_v2));
      _v3.copy(_v1).add(_v2).multiplyScalar(0.5);
      _v2.sub(_v1).divideScalar(len);
      _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v2);
      const fade = b.life / b.maxLife;
      const thick = (b.isEcho ? 0.65 : 1.1) * fade;
      _scale.set(thick, thick, len);
      _mat4.compose(_v3, _quat, _scale);
      this.beamMesh.setMatrixAt(bCount, _mat4);

      if (b.isEcho) _color.setHex(PALETTE.echoCyan);
      else if (b.isGolden) _color.setHex(PALETTE.shardGold);
      else _color.setHex(0xffb470);
      this.beamMesh.setColorAt(bCount, _color);
      bCount++;
    }
    this.beamMesh.count = bCount;
    this.beamMesh.instanceMatrix.needsUpdate = true;
    if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true;

    // 6. Particles
    let pCount = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const s = p.scale * (p.life / p.maxLife);
      _euler.set(p.life * 8, p.life * 6, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(Math.max(0.01, s));
      _v1.set(p.x, p.y, p.z);
      _mat4.compose(_v1, _quat, _scale);
      this.particleMesh.setMatrixAt(pCount, _mat4);
      _color.setRGB(p.r, p.g, p.b);
      this.particleMesh.setColorAt(pCount, _color);
      pCount++;
    }
    this.particleMesh.count = pCount;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    // 7. Shockwave rings
    let rCount = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      const prog = 1 - r.life / r.maxLife;
      const radius = 0.25 + prog * r.maxRadius;
      _quat.identity();
      _scale.set(radius, 1, radius);
      _v1.set(r.x, r.y, r.z);
      _mat4.compose(_v1, _quat, _scale);
      this.ringMesh.setMatrixAt(rCount, _mat4);
      _color.setRGB(r.r * (1 - prog), r.g * (1 - prog), r.b * (1 - prog));
      this.ringMesh.setColorAt(rCount, _color);
      rCount++;
    }
    this.ringMesh.count = rCount;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;

    // 8. Temporal Devourers
    let dCount = 0;
    for (let i = 0; i < this.devourers.length; i++) {
      const d = this.devourers[i];
      if (!d.active) continue;
      _euler.set(Math.sin(d.phase) * 0.25, d.phase, Math.cos(d.phase) * 0.25);
      _quat.setFromEuler(_euler);
      const pulse = 1 + (d.latched ? Math.sin(d.phase * 4) * 0.12 : 0) + d.hitFlash * 0.2;
      _scale.setScalar(pulse);
      _v1.set(d.x, d.y, d.z);
      _mat4.compose(_v1, _quat, _scale);
      this.devourerMesh.setMatrixAt(dCount, _mat4);
      _color.setHex(d.latched ? 0xff2b7a : PALETTE.devourerVoid);
      if (d.hitFlash > 0.05) _color.lerp(new THREE.Color(0xffffff), d.hitFlash * 0.8);
      this.devourerMesh.setColorAt(dCount, _color);
      dCount++;
    }
    this.devourerMesh.count = dCount;
    this.devourerMesh.instanceMatrix.needsUpdate = true;
    if (this.devourerMesh.instanceColor) this.devourerMesh.instanceColor.needsUpdate = true;

    // 9. Twin Geode Resonance Link Beams
    let lCount = 0;
    for (let pId = 0; pId < 2 && lCount < MAX_TWIN_LINKS; pId++) {
      const pair = this.geodes.filter((g) => g.active && g.type === 'twin' && g.pairId === pId);
      if (pair.length === 2) {
        _v1.set(pair[0].x, pair[0].y + 0.6, pair[0].z);
        _v2.set(pair[1].x, pair[1].y + 0.6, pair[1].z);
        const len = Math.max(0.1, _v1.distanceTo(_v2));
        _v3.copy(_v1).add(_v2).multiplyScalar(0.5);
        _v2.sub(_v1).divideScalar(len);
        _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v2);
        const primed = pair[0].resonanceTimer > 0 || pair[1].resonanceTimer > 0;
        const thick = primed ? 1.8 : 0.75 + Math.sin(this.simTime * 5 + pId) * 0.2;
        _scale.set(thick, thick, len);
        _mat4.compose(_v3, _quat, _scale);
        this.twinLinkMesh.setMatrixAt(lCount, _mat4);
        _color.setHex(primed ? 0xffffff : PALETTE.geodeTwin);
        this.twinLinkMesh.setColorAt(lCount, _color);
        lCount++;
      }
    }
    this.twinLinkMesh.count = lCount;
    this.twinLinkMesh.instanceMatrix.needsUpdate = true;
    if (this.twinLinkMesh.instanceColor) this.twinLinkMesh.instanceColor.needsUpdate = true;
  }

  private emitHudSnapshot(aimingAtGeode: boolean, nearTerminal: boolean, effectiveLoopDur: number): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const echoLabels: ProjectedEchoLabel[] = [];
    const eCount = Math.min(MAX_ECHO_INSTANCES, this.echoes.length);
    for (let i = 0; i < eCount; i++) {
      const echo = this.echoes[i];
      const suppressed = this.suppressedEchoIds.has(echo.id);
      sampleEchoPose(echo, this.loopTime, this.poseScratch);
      _v1.set(this.poseScratch.x, this.poseScratch.y + 0.72, this.poseScratch.z);
      _v1.project(this.camera);
      if (_v1.z >= -1 && _v1.z <= 1) {
        const sx = ((_v1.x + 1) * 0.5) * w;
        const sy = ((-_v1.y + 1) * 0.5) * h;
        if (sx >= 20 && sx <= w - 20 && sy >= 20 && sy <= h - 20) {
          echoLabels.push({
            id: echo.id,
            x: sx,
            y: sy,
            rateText: `+${formatShards(getEchoEffectiveRate(echo, this.stats, suppressed))}/s`,
            suppressed,
          });
        }
      }
    }

    let activeSampleSum = 0;
    for (const s of this.activeShardSamples) activeSampleSum += s.amount;
    const windowSpan = Math.max(2, Math.min(8, this.simTime));
    const activeRatePerSec = activeSampleSum / windowSpan;

    let activeDevourers = 0;
    for (const d of this.devourers) if (d.active) activeDevourers++;

    this.callbacks.onHudUpdate({
      loopTime: this.loopTime,
      loopDuration: effectiveLoopDur,
      loopShards: this.loopShards,
      combo: this.combo,
      aimingAtGeode,
      nearTerminal,
      echoLabels,
      dashUnlocked: this.stats.dashUnlocked,
      dashCooldownRemaining: this.dashCooldownTimer,
      dashCooldownMax: this.stats.dashCooldown,
      overloadActive: this.loopOverloaded,
      vaultOpen: this.vaultTimer > 0,
      vaultTimer: this.vaultTimer,
      suppressedCount: this.suppressedEchoIds.size,
      activeDevourers,
      activeRatePerSec,
    });
  }

  private emitWorldPopup(
    wx: number,
    wy: number,
    wz: number,
    text: string,
    kind: FloatingPopupEvent['kind'],
  ): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    _v1.set(wx, wy, wz).project(this.camera);
    if (_v1.z < -1 || _v1.z > 1) return;
    const sx = ((_v1.x + 1) * 0.5) * w;
    const sy = ((-_v1.y + 1) * 0.5) * h;
    if (sx < 16 || sx > w - 16 || sy < 16 || sy > h - 16) return;
    this.callbacks.onFloatingPopup({
      id: this.nextPopupId++,
      x: sx,
      y: sy,
      text,
      kind,
    });
  }

  private spawnShard(x: number, y: number, z: number, value: number): void {
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (s.active) continue;
      s.active = true;
      s.x = x;
      s.y = y;
      s.z = z;
      const a = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 4.0;
      s.vx = Math.cos(a) * spd;
      s.vy = 4.5 + Math.random() * 4.5;
      s.vz = Math.sin(a) * spd;
      s.value = value;
      s.age = 0;
      s.spin = Math.random() * Math.PI * 2;
      s.magnetized = false;
      return;
    }
  }

  private spawnBeam(
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
    isEcho: boolean,
    isGolden: boolean,
  ): void {
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (b.active) continue;
      b.active = true;
      b.sx = sx;
      b.sy = sy;
      b.sz = sz;
      b.ex = ex;
      b.ey = ey;
      b.ez = ez;
      b.maxLife = isEcho ? 0.11 : 0.14;
      b.life = b.maxLife;
      b.isEcho = isEcho;
      b.isGolden = isGolden;
      return;
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    r: number,
    g: number,
    b: number,
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      p.vx = Math.cos(a) * sp;
      p.vy = 2 + Math.random() * 6;
      p.vz = Math.sin(a) * sp;
      p.maxLife = 0.35 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.scale = 0.7 + Math.random() * 0.8;
      p.r = r;
      p.g = g;
      p.b = b;
      spawned++;
    }
  }

  private spawnRing(
    x: number,
    y: number,
    z: number,
    maxRadius: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (ring.active) continue;
      ring.active = true;
      ring.x = x;
      ring.y = y;
      ring.z = z;
      ring.maxLife = 0.38;
      ring.life = 0.38;
      ring.maxRadius = maxRadius;
      ring.r = r;
      ring.g = g;
      ring.b = b;
      return;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.cleanupInput();
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });
    this.renderer.dispose();
  }
}
