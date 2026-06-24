import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";


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
    const settingsEnv = readJsonEnv(path.join(home, ".cool-agent/settings.json"));
    Object.assign(process.env, settingsEnv);
    
    // 3. .env file (highest priority — project-local overrides everything)
    dotenv.config({ override: true });
}