import { getTimestamp } from "./loadEnv.js";


export function debugLog(scope: string, message: string, details?: Record<string, unknown>): void {
    if (!process.env.AGENT_DEBUG) return;
    const timestamp = getTimestamp();
    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    console.error(`[cool-agent][${timestamp}][${scope}] ${message}${suffix}`);
}