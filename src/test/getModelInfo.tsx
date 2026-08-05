import { loadEnv } from '../utils/loadEnv.js';
loadEnv();


interface ModelInfo {
    name: string,
    model: string,
    size: number,
    digest: string,
    details: Object,
    size_vram: number,
    context_length: number,
}

async function fetchModelInfo(): Promise<ModelInfo> {
    let modelInfo: ModelInfo = {
        name: "test",
        model: "test",
        size: 1024,
        digest: "test",
        details: {},
        size_vram: 1024,
        context_length: 1024,
    };
    try {
        const url = `${BASE_URL}/api/ps`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP 错误! 状态码: ${response.status}`);
        }

        const rawData = await response.json();

        for (const obj of rawData.models) {
            if (obj.name === MODEL_NAME) {
                modelInfo = obj;
                break;
            }
        };

        return modelInfo;
    } catch (error) {
        console.error("❌ 请求或 JSON 解析失败:", error);

        return modelInfo;
    }
}


const BASE_URL = process.env.ANTHROPIC_BASE_URL || "";
const MODEL_NAME = process.env.ANTHROPIC_MODEL || "";
export const MODEL_INFO = await fetchModelInfo();
export const MODEL_CONTEXT_WINDOW = MODEL_INFO.context_length;
console.log(`BASE_URL: ${BASE_URL}\nMODEL_NAME: ${MODEL_NAME}\nMODEL_INFO: `);
console.table(MODEL_INFO);
console.log(`\nMODEL_CONTEXT_WINDOW: ${MODEL_CONTEXT_WINDOW}`);