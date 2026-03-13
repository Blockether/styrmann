import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync, realpathSync } from 'fs';
import path from 'path';
import { marked } from 'marked';
import { getStoredArtifactByPath } from '@/lib/task-run-results';
import { getDeliverableStoreDir } from '@/lib/deliverable-store';

export const dynamic = 'force-dynamic';

const MAX_PREVIEW_SIZE = 1024 * 1024;
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPathInside(basePath: string, targetPath: string): boolean {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${path.sep}`);
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.log', '.json', '.xml', '.yaml', '.yml',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.sh', '.bash', '.zsh', '.fish', '.toml', '.ini',
  '.cfg', '.conf', '.env.example', '.gitignore', '.dockerfile', '.sql', '.clj',
  '.cljs', '.cljc', '.edn', '.ex', '.exs', '.hs', '.lua', '.r', '.swift',
]);

const LIGHT_THEME_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 32px;
    background: #fdf4e5; color: #333;
    font-family: 'IBM Plex Mono', 'SF Mono', Menlo, monospace;
    font-size: 15px; line-height: 1.7;
  }
  .header {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; margin: -24px -32px 24px;
    background: #fff; border-bottom: 1px solid #e5d5b8;
    font-size: 13px; color: #666;
  }
  .header .file-info { display: flex; align-items: center; gap: 8px; }
  .header .filename { color: #b8960c; font-weight: 600; }
  .header .size { color: #999; }
  .content { max-width: 860px; width: 100%; overflow-wrap: anywhere; word-break: break-word; }
  .content h1 { font-size: 1.6em; margin: 28px 0 16px; color: #333; border-bottom: 2px solid #e5d5b8; padding-bottom: 8px; }
  .content h2 { font-size: 1.3em; margin: 24px 0 12px; color: #333; border-bottom: 1px solid #e5d5b8; padding-bottom: 6px; }
  .content h3 { font-size: 1.1em; margin: 20px 0 8px; color: #444; }
  .content h4, .content h5, .content h6 { margin: 16px 0 8px; color: #555; }
  .content p { margin: 10px 0; }
  .content a { color: #b8960c; text-decoration: underline; }
  .content a:hover { color: #8a7009; }
  .content strong { color: #222; }
  .content em { color: #555; }
  .content code {
    background: #f0e6d0; color: #7a5c00; padding: 2px 6px;
    border-radius: 4px; font-size: 0.9em;
  }
  .content pre {
    background: #fff; color: #333; padding: 16px;
    border-radius: 8px; border: 1px solid #e5d5b8;
    overflow-x: auto; font-size: 13px; line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .content pre code { background: none; color: inherit; padding: 0; }
  .content blockquote {
    border-left: 3px solid #b8960c; padding: 4px 16px; margin: 12px 0;
    color: #666; background: #fff; border-radius: 0 6px 6px 0;
  }
  .content ul, .content ol { padding-left: 24px; margin: 8px 0; }
  .content li { margin: 4px 0; }
  .content hr { border: none; border-top: 1px solid #e5d5b8; margin: 24px 0; }
  .content .table-scroll { overflow-x: auto; margin: 16px 0; border: 1px solid #e5d5b8; border-radius: 8px; background: #fff; }
  .content table { border-collapse: collapse; width: max-content; min-width: 100%; margin: 0; }
  .content .mermaid-wrapper { overflow-x: auto; margin: 16px 0; border: 1px solid #e5d5b8; border-radius: 8px; background: #fff; padding: 12px; }
  .content pre.mermaid { background: transparent; border: 0; padding: 0; margin: 0; white-space: pre; word-break: normal; }
  .content th {
    background: #fff; color: #333; font-weight: 600;
    padding: 10px 14px; border: 1px solid #e5d5b8; text-align: left;
  }
  .content td { padding: 8px 14px; border: 1px solid #e5d5b8; }
  .content tr:nth-child(even) { background: #faf0dc; }
  .content img { max-width: 100%; border-radius: 6px; }
  pre.raw {
    background: #fff; color: #333; padding: 16px;
    border-radius: 8px; border: 1px solid #e5d5b8;
    overflow-x: auto; font-size: 13px; line-height: 1.5;
    white-space: pre-wrap; word-wrap: break-word;
  }
  @media (max-width: 640px) {
    body { padding: 16px; font-size: 14px; }
    .header { margin: -16px -16px 16px; padding: 10px 12px; }
    .content pre, pre.raw { padding: 12px; font-size: 12px; }
    .content th, .content td { padding: 8px 10px; }
  }
`;

function wrapMarkdownTables(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table>$1</table></div>');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function wrapMermaidBlocks(html: string): string {
  return html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_match, code) => {
    const decoded = decodeHtmlEntities(String(code)).trim();
    return `<div class="mermaid-wrapper"><pre class="mermaid">${decoded}</pre></div>`;
  });
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
  const normalizedPath = path.normalize(expandedPath);
  const ext = path.extname(normalizedPath).toLowerCase();
  const isHtml = ext === '.html' || ext === '.htm';
  const isMarkdown = ext === '.md' || ext === '.markdown';
  const isText = TEXT_EXTENSIONS.has(ext);

  if (!isHtml && !isMarkdown && !isText) {
    return NextResponse.json(
      { error: `Unsupported file type: ${ext}. Supported: .html, .md, and common text files.` },
      { status: 400 }
    );
  }

  const allowedPaths = [
    process.env.STYRMAN_PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
    getDeliverableStoreDir(),
  ].filter(Boolean) as string[];

  let pathToRead = normalizedPath;

  const normalizedAllowedPaths = allowedPaths.map((allowed) => path.normalize(allowed));
  const resolvedAllowedPaths = normalizedAllowedPaths.map((allowed) => {
    try {
      return realpathSync(allowed);
    } catch {
      return allowed;
    }
  });

  const initialAllowed = normalizedAllowedPaths.length > 0 && normalizedAllowedPaths.some((allowed) =>
    isPathInside(allowed, normalizedPath)
  );

  if (!initialAllowed) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
  }

  const storedArtifact = !existsSync(normalizedPath) ? getStoredArtifactByPath(normalizedPath) : null;
  if (!existsSync(normalizedPath) && !storedArtifact) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  if (existsSync(normalizedPath)) {
    try {
      const resolvedPath = realpathSync(normalizedPath);
      const resolvedAllowed = resolvedAllowedPaths.length > 0 && resolvedAllowedPaths.some((allowed) =>
        isPathInside(allowed, resolvedPath)
      );
      if (!resolvedAllowed) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
      }
      pathToRead = resolvedPath;
    } catch {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
    }
  }

  const stats = existsSync(pathToRead) ? statSync(pathToRead) : null;
  if (stats && stats.size > MAX_PREVIEW_SIZE) {
    return NextResponse.json(
      { error: `File too large for preview (${(stats.size / 1024).toFixed(0)}KB, max ${MAX_PREVIEW_SIZE / 1024}KB)` },
      { status: 400 }
    );
  }

  try {
    const content = storedArtifact
      ? storedArtifact.content_text
      : readFileSync(pathToRead, 'utf-8');
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Stored preview is not available for this file type' }, { status: 404 });
    }

    const fileName = path.basename(pathToRead);
    const escapedFileName = escapeHtml(fileName);
    const escapedContent = escapeHtml(content);
    const markdownHtml = isMarkdown
      ? wrapMermaidBlocks(wrapMarkdownTables(String(marked.parse(escapedContent, { gfm: true, breaks: true }))))
      : null;
    const bodyContent = isMarkdown
      ? `<div class="content">${typeof markdownHtml === 'string' ? markdownHtml : ''}</div>`
      : `<pre class="raw">${escapedContent}</pre>`;

    const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedFileName} — Blockether Preview</title>
  <style>${LIGHT_THEME_CSS}</style>
</head><body>
  <div class="header">
    <div class="file-info">
      <span class="filename">${escapedFileName}</span>
      <span class="size">${(((storedArtifact?.size_bytes ?? stats?.size) || 0) / 1024).toFixed(1)}KB</span>
    </div>
  </div>
  ${bodyContent}
  <script type="module">
    import mermaid from '${MERMAID_CDN}';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  </script>
</body></html>`;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('[FILE] Error reading file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
