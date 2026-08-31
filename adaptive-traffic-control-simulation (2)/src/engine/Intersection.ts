import { IntersectionViewData, SignalState } from '../types/traffic';
import { DETECTOR, DIRECTIONS, DIR_KEYS, PEDESTRIAN, PHASE_OF, SIGNAL, TICK_HZ, WORLD } from './config';
import { Crosswalk } from './Crosswalk';
import { Vehicle } from './Vehicle';

export class Intersection {
  public id: number;
  public row: number;
  public col: number;
  public x: number;
  public y: number;
  public baseOffset: number;

  public crosswalks: Crosswalk[];

  public localTimer = 0;
  public phase = 0;
  public lockedNextPhase = 3;
  public quietCycles = 0;

  public durations: number[] = new Array(12);
  public occupancy: number[] = new Array(4);
  public queueTimer: number[] = new Array(4);
  public queueBlocked: boolean[] = new Array(4);
  public boxTimer: number[] = new Array(4);
  public boxBlocked: boolean[] = new Array(4);
  public boxCycles: number[] = new Array(4);
  public crashed: boolean[] = new Array(4);

  public frameApproach: boolean[] = new Array(4);
  public frameQueue: boolean[] = new Array(4);
  public frameBox: boolean[] = new Array(4);

  constructor(row: number, col: number) {
    this.id = row * WORLD.gridSize + col + 1;
    this.row = row;
    this.col = col;
    this.x = (col + 0.5) * WORLD.cell;
    this.y = (row + 0.5) * WORLD.cell;
    this.baseOffset = (row + col) * 60;

    // Crosswalks at all four intersection approaches (N, S, W, E)
    this.crosswalks = [
      new Crosswalk(this.id, this.x, this.y, 'N'),
      new Crosswalk(this.id, this.x, this.y, 'S'),
      new Crosswalk(this.id, this.x, this.y, 'W'),
      new Crosswalk(this.id, this.x, this.y, 'E'),
    ];

    this.reset();
  }

  reset(): void {
    this.localTimer = 0;
    this.phase = ((this.row + this.col) * 3) % 12;
    this.lockedNextPhase = (this.phase + 3) % 12;
    this.quietCycles = 0;

    for (let p = 0; p < 12; p++) {
      if (p % 3 === 0) {
        this.durations[p] = SIGNAL.defaultGreen;
      } else if (p % 3 === 1) {
        this.durations[p] = SIGNAL.yellow;
      } else {
        this.durations[p] = PEDESTRIAN.crossingTicks; // 240 ticks = fixed 4.0s
      }
    }

    for (let i = 0; i < 4; i++) {
      this.occupancy[i] = 0;
      this.queueTimer[i] = 0;
      this.queueBlocked[i] = false;
      this.boxTimer[i] = 0;
      this.boxBlocked[i] = false;
      this.boxCycles[i] = 0;
      this.crashed[i] = false;
      this.frameApproach[i] = false;
      this.frameQueue[i] = false;
      this.frameBox[i] = false;
    }
  }

  get isGreenPhase(): boolean {
    return this.phase % 3 === 0;
  }

  get isYellowPhase(): boolean {
    return this.phase % 3 === 1;
  }

  get isPedestrianPhase(): boolean {
    return this.phase % 3 === 2;
  }

  get pedestrianCountdown(): number {
    if (!this.isPedestrianPhase) return 0;
    const remainingTicks = this.durations[this.phase] - this.localTimer;
    return Math.max(0, Math.ceil(remainingTicks / TICK_HZ));
  }

  get cycleLength(): number {
    let t = 0;
    for (let p = 0; p < 12; p++) t += this.durations[p];
    return t;
  }

  axisFaulted(index: number): boolean {
    return index < 2 ? this.crashed[0] || this.crashed[1] : this.crashed[2] || this.crashed[3];
  }

