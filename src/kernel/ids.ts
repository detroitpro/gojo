import { generateUlid, isValidUlid } from "@shared/ids";

/** Injectable ID generator — production uses ULID; tests inject deterministic sequences. */

export interface IdGenerator {
  next(): string;
}

export class UlidGenerator implements IdGenerator {
  next(): string {
    return generateUlid();
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private n = 0;

  constructor(private readonly prefix = "01TEST") {}

  next(): string {
    this.n += 1;
    const suffix = String(this.n).padStart(21, "0");
    return `${this.prefix}${suffix}`;
  }
}

export { isValidUlid };
