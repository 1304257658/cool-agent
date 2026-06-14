import React from "react";
import { Box, Text } from "ink";


interface OpeningRemarksProps {
    model: string;
}

export function OpeningRemarks({ model }: OpeningRemarksProps) {
    return (
        <Box flexDirection="column">
            {/* {1} 应用名称和当前模型 */}
            <Box marginBottom={1}>
                <Text bold color="cyan">Cool Agent</Text>
                <Text dimColor> ({model})</Text>
            </Box>
            <Text dimColor>Type a message to start. Ctrl+C to interrupt, Ctrl+D to exit.</Text>
        </Box>
    );
}