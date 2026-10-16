import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from './db.ts';
import { resetAndSeed } from './seed.ts';

const dbFile = path.resolve(process.cwd(), process.env.DC_DB ?? 'data/dreamcoach.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch { /* ignore */ }
}
const db = openDatabase(dbFile);
const summary = resetAndSeed(db);
console.log(`Seeded ${dbFile}`);
console.log(summary);
