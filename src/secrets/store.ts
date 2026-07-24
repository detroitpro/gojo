import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { GojoPaths } from "@/config/paths";
import { Database, createRepositories } from "@/storage";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MASTER_KEY_FILENAME = "master.key";
const MASTER_KEY_BYTES = 32;

function loadOrCreateMasterKey(secretsDir: string): Buffer {
  const keyPath = join(secretsDir, MASTER_KEY_FILENAME);
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(`Invalid master key length at ${keyPath}`);
    }
    return key;
  }

  if (!existsSync(secretsDir)) {
    mkdirSync(secretsDir, { recursive: true });
  }

  const key = randomBytes(MASTER_KEY_BYTES);
  writeFileSync(keyPath, key, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return key;
}

function encryptValue(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptValue(key: Buffer, ciphertext: string): string {
  const payload = Buffer.from(ciphertext, "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export class SecretStore {
  private readonly db: Database;
  private readonly paths: GojoPaths;
  private masterKeyCache: Buffer | null = null;

  constructor(db: Database, paths: GojoPaths) {
    this.db = db;
    this.paths = paths;
  }

  private masterKey(): Buffer {
    if (this.masterKeyCache === null) {
      this.masterKeyCache = loadOrCreateMasterKey(this.paths.secrets);
    }
    return this.masterKeyCache;
  }

  set(name: string, value: string, projectId?: string): void {
    const repos = createRepositories(this.db);
    const ciphertext = encryptValue(this.masterKey(), value);
    repos.secrets.upsert({ name, projectId: projectId ?? null, ciphertext });
  }

  get(name: string, projectId?: string): string | null {
    const repos = createRepositories(this.db);
    const record = repos.secrets.findByName(name, projectId ?? null);
    if (!record) {
      return null;
    }
    return decryptValue(this.masterKey(), record.ciphertext);
  }

  delete(name: string): boolean {
    const repos = createRepositories(this.db);
    return repos.secrets.deleteByName(name, null);
  }

  list(): { name: string; projectId: string | null }[] {
    const repos = createRepositories(this.db);
    return repos.secrets.list().map((record) => ({
      name: record.name,
      projectId: record.projectId,
    }));
  }

  redact(text: string, secretValues: readonly string[]): string {
    if (secretValues.length === 0) {
      return text;
    }

    const unique = [...new Set(secretValues.filter((value) => value.length > 0))];
    unique.sort((a, b) => b.length - a.length);

    let redacted = text;
    for (const value of unique) {
      redacted = redacted.split(value).join("***");
    }
    return redacted;
  }
}

export { loadOrCreateMasterKey, encryptValue, decryptValue };
