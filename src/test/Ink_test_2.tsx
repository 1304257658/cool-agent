import { render, Box, Text } from 'ink';
import { AGENT_NAME } from '../utils/loadEnv.js';


function StatusBar() {
    return (
        <Box flexDirection="column" paddingX={1}>
            <Box justifyContent="space-between">
                <Text bold color="cyan">{AGENT_NAME}</Text>
                <Text dimColor>v0.1.0</Text>
            </Box>
            <Box marginTop={1}>
                <Text color="green">● </Text>
                <Text>Ready</Text>
            </Box>
        </Box>
    );
}

render(<StatusBar />);