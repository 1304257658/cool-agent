import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";


export const AGENT_NAME = process.env.AGENT_NAME || "Cool Agent";
export const AGENT_HOME_NAME = AGENT_NAME.toLowerCase().replace(/\s+/g, "-");

const rawHome = process.env.HOME || process.env.USERPROFILE || "~";
export const AGENT_HOME = (() => {
    if (!rawHome) {
        return "~"; // 最终兜底
    }
    
    // 2. 利用 path.normalize 消除正反斜杠混用的不一致性
    // 它会自动把 "C:/Users/Admin" 在 Windows 下转换为 "C:\Users\Admin"
    return path.join(path.normalize(rawHome), AGENT_HOME_NAME);
})();
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
    const globalConfigEnv = readJsonEnv(path.join(AGENT_HOME, `${AGENT_HOME_NAME}.json`));
    Object.assign(process.env, globalConfigEnv);

    const settingsEnv = readJsonEnv(path.join(AGENT_HOME, "settings.json"));
    Object.assign(process.env, settingsEnv);
    
    // .env file (highest priority — project-local overrides everything)
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