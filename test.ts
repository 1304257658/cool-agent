import "dotenv/config";
import { streamMessage } from "./src/services/api/streaming.js";


const gen = streamMessage({
    messages: [{ role: "user", content: "解释一下什么是 Agentic Loop" }],
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














