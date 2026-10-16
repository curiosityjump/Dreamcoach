import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import type { DB } from './db.ts';
import { attachViewer } from './auth.ts';
import { HttpError } from './commands.ts';
import { authRouter } from './routes/auth.ts';
import { dreamersRouter } from './routes/dreamers.ts';
import { coachRouter, directorRouter } from './routes/staff.ts';

export function createApp(db: DB, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use('/api', attachViewer);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/dreamers', dreamersRouter);
  app.use('/api/coach', coachRouter);
  app.use('/api/director', directorRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.', code: 'not_found' }));

  // Serve the built client when present (production / demo mode).
  const staticDir = opts.staticDir ?? path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed request body.', code: 'invalid' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side.', code: 'server_error' });
  });
  return app;
}
