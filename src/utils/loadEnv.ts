import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentHome, SETTINGS_FILE } from "./paths.js";


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
    const globalConfigEnv = readJsonEnv(path.join(getAgentHome(), SETTINGS_FILE));
    Object.assign(process.env, globalConfigEnv);
    
    // .env file (highest priority — project-local overrides everything)
    dotenv.config({ override: true });
}

