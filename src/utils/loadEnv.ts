import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";


export const AGENT_HOME = process.env.HOME || process.env.USERPROFILE || "~";
export const AGENT_PROJECTS_DIR = path.join(AGENT_HOME, "projects");
export const MEMORY_ENTRYPOINT = "MEMORY.md";


interface ClaudeConfig {
    env?: Record<string, string>;
}

function readJsonEnv(filePath: string): Record<string, string> {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed: ClaudeConfig = JSON.parse(raw);
        if (parsed.env && typeof parsed.env === "object") {
            return parsed.env;
        }
    } catch {
        // File doesn't exist or is invalid JSON — silently skip
    }
    return {};
}

export function loadEnv() {
    const home = process.env.HOME || process.env.USERPROFILE || "~";

    // 1. ~/.cool-agent.json (lowest priority)
    const globalConfigEnv = readJsonEnv(path.join(home, ".cool-agent.json"));
    Object.assign(process.env, globalConfigEnv);

    // 2. ~/.cool-agent/settings.json (highest priority)
    const settingsEnv = readJsonEnv(path.join(home, "settings.json"));
    Object.assign(process.env, settingsEnv);
    
    // 3. .env file (highest priority — project-local overrides everything)
    dotenv.config({ override: true });
}


export function getTimestamp() {
    return process.env.TIMEZONE
        // sv-SE 可以完美输出类似于 ISO 的 YYYY-MM-DD HH:mm:ss 格式
        ? new Intl.DateTimeFormat("sv-SE", { 
            timeZone: process.env.TIMEZONE,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
        // 把中间的空格换成 T，向 ISO 看齐
        }).format(new Date()).replace(" ", "T") 
        : new Date().toISOString();
}