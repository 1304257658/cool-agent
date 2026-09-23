import { getTimestamp } from "./timestamp.js";
import { getAgentLowerName } from "./paths.js";

export function debugLog(scope: string, message: string, details?: Record<string, unknown>): void {
    if (!process.env.AGENT_DEBUG) return;
    
    const timestamp = getTimestamp();
    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    console.error(`[${getAgentLowerName()}][${timestamp}][${scope}] ${message}${suffix}`);
}

/**
 * Always-on warning to stderr. Used for non-fatal startup issues like a
 * malformed MCP server config — we want the user to see it even without
 * EASY_AGENT_DEBUG=1, but it must NOT corrupt Ink's stdout-rendered UI.
 */
export function logWarn(message: string): void {
    console.error(`[${getAgentLowerName()}][warn] ${message}`);
}

export function logError(message: string): void {
    console.error(`[${getAgentLowerName()}][error] ${message}`);
}