#!/usr/bin/env node
import { loadEnv } from "../utils/loadEnv.js";
loadEnv();
import { buildSystemPrompt, renderSystemPrompt } from "../context/systemPrompt.js";


const VERSION = "0.1.1";


async function renderCli(model?: string, systemPrompt?: string) {
    // 动态 import React/Ink（只在真正需要时加载）
    const React = await import("react");
    const { render } = await import("ink");
    const { App } = await import("../ui/App.js");
    const { DEFAULT_MODEL, SYSTEM_PROMPT } = await import("../services/api/anthropicClient.js");

    const resolvedModel = model ?? DEFAULT_MODEL;

    const { waitUntilExit } = render(
        React.createElement(App, { model: resolvedModel, systemPrompt: systemPrompt ?? SYSTEM_PROMPT }),
    );
    await waitUntilExit();

    console.log("Hello, Cool Agent CLI!");
}

async function main(): Promise<void> {
    if (process.argv.includes("--version") || process.argv.includes("-v")) {
        console.log(`Cool Agent v${VERSION}`);
        process.exit(0);
    }
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log(`
Cool Agent v${VERSION} — Terminal-native agentic coding system

Usage:
  agent [options]

Options:
  -v, --version               Print version and exit
  -h, --help                  Show this help message
  --model <model>             Override the LLM model
  --plan                      Start in plan mode (read-only tools only)
  --auto                      Start in auto mode (allow all tools)
  --permission-mode <mode>    Permission mode: default | plan | auto
  --dump-system-prompt        Print the assembled system prompt and exit

Commands (in REPL):
  /clear                      Clear conversation history
  /history                    Show message count
  /exit, /quit, /bye          Exit the REPL
`);
        process.exit(0);
    }

    // 解析 --model 参数
    const modelIndex = process.argv.indexOf("--model");
    const model = modelIndex !== -1 ? process.argv[modelIndex + 1] : undefined;

    // 解析 --plan 参数
    const plan = process.argv.includes("--plan");

    // 解析 --auto 参数
    const auto = process.argv.includes("--auto");

    // 解析 --permission-mode 参数
    const permissionMode = process.argv.includes("--permission-mode");

    // 解析 --dump-system-prompt 参数
    const dumpSystemPrompt = process.argv.includes("--dump-system-prompt");

    if (dumpSystemPrompt) {
        // 构建系统提示词
        const cwd = process.cwd();
        const systemParts = await buildSystemPrompt({ cwd });
        const systemPrompt = renderSystemPrompt(systemParts);
        console.log(systemPrompt);
        process.exit(0);
    }
    
    // DebugView 视图渲染系统提示词
    const cwd = process.cwd();
    const systemParts = await buildSystemPrompt({ cwd });
    const systemPrompt = renderSystemPrompt(systemParts);
    await renderCli(model, systemPrompt);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});