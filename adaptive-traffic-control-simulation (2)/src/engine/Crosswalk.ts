import { DirectionKey } from '../types/traffic';
import { CROSSWALK_INNER, CROSSWALK_OUTER, WORLD } from './config';
import { Pedestrian } from './Pedestrian';

export class Crosswalk {
  public id: string;
  public intersectionId: number;
  public direction: DirectionKey;

  // Geometry
  public x: number;
  public y: number;
  public startX: number;
  public startY: number;
  public endX: number;
  public endY: number;
  public isVerticalRoad: boolean;

  constructor(intersectionId: number, intersectionX: number, intersectionY: number, direction: DirectionKey) {
    this.id = `cross-${intersectionId}-${direction}`;
    this.intersectionId = intersectionId;
    this.direction = direction;

    const crosswalkMid = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2; // 66px
    const curbSpan = WORLD.halfRoad + 10; // 66px from center line to sidewalk curb

    if (direction === 'N') {
      this.isVerticalRoad = true;
      this.x = intersectionX;
      this.y = intersectionY - crosswalkMid;
      this.startX = intersectionX - curbSpan;
      this.startY = this.y;
      this.endX = intersectionX + curbSpan;
      this.endY = this.y;
    } else if (direction === 'S') {
      this.isVerticalRoad = true;
      this.x = intersectionX;
      this.y = intersectionY + crosswalkMid;
      this.startX = intersectionX - curbSpan;
      this.startY = this.y;
      this.endX = intersectionX + curbSpan;
      this.endY = this.y;
    } else if (direction === 'W') {
      this.isVerticalRoad = false;
      this.x = intersectionX - crosswalkMid;
      this.y = intersectionY;
      this.startX = this.x;
      this.startY = intersectionY - curbSpan;
      this.endX = this.x;
      this.endY = intersectionY + curbSpan;
    } else {
      // 'E'
      this.isVerticalRoad = false;
      this.x = intersectionX + crosswalkMid;
      this.y = intersectionY;
      this.startX = this.x;
      this.startY = intersectionY - curbSpan;
      this.endX = this.x;
      this.endY = intersectionY + curbSpan;
    }
  }

  /**
   * Spawns 1-2 pedestrians crossing between sidewalks when the pedestrian phase activates.
   */
  spawnPedestrians(): Pedestrian[] {
    const pedestrians: Pedestrian[] = [];
    const count = 1 + Math.floor(Math.random() * 2); // 1 to 2 pedestrians

    for (let i = 0; i < count; i++) {
      const forward = Math.random() > 0.5;
      const sx = forward ? this.startX : this.endX;
      const sy = forward ? this.startY : this.endY;
      const tx = forward ? this.endX : this.startX;
      const ty = forward ? this.endY : this.startY;

      // Slight lane offset so pedestrians pass each other naturally
      const lateralShift = (i - (count - 1) / 2) * 4 + (Math.random() - 0.5) * 2;
      const pStartX = this.isVerticalRoad ? sx : sx + lateralShift;
      const pStartY = this.isVerticalRoad ? sy + lateralShift : sy;
      const pTargetX = this.isVerticalRoad ? tx : tx + lateralShift;
      const pTargetY = this.isVerticalRoad ? ty + lateralShift : ty;

      pedestrians.push(new Pedestrian(this.id, pStartX, pStartY, pTargetX, pTargetY));
    }

    return pedestrians;
  }
}
