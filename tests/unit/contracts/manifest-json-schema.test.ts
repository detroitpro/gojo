import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const ROOT = join(import.meta.dirname, '../../..');
const CONTRACTS_SCHEMA = join(
  ROOT,
  'packages/contracts/schemas/gojo.project.schema.json',
);
const SITE_SCHEMA = join(ROOT, 'site/public/schemas/gojo.project.schema.json');

describe('gojo.project.schema.json', () => {
  test('committed contracts and site copies match and describe the manifest', () => {
    const contracts = readFileSync(CONTRACTS_SCHEMA, 'utf8');
    const site = readFileSync(SITE_SCHEMA, 'utf8');
    expect(contracts).toBe(site);

    const schema = JSON.parse(contracts) as {
      $id?: string;
      $ref?: string;
      definitions?: { GojoProjectManifest?: { required?: string[] } };
    };
    expect(schema.$id).toBe(
      'https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json',
    );
    expect(schema.$ref).toBe('#/definitions/GojoProjectManifest');
    expect(schema.definitions?.GojoProjectManifest?.required).toEqual(
      expect.arrayContaining([
        'version',
        'project',
        'repository',
        'profiles',
        'validationProfiles',
        'agents',
      ]),
    );
  });

  test('generator --check passes against committed artifacts', async () => {
    const result =
      await $`bun run ${join(ROOT, 'scripts/generate-manifest-json-schema.ts')} --check`.quiet();
    expect(result.exitCode).toBe(0);
  });
});