  anyCrash(): boolean {
    return this.crashed[0] || this.crashed[1] || this.crashed[2] || this.crashed[3];
  }

  advance(
    masterTimer: number,
    onCrash: (intersection: Intersection, index: number) => void,
    onPreempt: () => void
  ): boolean {
    this.localTimer++;
    this.detectCrashes(onCrash);

    const call = this.priorityCall();
    this.lockedNextPhase =
      call !== -1 ? call : (Math.floor(this.phase / 3) * 3 + 3) % 12;

    // A queued call truncates an over-long green gracefully
    if (call !== -1 && this.isGreenPhase) {
      const remaining = this.durations[this.phase] - this.localTimer;
      if (remaining > SIGNAL.maxHoldOnCall) {
        this.durations[this.phase] = this.localTimer + SIGNAL.maxHoldOnCall;
        onPreempt();
      }
    }

    let startedPedestrianPhase = false;
    if (this.localTimer >= this.durations[this.phase]) {
      this.changePhase(masterTimer);
      if (this.isPedestrianPhase) {
        startedPedestrianPhase = true;
      }
    }

    return startedPedestrianPhase;
  }

  private detectCrashes(onCrash: (intersection: Intersection, index: number) => void): void {
    for (let i = 0; i < 4; i++) {
      if (this.boxTimer[i] <= SIGNAL.dwellThreshold) {
        this.boxCycles[i] = 0;
        continue;
      }
      if (this.phase === PHASE_OF[i] && this.localTimer === 1) {
        this.boxCycles[i]++;
        if (this.boxCycles[i] >= SIGNAL.crashCycles && !this.crashed[i]) {
          this.crashed[i] = true;
          onCrash(this, i);
        }
      }
    }
  }

  private priorityCall(): number {
    for (let i = 0; i < 4; i++) {
      const green = PHASE_OF[i];
      if (this.boxBlocked[i] && this.phase !== green && this.phase !== green + 1) {
        return green;
      }
    }
    for (let i = 0; i < 4; i++) {
      const green = PHASE_OF[i];
      if (
        this.queueTimer[i] > SIGNAL.dwellThreshold &&
        this.phase !== green &&
        this.phase !== green + 1
      ) {
        return green;
      }
    }
    return -1;
  }

  private changePhase(masterTimer: number): void {
    const previous = this.phase;
    this.localTimer = 0;
    if (previous === 11) {
      this.retime(masterTimer);
    }

    if (previous % 3 === 0) {
      // Vehicle Green -> Vehicle Yellow
      this.phase = previous + 1;
    } else if (previous % 3 === 1) {
      // Vehicle Yellow -> Pedestrian Walk (4.0s countdown 4 -> 3 -> 2 -> 1 -> 0)
      this.phase = previous + 1;
    } else {
      // Pedestrian Walk -> Next Vehicle Green
      this.phase = this.lockedNextPhase;
      this.occupancy[Math.floor(this.phase / 3)] = 0;
    }
  }

  private retime(masterTimer: number): void {
    let quiet = true;
    for (let i = 0; i < 4; i++) {
      const green = PHASE_OF[i];
      const saturation = this.occupancy[i] / Math.max(1, this.durations[green]);

      if (saturation > 0.75 || this.boxBlocked[i]) {
        this.durations[green] = Math.min(SIGNAL.maxGreen, this.durations[green] + SIGNAL.greenStep);
        quiet = false;
      } else if (saturation < 0.25 && this.durations[green] > SIGNAL.minGreen) {
        this.durations[green] -= SIGNAL.greenStep;
      }
      if (saturation > 0.3) {
        quiet = false;
      }
    }

    this.quietCycles = quiet ? this.quietCycles + 1 : 0;
    if (this.quietCycles > 1) {
      const total = this.cycleLength;
      const masterPos = (masterTimer + this.baseOffset) % total;
      if (masterPos > 10 && masterPos < total - 10) {
        this.localTimer += SIGNAL.glideNudge;
      }
    }
  }

