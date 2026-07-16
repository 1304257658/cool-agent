import type { Usage } from "../types/message.js";



export function createEmptyUsage(): Usage {
    return {
        input_tokens: 0,
        output_tokens: 0,
    }
}