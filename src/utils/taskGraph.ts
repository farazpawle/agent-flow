
import { Task } from '../types/index.js';

/**
 * Task Graph Utility
 * Handles topological sorting and atomic group management for execution ordering.
 */
export class TaskGraph {
    private tasks: Map<string, Task>;
    private adj: Map<string, string[]>; // id -> dependants
    private inDegree: Map<string, number>; // id -> number of dependencies

    constructor(tasks: Task[]) {
        this.tasks = new Map(tasks.map(t => [t.id, t]));
        this.adj = new Map();
        this.inDegree = new Map();

        // Initialize
        tasks.forEach(t => {
            this.adj.set(t.id, []);
            this.inDegree.set(t.id, 0);
        });

        // Build Graph
        tasks.forEach(task => {
            task.dependencies.forEach(dep => {
                const depId = dep.taskId;
                if (this.tasks.has(depId)) {
                    this.adj.get(depId)!.push(task.id);
                    this.inDegree.set(task.id, (this.inDegree.get(task.id) || 0) + 1);
                }
            });
        });
    }

    /**
     * Identify Connected Components (Dependency Chains)
     * Returns list of "Cluster" objects, where each cluster is a set of task IDs.
     * Uses BFS/DFS to find all connected nodes (ignoring direction for grouping).
     */
    public getComponents(): string[][] {
        const visited = new Set<string>();
        const components: string[][] = [];

        // Build undirected graph for component finding
        const undirected = new Map<string, string[]>();
        this.tasks.forEach(t => undirected.set(t.id, []));

        this.tasks.forEach(task => {
            task.dependencies.forEach(dep => {
                if (this.tasks.has(dep.taskId)) {
                    undirected.get(task.id)!.push(dep.taskId);
                    undirected.get(dep.taskId)!.push(task.id);
                }
            });
        });

        for (const taskId of this.tasks.keys()) {
            if (!visited.has(taskId)) {
                const component: string[] = [];
                const queue = [taskId];
                visited.add(taskId);

                while (queue.length > 0) {
                    const current = queue.shift()!;
                    component.push(current);

                    const neighbors = undirected.get(current) || [];
                    for (const neighbor of neighbors) {
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.push(neighbor);
                        }
                    }
                }
                components.push(component);
            }
        }

        return components;
    }

    /**
     * Sorts tasks within a component topologically.
     */
    public topologicalSort(componentIds: string[]): string[] {
        const subsetInDegree = new Map<string, number>();
        const componentSet = new Set(componentIds);

        // precise in-degree for this subset
        componentIds.forEach(id => {
            subsetInDegree.set(id, 0);
        });

        componentIds.forEach(id => {
            const task = this.tasks.get(id)!;
            task.dependencies.forEach(dep => {
                if (componentSet.has(dep.taskId)) {
                    subsetInDegree.set(id, (subsetInDegree.get(id) || 0) + 1);
                }
            });
        });

        const queue: string[] = [];
        componentIds.forEach(id => {
            if (subsetInDegree.get(id) === 0) queue.push(id);
        });

        const sorted: string[] = [];
        while (queue.length > 0) {
            // Sort queue to ensure deterministic behavior based on User Intent (executionOrder)
            // Primary Sort: executionOrder (Ascending)
            // Secondary Sort: createdAt (Ascending) - Fallback
            queue.sort((aId, bId) => {
                const taskA = this.tasks.get(aId)!;
                const taskB = this.tasks.get(bId)!;

                // Use undefined check because 0 is falsy but valid
                const orderA = taskA.executionOrder !== undefined ? taskA.executionOrder : Number.MAX_SAFE_INTEGER;
                const orderB = taskB.executionOrder !== undefined ? taskB.executionOrder : Number.MAX_SAFE_INTEGER;

                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return taskA.createdAt.getTime() - taskB.createdAt.getTime();
            });

            const current = queue.shift()!;
            sorted.push(current);

            const neighbors = this.adj.get(current) || [];
            neighbors.forEach(neighbor => {
                if (componentSet.has(neighbor)) {
                    subsetInDegree.set(neighbor, subsetInDegree.get(neighbor)! - 1);
                    if (subsetInDegree.get(neighbor) === 0) {
                        queue.push(neighbor);
                    }
                }
            });
        }

        // If cycle detected (sorted < component), fallback to original order or explicit handling
        if (sorted.length !== componentIds.length) {
            // Cycle fallback: just append remaining
            const remaining = componentIds.filter(id => !sorted.includes(id));
            return [...sorted, ...remaining];
        }

        return sorted;
    }

    /**
     * Main function to recalculate all orders
     */
    public recalculateOrder(): Task[] {
        const components = this.getComponents();

        // 1. Sort components based on the "Min Execution Order" of their current tasks 
        // OR creation time if new.
        // We want to preserve user intent. If User moved a block to Order 10, we keep it there.
        // Heuristic: Calculate average or min executionOrder of tasks in the component.

        const componentMeta = components.map(compIds => {
            const orders = compIds.map(id => this.tasks.get(id)!.executionOrder || 0);
            const minOrder = Math.min(...orders);
            const createdTime = Math.min(...compIds.map(id => this.tasks.get(id)!.createdAt.getTime()));
            return { compIds, minOrder, createdTime };
        });

        // Sort components by their current position (User Intent)
        componentMeta.sort((a, b) => {
            if (a.minOrder !== b.minOrder) return a.minOrder - b.minOrder;
            return a.createdTime - b.createdTime; // Fallback
        });

        // 2. Linearize
        const finalTasks: Task[] = [];
        let globalCounter = 0;

        for (const meta of componentMeta) {
            const sortedIds = this.topologicalSort(meta.compIds);
            for (const id of sortedIds) {
                const task = this.tasks.get(id)!;
                task.executionOrder = globalCounter++;
                finalTasks.push(task);
            }
        }

        return finalTasks;
    }
}
