import { ECHO_SAMPLE_INTERVAL } from './config';
import type { EchoRecord } from './economy';

export interface EchoShotEvent {
  t: number;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export const SAMPLE_STRIDE = 6; // t, x, y, z, yaw, pitch

export class EchoRecorder {
  private samples: number[] = [];
  private shots: EchoShotEvent[] = [];
  private lastSampleTime = -1;

  reset(): void {
    this.samples.length = 0;
    this.shots.length = 0;
    this.lastSampleTime = -1;
  }

  recordFrame(t: number, x: number, y: number, z: number, yaw: number, pitch: number, force = false): void {
    if (!force && this.lastSampleTime >= 0 && t - this.lastSampleTime < ECHO_SAMPLE_INTERVAL) {
      return;
    }
    this.lastSampleTime = t;
    this.samples.push(
      Number(t.toFixed(3)),
      Number(x.toFixed(3)),
      Number(y.toFixed(3)),
      Number(z.toFixed(3)),
      Number(yaw.toFixed(4)),
      Number(pitch.toFixed(4)),
    );
  }

  recordShot(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    this.shots.push({
      t: Number(t.toFixed(3)),
      ox: Number(ox.toFixed(3)),
      oy: Number(oy.toFixed(3)),
      oz: Number(oz.toFixed(3)),
      dx: Number(dx.toFixed(4)),
      dy: Number(dy.toFixed(4)),
      dz: Number(dz.toFixed(4)),
    });
  }

  finalize(id: string, duration: number, loopShards: number): EchoRecord {
    const safeDuration = Math.max(1, duration);
    return {
      id,
      createdAt: Date.now(),
      baseRate: loopShards / safeDuration,
      loopShards,
      duration: safeDuration,
      samples: Array.from(this.samples),
      shots: this.shots.map((s) => ({ ...s })),
    };
  }
}

export interface PoseSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function sampleEchoPose(echo: EchoRecord, loopTime: number, out: PoseSample): boolean {
  const arr = echo.samples;
  const count = Math.floor(arr.length / SAMPLE_STRIDE);
  if (count === 0) return false;

  const dur = Math.max(0.1, echo.duration);
  const t = ((loopTime % dur) + dur) % dur;

  if (count === 1 || t <= arr[0]) {
    out.x = arr[1];
    out.y = arr[2];
    out.z = arr[3];
    out.yaw = arr[4];
    out.pitch = arr[5];
    return true;
  }

  const lastBase = (count - 1) * SAMPLE_STRIDE;
  if (t >= arr[lastBase]) {
    out.x = arr[lastBase + 1];
    out.y = arr[lastBase + 2];
    out.z = arr[lastBase + 3];
    out.yaw = arr[lastBase + 4];
    out.pitch = arr[lastBase + 5];
    return true;
  }

  // Binary search for bracketing sample
  let lo = 0;
  let hi = count - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid * SAMPLE_STRIDE] <= t) lo = mid;
    else hi = mid;
  }

  const i0 = lo * SAMPLE_STRIDE;
  const i1 = hi * SAMPLE_STRIDE;
  const t0 = arr[i0];
  const t1 = arr[i1];
  const span = Math.max(0.0001, t1 - t0);
  const alpha = Math.max(0, Math.min(1, (t - t0) / span));

  out.x = arr[i0 + 1] + (arr[i1 + 1] - arr[i0 + 1]) * alpha;
  out.y = arr[i0 + 2] + (arr[i1 + 2] - arr[i0 + 2]) * alpha;
  out.z = arr[i0 + 3] + (arr[i1 + 3] - arr[i0 + 3]) * alpha;
  out.yaw = lerpAngle(arr[i0 + 4], arr[i1 + 4], alpha);
  out.pitch = arr[i0 + 5] + (arr[i1 + 5] - arr[i0 + 5]) * alpha;
  return true;
}

export function collectEchoShotsInWindow(
  echo: EchoRecord,
  prevLoopTime: number,
  currLoopTime: number,
): EchoShotEvent[] {
  if (echo.shots.length === 0) return [];
  const dur = Math.max(0.1, echo.duration);
  const t0 = ((prevLoopTime % dur) + dur) % dur;
  const t1 = ((currLoopTime % dur) + dur) % dur;

  const fired: EchoShotEvent[] = [];
  if (t1 >= t0) {
    for (let i = 0; i < echo.shots.length; i++) {
      const s = echo.shots[i];
      if (s.t > t0 && s.t <= t1) fired.push(s);
    }
  } else {
    // Wrapped across loop boundary
    for (let i = 0; i < echo.shots.length; i++) {
      const s = echo.shots[i];
      if (s.t > t0 || s.t <= t1) fired.push(s);
    }
  }
  return fired;
}
