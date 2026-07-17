import { getTimestamp, AGENT_HOME_NAME } from "./loadEnv.js";


export function debugLog(scope: string, message: string, details?: Record<string, unknown>): void {
    if (!process.env.AGENT_DEBUG) return;
    
    const timestamp = getTimestamp();
    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    console.error(`[${AGENT_HOME_NAME}][${timestamp}][${scope}] ${message}${suffix}`);
}