  beginScan(): void {
    for (let i = 0; i < 4; i++) {
      this.frameApproach[i] = false;
      this.frameQueue[i] = false;
      this.frameBox[i] = false;
    }
  }

  sample(vehicle: Vehicle): void {
    const dx = vehicle.x - this.x;
    const dy = vehicle.y - this.y;
    const reach = DETECTOR.queueFar + 20;
    if (dx < -reach || dx > reach || dy < -reach || dy > reach) return;

    const dir = DIRECTIONS[vehicle.dir];
    const lateral = dir.axis === 'y' ? dx : dy;

    // Check if vehicle is in its assigned approach lane (car lane or bus lane)
    if (Math.abs(lateral - dir.lane * vehicle.laneOffset) >= DETECTOR.laneTolerance) return;

    const index = dir.index;
    const along = (dir.axis === 'y' ? dy : dx) * dir.sign;

    if (
      along > -DETECTOR.approachFar &&
      along < -DETECTOR.approachNear &&
      this.phase === PHASE_OF[index]
    ) {
      this.occupancy[index]++;
    }
    if (along > -DETECTOR.queueFar && along < -DETECTOR.queueNear) {
      this.frameQueue[index] = true;
    }
    if (along >= -DETECTOR.boxDepth && along <= 0) {
      this.frameBox[index] = true;
    }
    if (along > -DETECTOR.approachFar && along < -DETECTOR.approachNear) {
      this.frameApproach[index] = true;
    }
  }

  commitScan(): void {
    for (let i = 0; i < 4; i++) {
      this.queueTimer[i] = this.frameQueue[i] ? this.queueTimer[i] + 1 : 0;
      this.queueBlocked[i] = this.queueTimer[i] > SIGNAL.dwellThreshold;
      this.boxTimer[i] = this.frameBox[i] ? this.boxTimer[i] + 1 : 0;
      this.boxBlocked[i] = this.boxTimer[i] > SIGNAL.dwellThreshold;
    }
  }

  aspectFor(index: number): SignalState {
    if (this.axisFaulted(index)) return 'fault';
    const green = PHASE_OF[index];
    if (this.phase === green) return 'green';
    if (this.phase === green + 1) return 'amber';
    return 'red';
  }

  countdownFor(index: number): number {
    const green = PHASE_OF[index];
    if (this.phase === green) {
      return this.durations[green] - this.localTimer + this.durations[green + 1];
    }
    if (this.phase === green + 1) {
      return this.durations[green + 1] - this.localTimer;
    }
    if (green === this.lockedNextPhase) {
      let remaining = this.durations[this.phase] - this.localTimer;
      if (this.isGreenPhase) {
        remaining += this.durations[this.phase + 1] + this.durations[this.phase + 2];
      } else if (this.isYellowPhase) {
        remaining += this.durations[this.phase + 1];
      }
      return remaining;
    }
    return -1;
  }

  getViewData(): IntersectionViewData {
    return {
      id: this.id,
      row: this.row,
      col: this.col,
      x: this.x,
      y: this.y,
      aspects: DIR_KEYS.map((_, i) => this.aspectFor(i)),
      countdowns: DIR_KEYS.map((_, i) => this.countdownFor(i)),
      crosswalks: this.crosswalks.map((c) => ({
        id: c.id,
        intersectionId: this.id,
        direction: c.direction,
        isActive: this.isPedestrianPhase,
        remainingSeconds: this.pedestrianCountdown,
        totalDurationSeconds: PEDESTRIAN.crossingDurationSeconds,
        pedestrianCount: 0,
      })),
      queueBlocked: [...this.queueBlocked],
      boxBlocked: [...this.boxBlocked],
      crashed: [...this.crashed],
      isCrashed: this.anyCrash(),
      cycleLengthSeconds: this.cycleLength / 60,
    };
  }
}
