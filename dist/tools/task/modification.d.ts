import { z } from "zod";
import { deleteTaskSchema, updateTaskContentSchema } from "./schemas.js";
import { splitTasksSchema } from "./schemas.js";
export declare function deleteTask({ taskId, projectId, deleteAll, confirm }: z.infer<typeof deleteTaskSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function updateTaskContent({ taskId, name, description, notes, relatedFiles, dependencies, implementationGuide, verificationCriteria, projectId, }: z.infer<typeof updateTaskContentSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function splitTasks({ projectId, tasks, updateMode, inputStepId }: z.infer<typeof splitTasksSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
