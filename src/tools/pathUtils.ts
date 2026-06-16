import * as path from "node:path";


// 头的路径
export function expandHome(filePath: string): string {
  return filePath.startsWith("~")
    ? path.join(process.env.HOME || process.env.USERPROFILE || "", filePath.slice(1))
    : filePath;
}

export function resolveSafePath(filePath: string, cwd: string): string {
  return path.resolve(cwd, expandHome(filePath));
}

// 确保路径在工作目录内
export function ensureInsideCwd(filePath: string, cwd: string): void {
  const relative = path.relative(cwd, filePath);
  if (relative === "" || relative === ".") {
    return;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path ${filePath} is not inside the workspace directory ${cwd}`);
  }
}


export function resolveWorkspacePath(filePath: string, cwd: string): string {
  cwd = path.resolve(expandHome(cwd));
  const resolvedPath = resolveSafePath(filePath, cwd);
  ensureInsideCwd(resolvedPath, cwd);
  return resolvedPath;
}