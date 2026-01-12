import * as fs from "fs";

let lua_code = fs
    .readFileSync("test.lua")
    .toString();

function format(code: string, lua_version: string = "lua51") {
    enum TokenType { None, Value, String, Number, Symbol, Note, };

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

    type IToken = { value: string, type: TokenType, row?: number, col?: number, index?: number, flags?: string };

    let col = 0;
    let row = 0;
    let pStart = 0;

    function throw_error(token: IToken) {
        let ei = j;
        j = pStart;
        token.type = TokenType.None;
        token.index = ei;
        token.row = row;
        token.col = col;
        return false;
    }

    function read_num(ti: IToken) {
        ti.type = TokenType.Number;
        let char = at();
        let neg = char == "-";
        let flo = char == ".";
        let dot = 0;
        if (neg) {
            ti.value = shift()
            char = at();
        } else if (flo) {
            char = at();
        }
        let mt = "";
        if (char == "0" && at(1) != ".") { //8进制
            ti.value += shift();
            mt = "01234567"
            if (at() == "x") { //16进制
                ti.value += shift();
                mt = "0123456789abcdef";
            }
        } else if (char == "." || num(at())) { //10进制
            dot = 1;
            ti.value += shift();
            mt = "0123456789";
        } else {
            if (end(at())) {
                if (neg)
                    return throw_error(ti);
                return true;
            }
        }
        while (mt.indexOf(at()) >= 0 || (dot <= 0 && at() == ".")) {
            ti.value += shift();
        }
        if (!end(at()))
            return throw_error(ti);
        return true;
    };

    function read_string(ti: IToken) {
        let char = at();
        ti.type = TokenType.String;
        ti.value = shift();
        while (at() != char) {
            if (at() == "\\")
                ti.value += shift();
            ti.value += shift();
        }
        if (char == at()) {
            ti.value += shift();
        }
        return true;
    }

    function read_key(ti: IToken) {
        let char = at();
        do {
            ti.value += char;
            char = t.at(++j)!;
        } while (char == "_" || num(char) || isABC(char?.codePointAt(0)!));
        ti.type = TokenType.Value;
        return true;
    };

    function read_space() {
        let s = "";
        while ("\t ".indexOf(at()) >= 0) {
            s += shift();
        }
        return s;
    }

    function token() {
        pStart = j;
        let ti: IToken = { value: "", type: TokenType.None, };

        while (j < t.length) {
            if (j >= 70808) {
                console.log("1")
            }
            let char = t.at(j)!;
            if (is("--")) {
                if (is("--[[")) { //块注释
                    ti.value += shift(4);
                    let end: boolean;
                    while (!(end = is("]]")) && j < t.length) {
                        ti.value += shift();
                    }
                    if (end) {
                        ti.value += shift() + shift();
                    }
                } else {
                    while (!line(at())) {
                        ti.value += shift();
                    }
                }
                ti.type = TokenType.Note;
                break;
            } else if (is("...")) {
                ti.value = shift() + shift() + shift();
                ti.type = TokenType.Symbol;
                break;
            } else if (is("..") || is("::") || is(">>") || is("<<") || is("//")) {
                ti.value = shift() + shift();
                ti.type = TokenType.Symbol;
                break;
            } else if (char == "_" || isABC(char?.codePointAt(0)!)) {
                read_key(ti);
                break;
            } else if (char == '"' || char == "'") {
                read_string(ti);
                break;
            } else if (white(char)) {
                shift();
            } else if ("><=~".indexOf(char) >= 0 && at(1) == "=") {
                ti.value = shift() + shift();
                ti.type = TokenType.Symbol;
                break;
            } else if ((char == "-") && (num(at(1)) || at(1) == ".") || num(char) || (num(at(1)) && at() == ".")) { // 0x, -0x, -.1, -1.1 
                read_num(ti);
                break;
            } else if (char == "\r") {
                ti.value = shift();
                if (at() == "\n") {
                    ti.value += shift();
                }
                ti.type = TokenType.Symbol;
                break;
            } else if ("\n(){}[]+-*/,><=;:#.^%&|~".indexOf(char) >= 0) {
                ti.value = shift();
                if (ti.value == "{") { //花括号可以检查是否需要自动对齐
                    let p = j; //先记录原先的位置
                    let ok = false;
                    do {
                        read_space();
                        if (!line(at())) { //换行符 
                            console.log("不是 换行符 ")
                            break;
                        }
                        shift(); // \r\n
                        read_space();
                        let key: IToken = {} as any;
                        if (!read_key(key)) {
                            console.log("不是 key ")
                            break;
                        }
                        if (read_space().length <= 1) {
                            break;
                        }
                        if (at() != "=") break;
                        shift();

                        read_space();

                        let tv: IToken = {} as any;
                        if (!(read_num(tv) || read_string(tv) || read_key(tv))) {
                            break;
                        }

                        ok = true;
                    } while (false);
                    j = p;
                    if (ok)
                        ti.flags = "---@align";
                }
                ti.type = TokenType.Symbol;
                break;
            } else {
                console.log("未识别: " + char);
                j++;
                ti.type = TokenType.None;
            }
        }
        return ti;
    }

    let formatcode = "";

    let tokens: IToken[] = [];
    let suftext: string = "";
    while (j < code.length) {
        let tk = token();
        if (tk.type == TokenType.None) {
            console.log(tk);
            console.log(j);
            suftext = code.substring(j, code.length);
            break;
        } else {
            tokens.push(tk);
        }
    }

    let tks = tokens.map(d => d.value).reverse();
    let tkt = tokens.map(d => d.type).reverse();

    let prespace = [">>", "<<", "..", "%", "return", "do", "end", "+", "-", "*", "/", "<", ">", "^", "=", ">=", "<=", "==", "~=", "<", ">", "and", "or", "then"];
    let sufspace = ["goto", ">>", "<<", "until", "break", "repeat", "..", ";", "%", , ",", "for", "then", "not", "if", "else", "elseif", "function", "and", "or", "do", "while", "end", "return", "local", "+", "-", "*", "/", "<", ">", "^", "=", ">=", "<=", "==", "~=", ".."];

    let open = ["function", "do", "repeat", "if", "{", "(", "["];
    let close = ["end", "until", "}", ")", "]"];

    let isspace = (i: number) => ["\r\n", "\n", "\t", " "].indexOf(formatcode.at(-1)) >= 0;
    function tryaddspace(i: number = -1) { formatcode += isspace(i) ? "" : " "; }

    let tabs = [];
    let tab = 0;
    let curlineTab = 0;

    function align(tab: number) {
        let prespace = (" ".repeat(4)).repeat(Math.max(0, tab));
        formatcode += tks.pop();  // \n

        let arr = [];
        while (tks.length > 0) {
            if (tkt.at(tks.length - 1) != TokenType.Value) {
                break;
            }
            arr.push(tks.pop())
            arr.push(tks.pop())
            arr.push(tks.pop())
            if (tkt[tks.length - 1] != TokenType.Symbol) {
                break;
            }
            arr.push(tks.pop());
            if (tkt[tks.length - 1] == TokenType.Note) {
                arr.push(tks.pop())
            } else {
                arr.push("");
            }
            if (tks.at(-1) == "\n") tks.pop();
            if (tks.at(-1) == "}") break;
        }
        let kw = 0, vw = 0;
        for (let i = 0; i < arr.length; i += 5) {
            kw = Math.max(arr[i].length, kw);
            vw = Math.max(arr[i + 2].length, vw);
        }
        for (let i = 0; i < arr.length; i += 5) {
            formatcode += `${prespace}${arr[i]}${" ".repeat(kw - arr[i].length + 1)}${arr[i + 1]} ${arr[i + 2]}${" ".repeat(vw - arr[i + 2].length)}${arr[i + 3]} ${arr[i + 4]}\n`;
        }
        console.log(kw, vw);
        console.log(arr);
    }

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

        if (tt == TokenType.Symbol && tk == "{") {
            let ti = tokens[tokens.length - tks.length - 1];
            if (ti.flags == "---@align") {
                align(tab + 1);
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

