#!/usr/bin/env node
import "dotenv/config";


const VERSION = "0.1.1";

async function main(): Promise<void> {
    if (process.argv.includes("--version") || process.argv.includes("-v")) {
        console.log(`Cool Agent ${VERSION}`);
        process.exit(0);
    }
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log( `cool-agent v${VERSION} — Terminal-native agentic coding system\n...` );
        process.exit(0);
    }

    // 解析 --model 参数
    const modelIndex = process.argv.indexOf("--model");
    const model = modelIndex !== -1 ? process.argv[modelIndex + 1] : undefined;

    // 动态 import React/Ink（只在真正需要时加载）
    const React = await import("react");
    const { render } = await import("ink");
    const { App } = await import("../ui/App.js");
    const { DEFAULT_MODEL, SYSTEM_PROMPT } = await import("../services/api/anthropicClient.js");

    const resolvedModel = model ?? DEFAULT_MODEL;
    const system = SYSTEM_PROMPT;

    const { waitUntilExit } = render(
        React.createElement(App, { model: resolvedModel, system }),
    );
    await waitUntilExit();

    console.log("Hello, Cool Agent CLI!");
}

main().catch((err) => {
  console.error( `Fatal error: ${err.message}` );
  process.exit(1);
});