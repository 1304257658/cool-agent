import "dotenv/config";
import { streamMessage } from "../services/api/streaming.js";


const gen = streamMessage({
    messages: [{ role: "user", content: "用一句话解释一下什么是 Agentic Loop" }],
    system: "You are a helpful assistant. Reply in Chinese.",
});

let result;
while (true) {
    const { value, done } = await gen.next();
    if (done) {
        result = value;
        break;
    }

    switch (value.type) {
        case "text":
            process.stdout.write(value.text);
            break;

        case "message_done":
            console.log(`\nTokens: ${value.usage.input_tokens} in / ${value.usage.output_tokens} out`);
            break;
    }
}

// 稀疏数组的诞生：JavaScript 允许数组存在“孔洞（Holes）”。当您直接给索引 1 赋值，而索引 0 还未被定义时，引擎会自动将索引 0 留空。也就出现了：content: [ <1 empty item>, [Object] ]。而这里的 index: 0,是 thinking 的记录。
// console.log(result);

// // undefined 表示 thinking 没有记录
// for (const block of result.assistantMessage.content) {
//     console.log(block);
// }














