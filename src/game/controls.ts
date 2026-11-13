export interface JoystickVisualState {
  active: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

export interface InputSnapshot {
  moveX: number;
  moveZ: number;
  lookDeltaX: number;
  lookDeltaY: number;
  jumpPressed: boolean;
  dashPressed: boolean;
  interactPressed: boolean;
  fireHeld: boolean;
  hasMoved: boolean;
  hasAimed: boolean;
  isTouchActive: boolean;
}

export class UnifiedInputController {
  private keys = new Set<string>();
  private jumpBuffered = false;
  private dashBuffered = false;
  private interactBuffered = false;
  private mouseDown = false;
  private pointerLocked = false;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private draggingAim = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch state
  private leftTouchId: number | null = null;
  private rightTouchId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyKnobX = 0;
  private joyKnobY = 0;
  private joyMoveX = 0;
  private joyMoveZ = 0;
  private rightTouchLastX = 0;
  private rightTouchLastY = 0;
  private touchActive = false;

  public hasMoved = false;
  public hasAimed = false;

  private canvas: HTMLElement | null = null;
  private onPauseRequested?: () => void;
  private onFirstGesture?: () => void;
  private onJoystickChange?: (state: JoystickVisualState) => void;
  private sensitivity = 1.0;

  constructor(callbacks: {
    onPauseRequested?: () => void;
    onFirstGesture?: () => void;
    onJoystickChange?: (state: JoystickVisualState) => void;
  }) {
    this.onPauseRequested = callbacks.onPauseRequested;
    this.onFirstGesture = callbacks.onFirstGesture;
    this.onJoystickChange = callbacks.onJoystickChange;
  }

  setSensitivity(sens: number): void {
    this.sensitivity = sens;
  }

  attach(canvasElement: HTMLElement): () => void {
    this.canvas = canvasElement;
    if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
      this.touchActive = true;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      this.onFirstGesture?.();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (document.body.dataset.state === 'playing') {
          this.onPauseRequested?.();
        }
        return;
      }
      if (e.code === 'Space' && !this.keys.has('Space')) {
        this.jumpBuffered = true;
      }
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') && !this.keys.has(e.code)) {
        this.dashBuffered = true;
      }
      if (e.code === 'KeyE' && !this.keys.has('KeyE')) {
        this.interactBuffered = true;
      }
      this.keys.add(e.code);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    const onBlur = () => {
      this.clearAll();
    };

    const onVisibility = () => {
      if (document.hidden) this.clearAll();
    };

    const onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };

    const onMouseDown = (e: MouseEvent) => {
      this.onFirstGesture?.();
      if (document.body.dataset.state !== 'playing') return;
      if (e.target !== this.canvas) return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.draggingAim = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        // Request pointer lock on desktop non-touch if supported
        if (!this.touchActive && this.canvas?.requestPointerLock) {
          try {
            const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {
            // PointerLock blocked (e.g. headless/iframe) — drag aim handles seamlessly
          }
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (document.body.dataset.state !== 'playing') return;
      if (this.pointerLocked) {
        this.lookDeltaX += e.movementX * 0.0024 * this.sensitivity;
        this.lookDeltaY += e.movementY * 0.0024 * this.sensitivity;
        if (Math.abs(e.movementX) > 0.5 || Math.abs(e.movementY) > 0.5) {
          this.hasAimed = true;
        }
      } else if (this.draggingAim) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.lookDeltaX += dx * 0.0038 * this.sensitivity;
        this.lookDeltaY += dy * 0.0038 * this.sensitivity;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          this.hasAimed = true;
        }
      }
    };

    const onMouseUp = () => {
      this.mouseDown = false;
      this.draggingAim = false;
    };

    const maxJoyRadius = 54;

    const onTouchStart = (e: TouchEvent) => {
      this.touchActive = true;
      this.onFirstGesture?.();
      if (document.body.dataset.state !== 'playing') return;
      if (e.target !== this.canvas) return;

      const midX = window.innerWidth * 0.5;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < midX && this.leftTouchId === null) {
          this.leftTouchId = t.identifier;
          this.joyOriginX = t.clientX;
          this.joyOriginY = t.clientY;
          this.joyKnobX = t.clientX;
          this.joyKnobY = t.clientY;
          this.joyMoveX = 0;
          this.joyMoveZ = 0;
          this.emitJoystick(true);
        } else if (t.clientX >= midX && this.rightTouchId === null) {
          this.rightTouchId = t.identifier;
          this.rightTouchLastX = t.clientX;
          this.rightTouchLastY = t.clientY;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (document.body.dataset.state !== 'playing') return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.leftTouchId) {
          const dx = t.clientX - this.joyOriginX;
          const dy = t.clientY - this.joyOriginY;
          const dist = Math.hypot(dx, dy);
          const clamped = Math.min(maxJoyRadius, dist);
          const angle = Math.atan2(dy, dx);
          this.joyKnobX = this.joyOriginX + Math.cos(angle) * clamped;
          this.joyKnobY = this.joyOriginY + Math.sin(angle) * clamped;
          const norm = clamped / maxJoyRadius;
          if (norm > 0.12) {
            this.joyMoveX = Math.cos(angle) * norm;
            this.joyMoveZ = Math.sin(angle) * norm;
            this.hasMoved = true;
          } else {
            this.joyMoveX = 0;
            this.joyMoveZ = 0;
          }
          this.emitJoystick(true);
        } else if (t.identifier === this.rightTouchId) {
          const dx = t.clientX - this.rightTouchLastX;
          const dy = t.clientY - this.rightTouchLastY;
          this.rightTouchLastX = t.clientX;
          this.rightTouchLastY = t.clientY;
          this.lookDeltaX += dx * 0.0052 * this.sensitivity;
          this.lookDeltaY += dy * 0.0046 * this.sensitivity;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            this.hasAimed = true;
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.leftTouchId) {
          this.leftTouchId = null;
          this.joyMoveX = 0;
          this.joyMoveZ = 0;
          this.emitJoystick(false);
        } else if (t.identifier === this.rightTouchId) {
          this.rightTouchId = null;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvasElement.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasElement.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }

  private emitJoystick(active: boolean): void {
    this.onJoystickChange?.({
      active,
      originX: this.joyOriginX,
      originY: this.joyOriginY,
      knobX: this.joyKnobX,
      knobY: this.joyKnobY,
    });
  }

  triggerJump(): void {
    this.onFirstGesture?.();
    this.jumpBuffered = true;
  }

  triggerDash(): void {
    this.onFirstGesture?.();
    this.dashBuffered = true;
  }

  triggerInteract(): void {
    this.onFirstGesture?.();
    this.interactBuffered = true;
  }

  clearAll(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.draggingAim = false;
    this.jumpBuffered = false;
    this.dashBuffered = false;
    this.interactBuffered = false;
    this.leftTouchId = null;
    this.rightTouchId = null;
    this.joyMoveX = 0;
    this.joyMoveZ = 0;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.emitJoystick(false);
  }

  consumeSnapshot(): InputSnapshot {
    // Support both WASD and ZQSD (French AZERTY) + Arrow keys
    let kx = 0;
    let kz = 0;
    if (this.keys.has('KeyW') || this.keys.has('KeyZ') || this.keys.has('ArrowUp')) kz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz += 1;
    if (this.keys.has('KeyA') || this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;

    // Keyboard look support for accessibility / automated testing (J/L or Shift+Arrows)
    if (this.keys.has('KeyJ')) {
      this.lookDeltaX -= 0.03 * this.sensitivity;
      this.hasAimed = true;
    }
    if (this.keys.has('KeyL')) {
      this.lookDeltaX += 0.03 * this.sensitivity;
      this.hasAimed = true;
    }

    if (kx !== 0 || kz !== 0) {
      const len = Math.hypot(kx, kz);
      kx /= len;
      kz /= len;
      this.hasMoved = true;
    }

    const moveX = Math.abs(this.joyMoveX) > 0.05 ? this.joyMoveX : kx;
    const moveZ = Math.abs(this.joyMoveZ) > 0.05 ? this.joyMoveZ : kz;

    const snap: InputSnapshot = {
      moveX,
      moveZ,
      lookDeltaX: this.lookDeltaX,
      lookDeltaY: this.lookDeltaY,
      jumpPressed: this.jumpBuffered,
      dashPressed: this.dashBuffered,
      interactPressed: this.interactBuffered,
      fireHeld: this.mouseDown || this.keys.has('KeyF'),
      hasMoved: this.hasMoved,
      hasAimed: this.hasAimed,
      isTouchActive: this.touchActive,
    };

    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.jumpBuffered = false;
    this.dashBuffered = false;
    this.interactBuffered = false;
    return snap;
  }
}
