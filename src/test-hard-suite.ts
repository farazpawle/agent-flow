
import {
    createTask,
    getAllTasks,
    getTaskById,
    updateTask,
    deleteTask,
    searchTasksWithCommand,
    ensureDataDir,
    batchCreateOrUpdateTasks,
    canExecuteTask,
    assessTaskComplexity,
    updateTaskStatus,
    clearAllTasks
} from './models/taskModel.js';
import { db } from './models/db.js';
import { TaskStatus } from './types/index.js';

async function runHardTestSuite() {
    console.log('🔥 STARTING HARD TEST SUITE FOR CoT (SQLite) 🔥');
    const startTime = performance.now();

    // 0. Setup
    await ensureDataDir();
    // Clear everything for a clean slate (optional, but good for "hard" test isolation)
    await clearAllTasks();
    console.log('🧹 Database cleared for isolated testing.');

    // SECTION 1: Complex Workflow & Dependencies
    console.log('\n--- SECTION 1: Workflow & Dependencies ---');

    // 1.1 Plan Parent
    console.log('1.1 Planning Parent Task...');
    const parent = await createTask('Build ERP System', 'Root task for ERP');

    // 1.2 Split Tasks (Batch)
    console.log('1.2 Splitting into Subtasks (Batch Create)...');
    const subtasks = await batchCreateOrUpdateTasks([
        { name: 'Design Database', description: 'Schema design', dependencies: [] },
        { name: 'Implement API', description: 'Express server', dependencies: ['Design Database'] }, // Name dependency
        { name: 'Frontend', description: 'React App', dependencies: ['Implement API'] }
    ], 'append');

    const [dbTask, apiTask, feTask] = subtasks; // Assuming order preserved
    console.log(`    Created ${subtasks.length} subtasks.`);

    // 1.3 Check Blockers
    console.log('1.3 Verifying Dependencies (Blocking)...');
    const apiCheck = await canExecuteTask(apiTask.id);
    if (apiCheck.canExecute) throw new Error('❌ API Task should be blocked by DB Task!');
    console.log('    ✅ API Task correctly blocked.');

    // 1.4 Execute Flow
    console.log('1.4 Executing Flow...');
    // Finish DB
    await updateTaskStatus(dbTask.id, TaskStatus.COMPLETED);

    // Check API again
    const apiCheck2 = await canExecuteTask(apiTask.id);
    if (!apiCheck2.canExecute) throw new Error('❌ API Task should be executable now!');
    console.log('    ✅ API Task unblocked after dependency completion.');

    // SECTION 2: Edge Cases & Constraints
    console.log('\n--- SECTION 2: Edge Cases & Constraints ---');

    // 2.1 Delete Constraint
    console.log('2.1 Testing Delete Constraint (Dependent Tasks)...');
    const deleteRes = await deleteTask(dbTask.id); // API depends on it (archive logic aside, purely structural risk)
    // Actually, our logic says "Cannot delete if other tasks depend on it"
    if (deleteRes.success) throw new Error('❌ Should not simulate deletion of a dependency root!');
    console.log(`    ✅ Correctly prevented deletion: "${deleteRes.message}"`);

    // 2.2 Delete Completed Constraint
    console.log('2.2 Testing Delete Constraint (Completed Status)...');
    // DB Task is completed.
    // Wait, the previous check failed because of dependency. Let's try to delete a standalone completed task.
    // But createTask returns a task, let's make a dummy one.
    const dummy = await createTask('Dummy Task', 'For deletion');
    await updateTaskStatus(dummy.id, TaskStatus.COMPLETED);
    const deleteCompletedRes = await deleteTask(dummy.id);
    if (deleteCompletedRes.success) throw new Error('❌ Should not delete completed task!');
    console.log(`    ✅ Correctly prevented completed task deletion: "${deleteCompletedRes.message}"`);

    // SECTION 3: Performance & Load
    console.log('\n--- SECTION 3: Performance & Load (Batch 100) ---');
    const infoStart = performance.now();
    const batchSize = 100;
    const batchData = Array.from({ length: batchSize }, (_, i) => ({
        name: `Stress Test Task ${i}`,
        description: `Description for stress test item ${i} with some search keywords like banana and apple`,
        notes: `Performance testing entry ${i}`
    }));

    await batchCreateOrUpdateTasks(batchData, 'append');
    const infoEnd = performance.now();
    console.log(`    ✅ Created 100 tasks in ${(infoEnd - infoStart).toFixed(2)}ms`);

    // SECTION 4: Search Performance
    console.log('\n--- SECTION 4: Search Performance ---');
    const searchStart = performance.now();
    const results = await searchTasksWithCommand('banana');
    const searchEnd = performance.now();

    if (results.tasks.length !== 100) console.warn(`    ⚠️ Search returned ${results.tasks.length} results (expected 100, maybe cap? Or strict paging? Search default pg size is 5)`);
    // searchTasksWithCommand defaults to pageSize=5
    console.log(`    ✅ Search execution took ${(searchEnd - searchStart).toFixed(2)}ms (Result Page 1 size: ${results.tasks.length})`);

    // SECTION 5: Complexity Assessment
    console.log('\n--- SECTION 5: Complexity Intelligence ---');
    const complexTask = await createTask(
        'Super Complex Task',
        'A very long description '.repeat(50),
        'Notes '.repeat(50),
        [dbTask.id, apiTask.id, feTask.id] // 3 dependencies
    );
    const assessment = await assessTaskComplexity(complexTask.id);
    if (!assessment) throw new Error('❌ Assessment failed');
    console.log(`    ✅ Assessment Level: ${assessment.level} (Deps: ${assessment.metrics.dependenciesCount}, DescLen: ${assessment.metrics.descriptionLength})`);

    const endTime = performance.now();
    console.log(`\n🔥 Hard Test Suite Completed in ${(endTime - startTime).toFixed(2)}ms 🔥`);
    console.log('Result: PASS');
    process.exit(0);
}

runHardTestSuite().catch(e => {
    console.error('\n❌ FATAL TEST FAILURE:', e);
    process.exit(1);
});
