import { createTask, getTaskById, updateTask, deleteTask, searchTasksWithCommand, ensureDataDir } from './models/taskModel.js';
import { db } from './models/db.js';
import { taskEvents, TASK_EVENTS } from './utils/events.js';
async function testSQLite() {
    console.log('🧪 Starting SQLite Verification Test...');
    // 1. Init
    await ensureDataDir();
    console.log('✅ DB Initialized');
    // Listener
    let eventCount = 0;
    taskEvents.on(TASK_EVENTS.UPDATED, () => {
        eventCount++;
    });
    // 2. Create Task
    console.log('📝 Creating Task...');
    const task = await createTask('Test Task', 'Description for test');
    console.log(`   Task created: ${task.id}`);
    // Verify DB direct
    const rawTask = await db.getTask(task.id);
    if (!rawTask || rawTask.name !== 'Test Task')
        throw new Error('DB persistence failed');
    console.log('✅ Task persisted in SQLite');
    // 3. Update Task
    console.log('📝 Updating Task...');
    await updateTask(task.id, { description: 'Updated Desc' });
    const updated = await getTaskById(task.id);
    if (updated?.description !== 'Updated Desc')
        throw new Error('Update failed');
    console.log('✅ Task updated');
    // 4. Search
    console.log('🔍 Searching...');
    // Allow index update async
    await new Promise(r => setTimeout(r, 100));
    const results = await searchTasksWithCommand('Updated');
    if (results.tasks.length === 0 || results.tasks[0].id !== task.id) {
        console.error('Search results:', results);
        throw new Error('Search failed to find updated task');
    }
    console.log('✅ Search found task (MiniSearch + DB)');
    // 5. Delete
    console.log('🗑️ Deleting Task...');
    await deleteTask(task.id);
    const deleted = await getTaskById(task.id);
    if (deleted)
        throw new Error('Delete failed - task still exists');
    console.log('✅ Task deleted');
    // 6. Verify Events
    if (eventCount < 3)
        console.warn(`⚠️ Expected 3 events (Create, Update, Delete), got ${eventCount}`);
    else
        console.log(`✅ Events emitted: ${eventCount}`);
    console.log('🎉 SQLite Verification Passed!');
    process.exit(0);
}
testSQLite().catch(e => {
    console.error('❌ Test Failed:', e);
    process.exit(1);
});
//# sourceMappingURL=test-sqlite.js.map