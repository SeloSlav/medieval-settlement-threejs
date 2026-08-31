import { cpSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const QA_ARCHIVE_ROOT = 'visual-gauntlet';
const ARCHITECTURE_REFERENCE_ROOT = 'assets/models/buildings/gorski';

export function shouldCopyPublicPath(
  publicRoot: string,
  sourcePath: string,
  includeQaArchives: boolean,
  includeArchitectureReferences = false,
): boolean {
  const relativePath = relative(publicRoot, sourcePath).replaceAll('\\', '/');
  const insideQaArchive = relativePath === QA_ARCHIVE_ROOT
    || relativePath.startsWith(`${QA_ARCHIVE_ROOT}/`);
  if (insideQaArchive) return includeQaArchives;
  const insideArchitectureReferences = relativePath === ARCHITECTURE_REFERENCE_ROOT
    || relativePath.startsWith(`${ARCHITECTURE_REFERENCE_ROOT}/`);
  if (insideArchitectureReferences) return includeArchitectureReferences;
  return true;
}

export function copyPublicAssets(
  publicRoot: string,
  outputRoot: string,
  includeQaArchives: boolean,
  includeArchitectureReferences = false,
): void {
  if (!existsSync(publicRoot)) return;
  cpSync(publicRoot, resolve(outputRoot), {
    recursive: true,
    filter: (sourcePath) => shouldCopyPublicPath(
      publicRoot,
      sourcePath,
      includeQaArchives,
      includeArchitectureReferences,
    ),
  });
}
