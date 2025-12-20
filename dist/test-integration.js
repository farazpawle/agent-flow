/**
 * Integration Test Script for MCP Chain-of-Thought Tools
 * Tests all tools to verify SQLite database integration
 */
import { db } from './models/db.js';
import { createProject, getAllProjects, getProjectById, getOrCreateProjectFromPath } from './models/projectModel.js';
import { createTask, getAllTasks, getTaskById, updateTaskStatus, getTasksByProject } from './models/taskModel.js';
import { TaskStatus } from './types/index.js';
const TEST_PROJECT_PATH = process.cwd();
async function testProjectTools() {
    console.log('\n========== Testing Project Tools ==========\n');
    try {
        // Initialize DB
        await db.init();
        console.log('✅ Database initialized');
        // Test 1: Create Project
        console.log('\n📝 Test 1: Create Project');
        const project = await createProject({
            name: 'Test MCP Project',
            description: 'A test project for verifying MCP tool integration with SQLite',
            path: TEST_PROJECT_PATH,
            techStack: ['TypeScript', 'SQLite', 'Node.js']
        });
        console.log('✅ Project created:', {
            id: project.id,
            name: project.name,
            description: project.description?.substring(0, 50) + '...'
        });
        // Test 2: Get All Projects
        console.log('\n📝 Test 2: Get All Projects');
        const projects = await getAllProjects(true);
        console.log(`✅ Found ${projects.length} project(s)`);
        projects.forEach(p => {
            console.log(`   - ${p.name} (${p.taskCount || 0} tasks)`);
        });
        // Test 3: Get Project by ID
        console.log('\n📝 Test 3: Get Project by ID');
        const retrievedProject = await getProjectById(project.id);
        if (retrievedProject) {
            console.log('✅ Retrieved project:', retrievedProject.name);
        }
        else {
            console.log('❌ Failed to retrieve project');
        }
        // Test 4: Get or Create from Path
        console.log('\n📝 Test 4: Get or Create Project from Path');
        const pathProject = await getOrCreateProjectFromPath(TEST_PROJECT_PATH);
        console.log('✅ Project from path:', pathProject.name);
        console.log('   Same as created?', pathProject.id === project.id ? '✅ Yes' : '❌ No');
        return project;
    }
    catch (error) {
        console.error('❌ Error in project tools:', error);
        throw error;
    }
}
async function testTaskTools(projectId) {
    console.log('\n========== Testing Task Tools ==========\n');
    try {
        // Test 5: Create Task with Project ID
        console.log('\n📝 Test 5: Create Task with Project ID');
        const task = await createTask('Test SQLite Integration', 'Verify that tasks are properly saved to and retrieved from SQLite database', 'This is a test task to ensure project_id column works correctly', [], [], projectId);
        console.log('✅ Task created:', {
            id: task.id,
            name: task.name,
            projectId: task.projectId
        });
        console.log('   Has project_id?', task.projectId ? '✅ Yes' : '❌ No');
        // Test 6: Get All Tasks
        console.log('\n📝 Test 6: Get All Tasks');
        const allTasks = await getAllTasks();
        console.log(`✅ Found ${allTasks.length} task(s) in database`);
        // Test 7: Get Tasks by Project
        console.log('\n📝 Test 7: Get Tasks by Project');
        const projectTasks = await getTasksByProject(projectId);
        console.log(`✅ Found ${projectTasks.length} task(s) for project`);
        projectTasks.forEach(t => {
            console.log(`   - ${t.name} [${t.status}]`);
        });
        // Test 8: Get Task by ID
        console.log('\n📝 Test 8: Get Task by ID');
        const retrievedTask = await getTaskById(task.id);
        if (retrievedTask) {
            console.log('✅ Retrieved task:', retrievedTask.name);
            console.log('   Status:', retrievedTask.status);
            console.log('   Project ID:', retrievedTask.projectId);
        }
        else {
            console.log('❌ Failed to retrieve task');
        }
        // Test 9: Update Task Status
        console.log('\n📝 Test 9: Update Task Status');
        const updatedTask = await updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
        if (updatedTask) {
            console.log('✅ Status updated to:', updatedTask.status);
        }
        else {
            console.log('❌ Failed to update status');
        }
        // Test 10: Complete Task
        console.log('\n📝 Test 10: Complete Task');
        const completedTask = await updateTaskStatus(task.id, TaskStatus.COMPLETED);
        if (completedTask) {
            console.log('✅ Task completed');
            console.log('   Completed at:', completedTask.completedAt);
        }
        else {
            console.log('❌ Failed to complete task');
        }
        return task;
    }
    catch (error) {
        console.error('❌ Error in task tools:', error);
        throw error;
    }
}
async function testDatabaseIntegrity() {
    console.log('\n========== Testing Database Integrity ==========\n');
    try {
        // Ensure DB is initialized
        await db.init();
        // Wait a bit for DB to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        // Verify tables exist
        console.log('\n📝 Checking Database Tables');
        // Check if db is ready
        const dbInstance = db.getDb();
        if (!dbInstance) {
            throw new Error('Database not initialized properly');
        }
        const tableCheck = await new Promise((resolve, reject) => {
            dbInstance.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        console.log('✅ Database tables:');
        tableCheck.forEach((table) => {
            console.log(`   - ${table.name}`);
        });
        // Verify tasks table has project_id column
        console.log('\n📝 Checking tasks table schema');
        const schemaCheck = await new Promise((resolve, reject) => {
            dbInstance.all("PRAGMA table_info(tasks)", (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        const hasProjectId = schemaCheck.some((col) => col.name === 'project_id');
        console.log('   Has project_id column?', hasProjectId ? '✅ Yes' : '❌ No');
        const hasClientId = schemaCheck.some((col) => col.name === 'client_id');
        console.log('   Has client_id column?', hasClientId ? '✅ Yes' : '❌ No');
        // Verify indexes
        console.log('\n📝 Checking Database Indexes');
        const indexCheck = await new Promise((resolve, reject) => {
            dbInstance.all("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'", (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        console.log('✅ Database indexes:');
        indexCheck.forEach((idx) => {
            console.log(`   - ${idx.name}`);
        });
    }
    catch (error) {
        console.error('❌ Error checking database:', error);
        throw error;
    }
}
async function runAllTests() {
    console.log('\n🚀 Starting Integration Tests...\n');
    console.log('================================================');
    try {
        // Test database integrity first
        await testDatabaseIntegrity();
        // Test project tools
        const project = await testProjectTools();
        // Test task tools with created project
        await testTaskTools(project.id);
        console.log('\n================================================');
        console.log('\n✅ ALL TESTS PASSED!\n');
        process.exit(0);
    }
    catch (error) {
        console.log('\n================================================');
        console.error('\n❌ TESTS FAILED:', error);
        console.log('\n');
        process.exit(1);
    }
}
// Run tests
runAllTests();
//# sourceMappingURL=test-integration.js.map