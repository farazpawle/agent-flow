import { z } from "zod";
import { splitTasksSchema, listTasksSchema, queryTaskSchema, getTaskDetailSchema } from "./schemas.js";
export declare function splitTasks({ updateMode, tasks, globalAnalysisResult, }: z.infer<typeof splitTasksSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    ephemeral?: undefined;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    ephemeral: {
        taskCreationResult: {
            success: boolean;
            message: string;
            backupFilePath: string | undefined;
        };
    };
}>;
export declare function listTasks({ status }: z.infer<typeof listTasksSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
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
