import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

async function run() {
  const { db } = await import('../dist/models/db.js');

  await db.init();
  const tasks = await db.getAllTasks();

  let updated = 0;
  for (const t of tasks) {
    // Re-save to ensure columns like project_id/client_id are populated
    await db.saveTask(t);
    updated += 1;
  }

  console.log(`Backfill complete: re-saved ${updated} tasks`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
