import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, normalize, relative, resolve, sep } from 'node:path';

import type { HandoffAsset, HandoffAssetRole } from '@shared/handoff';

export interface ResolvedHandoffAsset {
  role: HandoffAssetRole;
  content: string;
  mediaType: string;
  label?: string;
  /** Original workspace-relative path when present. */
  sourcePath?: string;
}

function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const root = resolve(workspacePath);
  const target = resolve(candidatePath);
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('..'));
}

/**
 * Resolve a handoff asset to UTF-8 text from inline content or a workspace path.
 * Rejects path escape outside the workspace.
 */
export function resolveHandoffAssetContent(
  workspacePath: string | null | undefined,
  asset: HandoffAsset,
): ResolvedHandoffAsset | null {
  const mediaType = asset.mediaType?.trim() || 'text/markdown';
  const label = asset.label?.trim() || undefined;

  if (typeof asset.content === 'string') {
    return {
      role: asset.role,
      content: asset.content,
      mediaType,
      ...(label ? { label } : {}),
      ...(asset.path?.trim() ? { sourcePath: asset.path.trim() } : {}),
    };
  }

  const relPath = asset.path?.trim();
  if (!relPath || !workspacePath) {
    return null;
  }

  const abs = resolve(workspacePath, normalize(relPath));
  if (!isInsideWorkspace(workspacePath, abs)) {
    return null;
  }

  try {
    const content = readFileSync(abs, 'utf8');
    return {
      role: asset.role,
      content,
      mediaType,
      ...(label ? { label } : {}),
      sourcePath: relPath,
    };
  } catch {
    return null;
  }
}

/** First resolved asset matching role, if any. */
export function findHandoffAssetByRole(
  workspacePath: string | null | undefined,
  assets: HandoffAsset[] | undefined,
  role: HandoffAssetRole,
): ResolvedHandoffAsset | null {
  if (!assets?.length) {
    return null;
  }
  for (const asset of assets) {
    if (asset.role !== role) {
      continue;
    }
    const resolved = resolveHandoffAssetContent(workspacePath, asset);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function safeAssetFileName(asset: HandoffAsset, index: number): string {
  const fromPath = asset.path?.trim() ? basename(asset.path.trim()) : '';
  const base =
    fromPath && fromPath !== '.' && fromPath !== '..'
      ? fromPath.replace(/[^a-zA-Z0-9._-]+/g, '_')
      : `${asset.role}-${index + 1}.md`;
  return base.length > 0 ? base : `${asset.role}-${index + 1}.md`;
}

export interface MaterializedHandoffAsset extends HandoffAsset {
  /** Artifact-relative path under the run artifacts dir (e.g. assets/pr-body.md). */
  path: string;
  content: string;
}

/**
 * Copy/write handoff assets into `artifactDir/assets/` and return assets with
 * content + artifact-relative paths for persistence in handoff.json.
 */
export function materializeHandoffAssets(
  workspacePath: string | null | undefined,
  artifactDir: string,
  assets: HandoffAsset[] | undefined,
): MaterializedHandoffAsset[] {
  if (!assets?.length) {
    return [];
  }

  const assetsDir = join(artifactDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const out: MaterializedHandoffAsset[] = [];
  const usedNames = new Set<string>();

  assets.forEach((asset, index) => {
    const resolved = resolveHandoffAssetContent(workspacePath, asset);
    if (!resolved) {
      return;
    }

    let fileName = safeAssetFileName(asset, index);
    if (usedNames.has(fileName)) {
      fileName = `${index + 1}-${fileName}`;
    }
    usedNames.add(fileName);

    const destAbs = join(assetsDir, fileName);
    const destRel = join('assets', fileName);

    if (resolved.sourcePath && workspacePath) {
      const srcAbs = resolve(workspacePath, normalize(resolved.sourcePath));
      if (isInsideWorkspace(workspacePath, srcAbs)) {
        try {
          copyFileSync(srcAbs, destAbs);
        } catch {
          writeFileSync(destAbs, resolved.content, 'utf8');
        }
      } else {
        writeFileSync(destAbs, resolved.content, 'utf8');
      }
    } else {
      writeFileSync(destAbs, resolved.content, 'utf8');
    }

    out.push({
      role: asset.role,
      path: destRel,
      content: resolved.content,
      mediaType: resolved.mediaType,
      ...(resolved.label ? { label: resolved.label } : {}),
    });
  });

  return out;
}

/** Best-effort extract of assets array from an unknown handoff payload. */
export function readHandoffAssets(handoff: unknown): HandoffAsset[] {
  if (!handoff || typeof handoff !== 'object') {
    return [];
  }
  const raw = (handoff as { assets?: unknown }).assets;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: HandoffAsset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const role = obj['role'];
    if (
      role !== 'pr-body' &&
      role !== 'pr-title' &&
      role !== 'report' &&
      role !== 'attachment'
    ) {
      continue;
    }
    const path = typeof obj['path'] === 'string' ? obj['path'] : undefined;
    const content = typeof obj['content'] === 'string' ? obj['content'] : undefined;
    if (!path?.trim() && content === undefined) {
      continue;
    }
    out.push({
      role,
      ...(path?.trim() ? { path: path.trim() } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(typeof obj['mediaType'] === 'string' && obj['mediaType'].trim()
        ? { mediaType: obj['mediaType'].trim() }
        : {}),
      ...(typeof obj['label'] === 'string' && obj['label'].trim()
        ? { label: obj['label'].trim() }
        : {}),
    });
  }
  return out;
}
