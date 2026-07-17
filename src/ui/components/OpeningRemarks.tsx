import React from "react";
import { Box, Text } from "ink";

import { AGENT_NAME } from "../../utils/loadEnv.js";



interface OpeningRemarksProps {
    model: string;
}

export function OpeningRemarks({ model }: OpeningRemarksProps) {
    return (
        <Box flexDirection="column">
            {/* {1} 应用名称和当前模型 */}
            <Box marginBottom={1}>
                <Text bold color="cyan">{AGENT_NAME}</Text>
                <Text dimColor> ({model})</Text>
            </Box>
            <Text dimColor>Type a message to start. Ctrl+C to interrupt, Ctrl+D to exit.</Text>
        </Box>
    );
}