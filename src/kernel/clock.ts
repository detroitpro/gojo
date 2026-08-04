/** Injectable time source — production uses system clock; tests inject fixed/fake clocks. */

export interface Clock {
  now(): Date;
  nowMs(): number;
  nowIso(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date().toISOString();
  }
}

export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }

  nowMs(): number {
    return this.instant.getTime();
  }

  nowIso(): string {
    return this.instant.toISOString();
  }

  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }

  set(instant: Date): void {
    this.instant = new Date(instant.getTime());
  }
}
