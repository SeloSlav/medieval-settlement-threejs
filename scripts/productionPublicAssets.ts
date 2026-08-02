import { cpSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const QA_ARCHIVE_ROOT = 'visual-gauntlet';

export function shouldCopyPublicPath(
  publicRoot: string,
  sourcePath: string,
  includeQaArchives: boolean,
): boolean {
  if (includeQaArchives) return true;
  const relativePath = relative(publicRoot, sourcePath).replaceAll('\\', '/');
  return relativePath !== QA_ARCHIVE_ROOT
    && !relativePath.startsWith(`${QA_ARCHIVE_ROOT}/`);
}

export function copyPublicAssets(
  publicRoot: string,
  outputRoot: string,
  includeQaArchives: boolean,
): void {
  if (!existsSync(publicRoot)) return;
  cpSync(publicRoot, resolve(outputRoot), {
    recursive: true,
    filter: (sourcePath) => shouldCopyPublicPath(
      publicRoot,
      sourcePath,
      includeQaArchives,
    ),
  });
}
