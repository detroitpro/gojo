#!/usr/bin/env bun
/**
 * Derive JSON Schema for gojo.yaml from ProjectManifestSchema (Zod).
 * Writes packages/contracts + site/public copies so editors and GitHub Pages
 * share one generated artifact. Run with --check to fail on drift.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProjectManifestSchema } from '@gojo/contracts';

const ROOT = join(import.meta.dirname, '..');
const CONTRACTS_OUT = join(
  ROOT,
  'packages/contracts/schemas/gojo.project.schema.json',
);
const SITE_OUT = join(ROOT, 'site/public/schemas/gojo.project.schema.json');

const HOSTED_URL =
  'https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json';

function buildSchema(): Record<string, unknown> {
  const generated = zodToJsonSchema(ProjectManifestSchema, {
    name: 'GojoProjectManifest',
    $refStrategy: 'root',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  delete generated['$schema'];
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: HOSTED_URL,
    title: 'gojo project manifest',
    description:
      'JSON Schema for repository-root gojo.yaml (or legacy .gojo/project.yaml). ' +
      'Generated from ProjectManifestSchema in @gojo/contracts. ' +
      'Runtime Sync still enforces Zod cross-field rules not expressible here.',
    ...generated,
  };
}

function serialize(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function writeOutputs(body: string): void {
  for (const path of [CONTRACTS_OUT, SITE_OUT]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const check = process.argv.includes('--check');
const body = serialize(buildSchema());

if (check) {
  const contracts = readOrEmpty(CONTRACTS_OUT);
  const site = readOrEmpty(SITE_OUT);
  if (contracts !== body || site !== body) {
    console.error(
      'error: gojo.project.schema.json is out of date.\n' +
        'Run: bun run scripts/generate-manifest-json-schema.ts\n' +
        `Expected identical content at:\n  ${CONTRACTS_OUT}\n  ${SITE_OUT}`,
    );
    process.exit(1);
  }
  console.log('gojo.project.schema.json: up to date');
  process.exit(0);
}

writeOutputs(body);
console.log(`wrote ${CONTRACTS_OUT}`);
console.log(`wrote ${SITE_OUT}`);
