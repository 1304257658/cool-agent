import { render, Box, Text } from 'ink';


function StatusBar() {
    return (
        <Box flexDirection="column" paddingX={1}>
            <Box justifyContent="space-between">
                <Text bold color="cyan">Cool Agent</Text>
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