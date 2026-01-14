#!/usr/bin/env node
const fs = require("fs");
const lua_format = require("../dist/index").default;

let lua_code = fs
    .readFileSync("test/test.lua")
    .toString();

let clock = Date.now();
let error = {}
let newcode = lua_format.format(lua_code, { space: 4 }, error);
console.log(error);
console.log(Date.now() - clock, "ms");

fs.writeFileSync("test/format.lua", newcode);
// console.log(newcode);

