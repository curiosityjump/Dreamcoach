import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';
import { seedIfEmpty, resetAndSeed } from './seed.ts';

const port = Number(process.env.DC_PORT ?? process.env.PORT ?? 3000);
const dbFile = path.resolve(process.cwd(), process.env.DC_DB ?? 'data/dreamcoach.db');

if (process.env.DC_RESET_DB === '1') {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch { /* ignore */ }
  }
}

const db = openDatabase(dbFile);
if (process.env.DC_RESET_DB === '1') resetAndSeed(db);
else seedIfEmpty(db);

const app = createApp(db);
app.listen(port, () => {
  const hasClient = fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'));
  console.log(`Dream Coach API listening on http://localhost:${port}${hasClient ? '  (serving built client)' : '  (API only — run "npm run dev:client" or "npm run build")'}`);
  console.log(`Database: ${dbFile}`);
});
