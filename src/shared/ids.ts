import { decodeTime, ulid } from 'ulid';
import { z } from 'zod';

/** Crockford base32 ULID: 26 characters, time-sortable. */
const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const UlidSchema = z.string().regex(ULID_REGEX, 'Invalid ULID');

export type Ulid = z.infer<typeof UlidSchema>;

/** Generate a new lexicographically sortable ULID. */
export function generateUlid(): string {
  return ulid();
}

/** Returns true when `value` matches the ULID format. */
export function isValidUlid(value: string): boolean {
  return UlidSchema.safeParse(value).success;
}

/** Decode the timestamp (milliseconds since Unix epoch) embedded in a ULID. */
export function decodeUlidTimestamp(value: string): number {
  UlidSchema.parse(value);
  return decodeTime(value);
}
