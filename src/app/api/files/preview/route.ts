/**
 * File Preview API
 * Serves local files for preview in the browser.
 * Supports HTML (rendered), Markdown (rendered to HTML), and text (wrapped in <pre>).
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Maximum file size for preview (1MB)
const MAX_PREVIEW_SIZE = 1024 * 1024;

// Extensions that can be previewed as text
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.log', '.json', '.xml', '.yaml', '.yml',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.sh', '.bash', '.zsh', '.fish', '.toml', '.ini',
  '.cfg', '.conf', '.env.example', '.gitignore', '.dockerfile', '.sql', '.clj',
  '.cljs', '.cljc', '.edn', '.ex', '.exs', '.hs', '.lua', '.r', '.swift',
]);

/**
 * Simple Markdown to HTML renderer (no external dependencies)
 * Handles: headers, bold, italic, code blocks, inline code, links, lists, blockquotes, hr
 */
function renderMarkdown(md: string): string {
  let html = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Fenced code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) =>
      `<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${code.trim()}</code></pre>`)
    // Headers
    .replace(/^######\s+(.+)$/gm, '<h6 style="margin:16px 0 8px;color:#cba6f7">$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5 style="margin:16px 0 8px;color:#cba6f7">$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4 style="margin:20px 0 8px;color:#cba6f7">$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3 style="margin:24px 0 8px;color:#cba6f7;font-size:1.1em">$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2 style="margin:28px 0 12px;color:#89b4fa;font-size:1.3em;border-bottom:1px solid #313244;padding-bottom:8px">$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1 style="margin:28px 0 16px;color:#89b4fa;font-size:1.6em;border-bottom:2px solid #313244;padding-bottom:8px">$1</h1>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #313244;margin:24px 0">')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f5e0dc">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em style="color:#f5c2e7">$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#313244;color:#a6e3a1;padding:2px 6px;border-radius:4px;font-size:0.9em">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#89b4fa;text-decoration:underline">$1</a>')
    // Blockquotes
    .replace(/^&gt;\s+(.+)$/gm, '<blockquote style="border-left:3px solid #585b70;padding:4px 12px;margin:8px 0;color:#a6adc8;background:#1e1e2e;border-radius:0 4px 4px 0">$1</blockquote>')
    // Unordered lists
    .replace(/^[-*]\s+(.+)$/gm, '<li style="margin:4px 0;list-style-type:disc;margin-left:20px">$1</li>')
    // Ordered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li style="margin:4px 0;list-style-type:decimal;margin-left:20px">$1</li>')
    // Tables - header
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '<!-- table-separator -->';
      return '<tr>' + cells.map(c => `<td style="padding:8px 12px;border:1px solid #313244">${c}</td>`).join('') + '</tr>';
    })
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p style="margin:8px 0;line-height:1.6">')
    // Single newlines → <br>
    .replace(/\n/g, '<br>');

  // Clean up table separators
  html = html.replace(/<!-- table-separator -->/g, '');

  // Wrap tables
  html = html.replace(/(<tr>[\s\S]*?<\/tr>)/g, (tableContent) => {
    return `<table style="border-collapse:collapse;width:100%;margin:12px 0">${tableContent}</table>`;
  });

  return html;
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  // Expand tilde and normalize
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

  // Security check - only allow paths from environment config
  const allowedPaths = [
    process.env.WORKSPACE_BASE_PATH?.replace(/^~/, process.env.HOME || ''),
    process.env.PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
  ].filter(Boolean) as string[];

  const isAllowed = allowedPaths.length === 0 || allowedPaths.some(allowed =>
    normalizedPath.startsWith(path.normalize(allowed))
  );

  if (!isAllowed) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
  }

  if (!existsSync(normalizedPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Check file size
  const stats = statSync(normalizedPath);
  if (stats.size > MAX_PREVIEW_SIZE) {
    return NextResponse.json(
      { error: `File too large for preview (${(stats.size / 1024).toFixed(0)}KB, max ${MAX_PREVIEW_SIZE / 1024}KB)` },
      { status: 400 }
    );
  }

  try {
    const content = readFileSync(normalizedPath, 'utf-8');
    const fileName = path.basename(normalizedPath);

    // HTML files — serve directly
    if (isHtml) {
      return new NextResponse(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Build a styled HTML wrapper for non-HTML files
    const pageStyle = `
      body {
        margin: 0; padding: 24px 32px;
        background: #181825; color: #cdd6f4;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px; line-height: 1.6;
      }
      .header {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 16px; margin: -24px -32px 24px;
        background: #11111b; border-bottom: 1px solid #313244;
        font-family: monospace; font-size: 13px; color: #a6adc8;
      }
      .header .filename { color: #89b4fa; font-weight: 600; }
      .header .size { color: #585b70; }
      .content { max-width: 860px; }
      pre.raw {
        background: #1e1e2e; color: #cdd6f4;
        padding: 16px; border-radius: 8px;
        overflow-x: auto; font-size: 13px; line-height: 1.5;
        white-space: pre-wrap; word-wrap: break-word;
      }
    `;

    let bodyContent: string;
    if (isMarkdown) {
      bodyContent = `<div class="content">${renderMarkdown(content)}</div>`;
    } else {
      // Plain text / code — wrap in <pre>
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      bodyContent = `<pre class="raw">${escaped}</pre>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fileName} — Mission Control Preview</title>
  <style>${pageStyle}</style>
</head><body>
  <div class="header">
    <span class="filename">${fileName}</span>
    <span class="size">${(stats.size / 1024).toFixed(1)}KB</span>
  </div>
  ${bodyContent}
</body></html>`;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('[FILE] Error reading file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
