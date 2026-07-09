import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { AGENT_PROJECTS_DIR } from "./loadEnv.js";


export interface ProjectPathInfo {
    gitRoot: string;
    projectKey: string;
    projectDir: string;
}


async function findCanonicalGitRoot(cwd: string): Promise<string> {
    let currentDir = path.resolve(cwd);

    while (true) {
        try{
            await fs.stat(path.join(currentDir, ".git"));
            return currentDir;
        } catch {
            // keep walking upward
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return path.resolve(cwd);
        }
        currentDir = parentDir;
    }
}

export function sanitizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "project";
}

export async function getProjectPathInfo(cwd: string): Promise<ProjectPathInfo> {
    const gitRoot = await findCanonicalGitRoot(cwd);
    const slugBase = sanitizeSlug(path.basename(gitRoot));
    const suffix = crypto.createHash("sha256").update(gitRoot).digest("hex").slice(0, 16);
    const projectKey = `${slugBase}-${suffix}`;
    const projectDir = path.join(AGENT_PROJECTS_DIR, projectKey.trim());
    return { gitRoot, projectKey, projectDir };
}