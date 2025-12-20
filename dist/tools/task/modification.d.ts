import { z } from "zod";
import { deleteTaskSchema, clearAllTasksSchema, updateTaskContentSchema } from "./schemas.js";
export declare function deleteTask({ taskId }: z.infer<typeof deleteTaskSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
export declare function clearAllTasks({ confirm, }: z.infer<typeof clearAllTasksSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
export declare function updateTaskContent({ taskId, name, description, notes, relatedFiles, dependencies, implementationGuide, verificationCriteria, }: z.infer<typeof updateTaskContentSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
