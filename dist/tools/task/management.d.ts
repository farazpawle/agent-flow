import { z } from "zod";
import { listTasksSchema, queryTaskSchema, getTaskDetailSchema, reorderTasksSchema } from "./schemas.js";
export declare function listTasks({ status, projectId }: z.infer<typeof listTasksSchema>): Promise<{
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
export declare function queryTask({ query, isId, page, pageSize, }: z.infer<typeof queryTaskSchema>): Promise<{
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
export declare function getTaskDetail({ taskId, }: z.infer<typeof getTaskDetailSchema>): Promise<{
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
export declare function reorderTasksTool({ projectId, taskIds }: z.infer<typeof reorderTasksSchema>): Promise<{
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
