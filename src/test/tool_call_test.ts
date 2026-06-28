import { globTool } from "../tools/globTool.js";


const result = await globTool.call({ pattern: ".env" }, { cwd: process.cwd() });
console.log(result);
console.log(result.content);
