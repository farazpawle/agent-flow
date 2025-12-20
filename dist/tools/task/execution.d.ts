import { z } from "zod";
import { executeTaskSchema, verifyTaskSchema, completeTaskSchema } from "./schemas.js";
export declare function executeTask({ taskId, }: z.infer<typeof executeTaskSchema>): Promise<{
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
export declare function verifyTask({ taskId }: z.infer<typeof verifyTaskSchema>): Promise<{
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
export declare function completeTask({ taskId, summary, }: z.infer<typeof completeTaskSchema>): Promise<{
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
