/**
 * File Reveal API
 * Opens a file's location in Finder (macOS) or Explorer (Windows)
 */

import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, realpathSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

function isPathInside(basePath: string, targetPath: string): boolean {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${path.sep}`);
}

export async function POST(request: NextRequest) {
  try {
    const { filePath } = await request.json();

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
    }

    // Expand tilde
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '');

    // Security: Ensure path is within allowed directories (from env config)
    const allowedPaths = [
      process.env.STYRMAN_PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
    ].filter(Boolean) as string[];

    const normalizedPath = path.normalize(expandedPath);
    const normalizedAllowedPaths = allowedPaths.map((allowed) => path.normalize(allowed));

    const isAllowed = normalizedAllowedPaths.some((allowed) =>
      isPathInside(allowed, normalizedPath)
    );

    if (!isAllowed) {
      console.warn(`[FILE] Blocked access to: ${filePath}`);
      return NextResponse.json(
        { error: 'Path not in allowed directories' },
        { status: 403 }
      );
    }

    // Check if file/directory exists
    if (!existsSync(normalizedPath)) {
      return NextResponse.json(
        { error: 'File or directory not found', path: normalizedPath },
        { status: 404 }
      );
    }

    const resolvedPath = realpathSync(normalizedPath);
    const resolvedAllowedPaths = normalizedAllowedPaths.map((allowed) => {
      try {
        return realpathSync(allowed);
      } catch {
        return allowed;
      }
    });

    const isResolvedAllowed = resolvedAllowedPaths.some((allowed) =>
      isPathInside(allowed, resolvedPath)
    );

    if (!isResolvedAllowed) {
      console.warn(`[FILE] Blocked symlink escape for: ${filePath}`);
      return NextResponse.json(
        { error: 'Path not in allowed directories' },
        { status: 403 }
      );
    }

    // Open in Finder (macOS) - reveal the file
    const platform = process.platform;

    if (platform === 'darwin') {
      await execFileAsync('open', ['-R', resolvedPath]);
    } else if (platform === 'win32') {
      await execFileAsync('explorer', [`/select,${resolvedPath}`]);
    } else {
      // Linux - open containing folder
      await execFileAsync('xdg-open', [path.dirname(resolvedPath)]);
    }

    console.log(`[FILE] Revealed: ${resolvedPath}`);
    return NextResponse.json({ success: true, path: resolvedPath });
  } catch (error) {
    console.error('[FILE] Error revealing file:', error);
    return NextResponse.json(
      { error: 'Failed to reveal file' },
      { status: 500 }
    );
  }
}
