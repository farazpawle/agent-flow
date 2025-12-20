/**
 * Migration Script: JSON to SQLite
 * Run with: npx tsx src/scripts/migrate-to-sqlite.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { db } from '../models/db.js';
import { DATA_DIR } from '../models/persistence.js';
async function migrate() {
    console.log('🔄 Starting migration from tasks.json to SQLite...');
    const jsonPath = path.join(DATA_DIR, 'tasks.json');
    const backupPath = path.join(DATA_DIR, 'tasks.json.bak');
    // 1. Check if tasks.json exists
    try {
        await fs.access(jsonPath);
    }
    catch {
        console.log('⚠️ tasks.json not found. Assuming empty database or fresh install.');
        // Still init DB
        await db.init();
        await db.close();
        return;
    }
    // 2. Read JSON
    console.log('📖 Reading tasks.json...');
    const data = await fs.readFile(jsonPath, 'utf-8');
    let tasks = [];
    try {
        const parsed = JSON.parse(data);
        tasks = parsed.tasks || [];
    }
    catch (e) {
        console.error('❌ Failed to parse tasks.json:', e);
        process.exit(1);
    }
    if (tasks.length === 0) {
        console.log('ℹ️ No tasks to migrate.');
    }
    // 3. Init DB
    console.log('🔌 Connecting to database...');
    await db.init();
    // 4. Batch Insert
    console.log(`💾 Migrating ${tasks.length} tasks...`);
    try {
        await db.saveTasks(tasks);
        console.log('✅ All tasks saved to SQLite.');
    }
    catch (e) {
        console.error('❌ Failed to save tasks to DB:', e);
        await db.close();
        process.exit(1);
    }
    // 5. Verify Count
    const dbTasks = await db.getAllTasks();
    if (dbTasks.length !== tasks.length) {
        console.error(`❌ Mismatch: JSON has ${tasks.length}, DB has ${dbTasks.length}`);
        // Don't rename file if mismatch
    }
    else {
        console.log('✅ Verification successful: Task counts match.');
        // 6. Rename JSON
        console.log('📦 Backing up tasks.json -> tasks.json.bak...');
        await fs.rename(jsonPath, backupPath);
        console.log('🎉 Migration complete!');
    }
    await db.close();
}
migrate().catch(console.error);
//# sourceMappingURL=migrate-to-sqlite.js.map