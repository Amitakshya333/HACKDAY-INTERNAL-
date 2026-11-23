/**
 * MAOS Oasis — Sovereign Preview Server & Dispatcher
 * Local loopback static server with dynamic port fallback and runtime error overlay.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { getLatestSessionId, loadSession } from './session-manager';

export const PREVIEW_ERROR_OVERLAY = `<script>(function(){function show(m){var d=document.getElementById('maos-preview-error');if(!d){d=document.createElement('pre');d.id='maos-preview-error';d.setAttribute('role','alert');d.style.cssText='position:fixed;left:0;right:0;bottom:0;margin:0;padding:12px 16px;max-height:40vh;overflow:auto;background:#3f0d1a;color:#fecdd3;font:13px/1.4 monospace;z-index:2147483647;white-space:pre-wrap';(document.body||document.documentElement).appendChild(d);}d.textContent+=(d.textContent?'\\n':'MAOS preview runtime error:\\n')+m;}window.addEventListener('error',function(e){show(e.message+(e.filename?' ('+e.filename.split('/').pop()+':'+e.lineno+')':''));});window.addEventListener('unhandledrejection',function(e){show('Unhandled promise rejection: '+(e.reason&&e.reason.message||e.reason));});})();</script>`;

export interface ResolvedPreviewTarget {
  entrypoint: string | null;
  relPath: string;
  filesCount: number;
  outputDir: string;
}

export interface PreviewServerInstance {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Deterministically locates the active preview file for the workspace.
 */
export function resolvePreviewTarget(projectRoot: string): ResolvedPreviewTarget {
  let entrypoint: string | null = null;
  let filesCount = 0;
  let outputDir = path.resolve(projectRoot, 'output');

  // 1. Session manifest
  try {
    const latestId = getLatestSessionId(projectRoot);
    if (latestId) {
      const session = loadSession(projectRoot, latestId);
      const lastTask = session?.tasks?.length ? session.tasks[session.tasks.length - 1] : null;
      if (lastTask?.outputDir) outputDir = path.resolve(projectRoot, lastTask.outputDir);
      if (lastTask?.previewEntry) {
        const candidate = path.resolve(projectRoot, lastTask.previewEntry);
        if (fs.existsSync(candidate)) entrypoint = candidate;
      }
      if (Array.isArray(lastTask?.filesWritten)) {
        filesCount = lastTask.filesWritten.length;
      }
    }
  } catch {}

  // 2. Fallbacks
  const outputHtml = path.resolve(outputDir, 'index.html');
  const distHtml = path.resolve(projectRoot, 'dist-preview', 'index.html');
  const rootHtml = path.resolve(projectRoot, 'index.html');

  if (!entrypoint || !fs.existsSync(entrypoint)) {
    if (fs.existsSync(outputHtml)) entrypoint = outputHtml;
    else if (fs.existsSync(distHtml)) entrypoint = distHtml;
    else if (fs.existsSync(rootHtml)) entrypoint = rootHtml;
  }

  const relPath = entrypoint ? path.relative(projectRoot, entrypoint).replace(/\\/g, '/') : '';
  return { entrypoint, relPath, filesCount, outputDir };
}

/**
 * Cross-platform system browser launcher for local loopback URLs.
 */
export function launchBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/d', '/s', '/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    child_process.execFile(command, args, () => {});
  } catch {}
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Starts a sovereign local static HTTP server bound strictly to loopback (127.0.0.1).
 */
export async function startPreviewServer(projectRoot: string, preferredPort = 3030): Promise<PreviewServerInstance> {
  const target = resolvePreviewTarget(projectRoot);

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrl = req.url?.split('?')[0] || '/';
    const decodedUrl = decodeURIComponent(rawUrl);
    const rel = decodedUrl.startsWith('/') ? decodedUrl.slice(1) : decodedUrl;

    const isRoot = !rel || rel === '' || rel === 'index.html' || rel === 'output/index.html';
    const candidates: string[] = [];

    if (isRoot) {
      if (target.entrypoint && fs.existsSync(target.entrypoint)) {
        candidates.push(target.entrypoint);
      }
      candidates.push(
        path.resolve(target.outputDir, 'index.html'),
        path.resolve(projectRoot, 'output', 'index.html'),
        path.resolve(projectRoot, 'dist-preview', 'index.html'),
        path.resolve(projectRoot, 'index.html'),
      );
    } else {
      const within = (base: string) => {
        const resolved = path.resolve(base, rel);
        return resolved.startsWith(path.resolve(base) + path.sep) ? resolved : null;
      };
      const bases = [
        target.outputDir,
        path.resolve(projectRoot, 'output'),
        path.resolve(projectRoot, 'dist-preview'),
        projectRoot,
      ];
      for (const b of bases) {
        const p = within(b);
        if (p) candidates.push(p);
      }
    }

    let filePath: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        filePath = c;
        break;
      }
    }

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;"><h2>404 — Artifact Not Found</h2><p>File not found for request: <code>${rawUrl}</code></p></body></html>`,
      );
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (ext === '.html') {
      let html = fs.readFileSync(filePath, 'utf-8');
      if (!html.includes('id="maos-preview-error"')) {
        html = html.includes('</body>')
          ? html.replace('</body>', `${PREVIEW_ERROR_OVERLAY}</body>`)
          : `${html}${PREVIEW_ERROR_OVERLAY}`;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  return new Promise((resolve, reject) => {
    let port = preferredPort;
    const maxPort = preferredPort + 10;

    const tryListen = () => {
      server.removeAllListeners('error');
      server.removeAllListeners('listening');

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < maxPort) {
          port++;
          tryListen();
        } else {
          reject(err);
        }
      });

      server.on('listening', () => {
        const url = `http://localhost:${port}/${target.relPath || 'output/index.html'}`;
        resolve({
          server,
          port,
          url,
          close: () =>
            new Promise((resClose) => {
              server.close(() => resClose());
            }),
        });
      });

      server.listen(port, '127.0.0.1');
    };

    tryListen();
  });
}
