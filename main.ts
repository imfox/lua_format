import * as fs from "fs";

let lua_code = fs
    .readFileSync("test.lua")
    .toString();

function format(code: string, lua_version: string = "lua51") {
    enum TokenType {
        None,
        Value,
        String,
        Number,
        Symbol,
        Note,
    };

    let statcks = [];
    let j = 0;
    let t = code;
    let isABC = (charCode: number) => charCode >= 97 && charCode <= 122 || charCode >= 65 && charCode <= 90;
    function shift(i: number = 1): string { j += i; return t.substring(j - i, j)!; }
    function at(i = 0) { return t.at(j + i); }
    function white(char: string) { return "\t ".indexOf(char) >= 0; }
    function num(char: string) { return "0123456789".indexOf(char) >= 0; }
    function is(text: string) { return (j + text.length < t.length) ? t.substring(j, j + text.length) == text : false; }
    function line(char: string) { return !char || char == "\n" || char == "\r"; }
    function end(char: string) { return !char || "\t\r\n+-*/><=~^,.;)}] ".indexOf(char) >= 0; }

    let col = 0;
    let row = 0;

    function token() {
        let i = j;
        let tk = "";

        function throw_error() {
            let ei = j;
            j = i;
            return {
                value: tk,
                type: TokenType.None,
                index: ei,
                row: row,
                col: col,
            }
        }
        let tkType = TokenType.None;
        while (j < t.length) {
            if (j >= 70808) {
                console.log("1")
            }
            let char = t.at(j)!;
            if (is("--")) {
                if (is("--[[")) { //块注释
                    tk += shift(4);
                    let end: boolean;
                    while (!(end = is("]]")) && j < t.length) {
                        tk += shift();
                    }
                    if (end) {
                        tk += shift() + shift() + shift() + shift();
                    }
                } else {
                    while (!line(at())) {
                        tk += shift();
                    }
                }
                tkType = TokenType.Note;
                break;
            } else if (is("...")) {
                tk = shift() + shift() + shift();
                tkType = TokenType.Symbol;
                break;
            } else if (is("..") || is("::") || is(">>") || is("<<") || is("//")) {
                tk = shift() + shift();
                tkType = TokenType.Symbol;
                break;
            } else if (char == "_" || isABC(char?.codePointAt(0)!)) {
                do {
                    tk += char;
                    char = t.at(++j)!;
                } while (char == "_" || num(char) || isABC(char?.codePointAt(0)!));
                tkType = TokenType.Value;
                break;
            } else if (char == '"' || char == "'") {
                tk = shift();
                while (at() != char) {
                    if (at() == "\\")
                        tk += shift();
                    tk += shift();
                }
                if (char == at()) {
                    tk += shift();
                }
                tkType = TokenType.String;
                break;
            } else if (white(char)) {
                shift();
            } else if ("><=~".indexOf(char) >= 0 && at(1) == "=") {
                tk = shift() + shift();
                tkType = TokenType.Symbol;
                break;
            } else if ((char == "-") && (num(at(1)) || at(1) == ".") || num(char) || (num(at(1)) && at() == ".")) { // 0x, -0x, -.1, -1.1 
                tkType = TokenType.Number;
                let neg = char == "-";
                let flo = char == ".";
                let dot = 0;
                if (neg) {
                    tk = shift()
                    char = at();
                } else if (flo) {
                    char = at();
                }
                let mt = "";
                if (char == "0" && at(1) != ".") { //8进制
                    tk += shift();
                    mt = "01234567"
                    if (at() == "x") { //16进制
                        tk += shift();
                        mt = "0123456789abcdef";
                    }
                } else if (char == "." || num(at())) { //10进制
                    dot = 1;
                    tk += shift();
                    mt = "0123456789";
                } else {
                    if (end(at())) {
                        if (neg)
                            return throw_error();
                        break;
                    }
                }
                while (mt.indexOf(at()) >= 0 || (dot <= 0 && at() == ".")) {
                    tk += shift();
                }
                if (!end(at())) {
                    console.log(at());
                    return throw_error();
                }
                break;
            } else if (char == "\r") {
                tk = shift();
                if (at() == "\n") {
                    tk += shift();
                }
                tkType = TokenType.Symbol;
                break;
            } else if ("\n(){}[]+-*/,><=;:#.^%&|~".indexOf(char) >= 0) {
                tk = shift();
                tkType = TokenType.Symbol;
                break;
            } else {
                console.log("未识别: " + char);
                j++;
                tkType = TokenType.None;
            }
        }
        let ti = {
            value: tk,
            type: tkType,
        };
        return ti;
    }

    let formatcode = "";

    let tks = [];
    let tkt = [];
    let suftext: string = "";
    while (j < code.length) {
        let tk = token();
        if (tk.type == TokenType.None) {
            console.log(tk);
            console.log(j);
            suftext = code.substring(j, code.length);
            break;
        } else {
            tks.push(tk.value);
            tkt.push(tk.type);
        }
    }

    tks.reverse();
    tkt.reverse();

    let prespace = [">>", "<<", "..", "%", "return", "do", "end", "+", "-", "*", "/", "<", ">", "^", "=", ">=", "<=", "==", "~=", "<", ">", "and", "or", "then"];
    let sufspace = ["goto", ">>", "<<", "until", "break", "repeat", "..", ";", "%", , ",", "for", "then", "not", "if", "else", "elseif", "function", "and", "or", "do", "while", "end", "return", "local", "+", "-", "*", "/", "<", ">", "^", "=", ">=", "<=", "==", "~=", ".."];

    let open = ["function", "do", "repeat", "if", "{", "(", "["];
    let close = ["end", "until", "}", ")", "]"];

    let isspace = (i: number) => ["\r\n", "\n", "\t", " "].indexOf(formatcode.at(-1)) >= 0;
    function tryaddspace(i: number = -1) { formatcode += isspace(i) ? "" : " "; }

    let tabs = [];
    let tab = 0;
    let curlineTab = 0;
    while (tks.length) {
        let tk: string = tks.pop();
        let tt = tkt[tks.length];
        let ntk: string;
        let ntt: TokenType;
        if (tks.length) {
            ntk = tks.at(-1); //next
            ntt = tkt.at(tks.length - 1);
        }

        if (tt == TokenType.Note) {
            tryaddspace(-1)
        } else if (prespace.indexOf(tk) >= 0) {
            tryaddspace(-1)
        }
        formatcode += tk;

        if (open.indexOf(tk) >= 0) {
            curlineTab++;
            statcks.push(tk);
        } else if (close.indexOf(tk) >= 0) {
            curlineTab--;
            statcks.pop();
        }
        if (tk == "\r\n" || tk == "\n") {
            if (curlineTab > 0) {
                tabs.push(curlineTab);
            } else if (curlineTab < 0) {
                let dec = curlineTab;
                while ((dec += tabs.pop()) < 0) {
                    tab--;
                }
            }
            tab += curlineTab ? (curlineTab / Math.abs(curlineTab)) : 0;
            curlineTab = 0;
            let isClose = ["elseif", "else", "then"].indexOf(ntk) >= 0 || close.indexOf(ntk) >= 0;
            formatcode += (" ".repeat(4)).repeat(Math.max(0, tab - (isClose ? 1 : 0)));
        } else if (tk == ")" || tk == "}" || tk == "]" || tk == "end") {
            if (!(!ntk || ntk == "." || ntk == "(" || ntk == ")" || ntk == "{" || ntk == "}" || ntk == "[" || ntk == "]" || ntk == "," || ntk == ";" || ntk == ":" || ntk == "\r\n" || ntk == "\n")) {
                tryaddspace(-1)
            }
        } else if (sufspace.indexOf(tk) >= 0) {
            tryaddspace(-1)
        } else {
            if ([TokenType.String, TokenType.Number, TokenType.Value].indexOf(tt) >= 0 && [TokenType.String, TokenType.Number, TokenType.Value].indexOf(ntt) >= 0) { //这里错误了
                tryaddspace(-1)
            }
        }

        if (tt == TokenType.Note) {
            if (tk.trim().startsWith("---@align")) {

            }
        }
    }

    return formatcode + suftext;
}

let clock = Date.now();
let newcode = format(lua_code);
console.log(Date.now() - clock, "ms");

fs.writeFileSync("1.lua", newcode);
// console.log(newcode);

