import path from "path";
import { expandHome } from "../tools/pathUtils.ts";

// console.log(path.resolve(expandHome("test.txt")));

let oldString = "Hello, World!\nThis is a test.\nAnd it's working!";
let newString = "你好\n这是测试\n它正常运行了！"

let oldLines = oldString.split("\n").slice(0, 3);
let newLines = newString.split("\n").slice(0, 3);
console.log([
"Preview:",
...oldLines.map((line) => `- ${line}`),
...newLines.map((line) => `+ ${line}`),
].join("\n"));
