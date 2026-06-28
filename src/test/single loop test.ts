import "dotenv/config";
import {
  query,
} from "../core/agenticLoop.js";
import { buildSystemPrompt, renderSystemPrompt } from "../context/systemPrompt.js";
import { getToolsApiParams } from "../tools/index.js";


const env = process.env;

const cwd = process.cwd();
const systemParts = await buildSystemPrompt({ cwd });
const systemPrompt = renderSystemPrompt(systemParts);
const tools = getToolsApiParams();

const abortController = new AbortController();

const loop = query({
    messages: [{ role: "user", content: ".env 文件中都有哪些内容，你认为这是一个什么项目？使用中文解答我的疑问。" }],
    systemPrompt: systemPrompt,
    tools: tools,
    model: env.ANTHROPIC_MODEL_NAME as string,
    abortSignal: abortController.signal,
    toolContext: {
        cwd,
        abortSignal: abortController.signal,
    }
});

while (true) {
    const { value, done } = await loop.next();
    if (done) {
        console.log(`\nTokens: ${value.usage.input_tokens} in / ${value.usage.output_tokens} out`);
        break;
    }
    switch (value.type) {
        case "assistant_message":
        case "tool_result_message":
            console.log(value.message);
            break;
        default:
            break;
    }
}















