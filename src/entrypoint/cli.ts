#!/usr/bin/env node


const VERSION = "0.1.0";

function main(): void {
    if (process.argv.includes("--version") || process.argv.includes("-v")) {
        console.log(`Cool Agent ${VERSION}`);
        process.exit(0);
    }

    console.log("Hello, Cool Agent CLI!");
}

main();