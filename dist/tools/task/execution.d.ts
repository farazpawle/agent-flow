import { z } from "zod";
import { executeTaskSchema, verifyTaskSchema, completeTaskSchema } from "./schemas.js";
export declare function executeTask({ taskId, projectId, focus, }: z.infer<typeof executeTaskSchema>): Promise<{
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
export declare function verifyTask({ taskId, projectId, focus }: z.infer<typeof verifyTaskSchema>): Promise<{
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
export declare function completeTask({ taskId, summary, lessonsLearned, projectId, }: z.infer<typeof completeTaskSchema>): Promise<{
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
