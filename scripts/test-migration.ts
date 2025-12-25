
import { db } from '../src/models/db.js';
import { createProject, getProjectByGitUrl, updateProject } from '../src/models/projectModel.js';
import process from 'process';

async function runTest() {
    console.log('--- Starting Migration Test ---');

    // 1. Initialize DB (should trigger migration if needed)
    console.log('Initializing DB...');
    await db.init();
    console.log('DB Initialized.');

    // 2. Check Schema (implicitly by using new fields)
    const timestamp = Date.now();
    const gitUrl = `https://github.com/test/repo-${timestamp}.git`;
    const path1 = `/tmp/test-path-${timestamp}-1`;
    const path2 = `/tmp/test-path-${timestamp}-2`;

    // 3. Create Project A with Git URL
    console.log(`Creating Project A with Git URL: ${gitUrl}`);
    const projA = await createProject({
        name: 'Project A',
        path: path1,
        gitRemoteUrl: gitUrl
    });
    console.log(`Project A ID: ${projA.id}`);

    // 4. Verify Project A retrieval by Git URL
    const fetchedA = await getProjectByGitUrl(gitUrl);
    if (!fetchedA || fetchedA.id !== projA.id) {
        throw new Error('Failed to retrieve Project A by Git URL');
    }
    console.log('Verified: Retrieved Project A by Git URL');

    // 5. Create Project B with SAME Git URL (Should return Project A)
    console.log('Creating Project B with SAME Git URL (Should return Project A)...');
    const projB = await createProject({
        name: 'Project B', // Should be ignored or update existing? createProject logic returns existing
        path: path2,      // Should update path of A
        gitRemoteUrl: gitUrl
    });

    if (projB.id !== projA.id) {
        throw new Error(`Expected Project B to have ID ${projA.id}, got ${projB.id}`);
    }
    console.log(`Verified: Project B resolved to Project A ID: ${projB.id}`);

    // Verify Project A's path was updated
    const updatedA = await getProjectByGitUrl(gitUrl);
    if (updatedA?.path !== path2) {
        throw new Error(`Expected Project A path to be updated to ${path2}, got ${updatedA?.path}`);
    }
    console.log('Verified: Project A path updated to matches Project B input');


    // 6. Test Non-Unique Paths (Manually create conflict if API prevents it, 
    // but createProject logic above updates path, so let's try lower level or just verify schema)
    // We can try to manually insert another project with same path but different Git URL
    const gitUrl2 = `https://github.com/test/repo-${timestamp}-2.git`;
    console.log(`Creating Project C with path '${path2}' (clash with A) but different Git URL: ${gitUrl2}`);

    // Note: Our ProjectModel.createProject generates ID based on path if gitURL is missing. 
    // If gitURL is present, it uses that check first. 
    // Here we provide gitURL2, so it shouldn't match A.
    // Schema should allow duplicate path.

    try {
        await new Promise<void>((resolve, reject) => {
            db.getDb().run(`
                INSERT INTO projects (id, name, path, git_remote_url, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [`proj-test-${timestamp}`, 'Project C', path2, gitUrl2, Date.now(), Date.now()], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('Verified: Successfully inserted Project C with duplicate path.');
    } catch (err) {
        console.error('Failed to create project with duplicate path:', err);
        throw new Error('Duplicate path test failed - UNIQUE constraint likely still exists');
    }

    console.log('--- Test Passed ---');
}

runTest().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
