import React from "react";
import { Box, Text } from "ink";
import type { ToolCallInfo } from "../types.js";

interface ToolCallListProps {
    toolCalls: ToolCallInfo[];
}

export function ToolCallList({ toolCalls }: ToolCallListProps): React.ReactNode {
    if (toolCalls.length === 0) {
        return null;
    }

    return (
        <Box flexDirection="column" marginTop={0}>
            {toolCalls.map((toolCall, index) => (
                <Box key={ `tc${index}` } marginLeft={2}>
                {toolCall.resultLength !== undefined
                    // 工具调用已完成：显示绿色勾号和返回结果长度
                    ? (
                        toolCall.isError ? (
                            <Text color="red">{"  \u2717 "}{toolCall.name}: error</Text>
                        ) : (
                            <>
                                <Text color="green">{"  \u2713 "}{toolCall.name}</Text>
                                <Text dimColor>({toolCall.resultLength} chars)</Text>
                            </>
                        )
                    )
                    // 工具正在执行：显示黄色等待状态
                    : (
                        <Text color="yellow">{"⚡ Using tool: "}{toolCall.name}</Text>
                    )
                }
                </Box>
            ))}
        </Box>
    );
}