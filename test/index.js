#!/usr/bin/env node
const fs = require("fs");
const lua_format = require("../dist/index");

let lua_code = fs
    .readFileSync("test/test.lua")
    .toString();

let clock = Date.now();
let error = []
let newcode = lua_format.styles(lua_code, null, error);
console.log(Date.now() - clock, "ms");
console.log(error.map(d => d.msg).join("\n"));

fs.writeFileSync("test/format.lua", newcode);
// console.log(newcode);

