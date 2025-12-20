
import { Database } from './models/db.js';
import { Task, TaskStatus, RelatedFileType } from './types/index.js';
import { v4 as uuidv4 } from 'uuid';

async function runUnitTests() {
    console.log('🧪 Starting Database Unit Tests...');

    // Use in-memory database for testing
    const db = new Database(':memory:');
    let errors = 0;

    const assert = (condition: boolean, message: string) => {
        if (!condition) {
            console.error(`❌ FAILED: ${message}`);
            errors++;
        } else {
            console.log(`✅ PASSED: ${message}`);
        }
    };

    try {
        // Test 1: Initialization
        await db.init();
        assert(true, 'Database initialization');

        // Test 2: Save Task
        const taskId = uuidv4();
        const task: Task = {
            id: taskId,
            name: 'Unit Test Task',
            description: 'Testing persistence layer',
            status: TaskStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            dependencies: [],
            relatedFiles: [
                {
                    path: 'test.ts',
                    type: RelatedFileType.TEST,
                    description: 'Test file'
                }
            ]
        };

        await db.saveTask(task);
        assert(true, 'Save task');

        // Test 3: Get Task
        const retrieved = await db.getTask(taskId);
        assert(retrieved !== null, 'Exclude null on retrieval');
        assert(retrieved?.id === taskId, 'Task ID mismatch');
        assert(retrieved?.name === 'Unit Test Task', 'Task name mismatch');
        assert(retrieved?.relatedFiles?.[0].type === RelatedFileType.TEST, 'Related file type persistence');

        // Test 4: Update Task
        if (retrieved) {
            retrieved.status = TaskStatus.IN_PROGRESS;
            retrieved.updatedAt = new Date();
            await db.saveTask(retrieved);

            const updated = await db.getTask(taskId);
            assert(updated?.status === TaskStatus.IN_PROGRESS, 'Update task status');
        }

        // Test 5: Delete Task
        await db.deleteTask(taskId);
        const deleted = await db.getTask(taskId);
        assert(deleted === null, 'Delete task');

        // Test 6: Batch Operations
        const tasks: Task[] = [];
        for (let i = 0; i < 5; i++) {
            tasks.push({
                id: uuidv4(),
                name: `Batch Task ${i}`,
                description: `Batch description ${i}`,
                status: TaskStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
                dependencies: []
            });
        }

        await db.saveTasks(tasks);

        const allTasks = await db.getAllTasks();
        // Note: getAllTasks might return tasks from previous runs if not memory DB, 
        // but since we use :memory:, it should be clean or only contain what we put in.
        // Wait, did we delete the first task? Yes.
        // So count should be 5.

        assert(allTasks.length === 5, `Batch save count (Expected 5, got ${allTasks.length})`);

        const foundBatchTask = allTasks.find(t => t.name === 'Batch Task 0');
        assert(!!foundBatchTask, 'Batch task retrieval');

    } catch (error) {
        console.error('🚨 Unexpected Error:', error);
        errors++;
    } finally {
        await db.close();
    }

    if (errors === 0) {
        console.log('✨ All persistence unit tests passed!');
        process.exit(0);
    } else {
        console.error(`💀 ${errors} tests failed.`);
        process.exit(1);
    }
}

runUnitTests().catch(e => {
    console.error('CRITICAL FAILURE:', e);
    process.exit(1);
});
