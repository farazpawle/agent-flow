import { db } from '../dist/models/db.js';

async function main() {
  await db.init();
  const database = db.getDb();

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      database.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      database.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

  const out = {
    tables: await all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
    projects_count: await get('SELECT COUNT(*) as c FROM projects'),
    tasks_count: await get('SELECT COUNT(*) as c FROM tasks'),
    tasks_by_project_id: await all('SELECT project_id, COUNT(*) as c FROM tasks GROUP BY project_id ORDER BY c DESC'),
    sample_tasks: await all('SELECT id, name, status, project_id FROM tasks ORDER BY created_at DESC LIMIT 10')
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('DB inspect failed:', err);
  process.exitCode = 1;
});
