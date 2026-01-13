import * as fs from "fs";

let lua_code = fs
    .readFileSync("test.lua")
    .toString();

type IToken = { value: string, type: TokenType, offset?: number, flags?: string };
enum TokenType { Error, ID, String, Number, Symbol, Note, Eof, };

class Tokenize {
    _raw: string;
    public _offset: number;
    protected _size: number;
    protected _offsetStacks: number[];

    constructor(raw: any) {
        this._offsetStacks = [];
        this._raw = raw as any;
        this._offset = 0;
        this._size = raw.length;
    }

    public save() { this._offsetStacks.push(this._offset); }
    public restore() { return this._offset = this._offsetStacks.pop(); }

    eof(offset: number = 0) { return (this._offset + offset) >= this._size; }
    at(index: number = 0) { return this._raw.at(this._offset + index); }

    shift(size: number = 1) {
        this._offset += size;
        return this._raw.slice(this._offset - size, this._offset);
    }


    is(t: string, offset: number = 0) {
        for (let i = 0; i < t.length; i++)
            if (t.at(i) != this.at(offset + i))
                return false;
        return true;
        // return this._raw.substring(this._offset, this._offset + t.length) == t;
    }

    charCodeAt(offset: number = 0) { return this.eof(offset) ? -1 : this.at(offset).charCodeAt(0); }
    some(t: string, offset: number = 0) { return t.indexOf(this.at(offset)) >= 0; }

    line_or_eof(offset: number = 0) { return this.eof(offset) || this.some("\r\n", offset); };
    num_8(offset: number = 0) { return this.some("01234567", offset); }
    num_10(offset: number = 0) { return this.some("0123456789", offset); }
    num_16(offset: number = 0) { return this.some("0123456789abcdefABCDEF", offset); }
    num_end(offset: number = 0) { return this.eof(offset) || this.some(" \t\r\n+-*/&|><=~^%,;)}]", offset); }
    a2z(offset: number = 0) { let code = this.charCodeAt(offset); return code >= 97 && code <= 122 || code >= 65 && code <= 90 }

    is_symbol_h(offset: number = 0) { return this.some("+-*/&|><^%=", offset); }
    is_space_h(offset: number = 0) { return this.some("\t ", offset); }
    is_note_h(offset: number = 0) { return this.is("--", offset); }                                   // --, --[[
    is_str_h(offset: number = 0) { return this.some(`'"`, offset) || this.is("[[", offset); }
    is_id_h(offset: number = 0) { return this.is("_", offset) || this.a2z(offset); }                  // _a, a
    is_num_h(offset: number = 0) {
        return (this.is("-", offset) && ((this.num_10(offset + 1) || this.at(offset + 1) == ".")))    // -.1, -1, -0x
            || this.num_10(offset)                                                                    // 123, 0123
            || (this.at(offset) == "." && this.num_10(offset + 1));                                   // .1
    }

    read_end(ti: IToken) {
        let char: string;
        do {
            ti.value += char = this.shift();
        } while (!this.is_space_h());
        return true;
    }
    read_id(ti: IToken) {
        let char: string;
        do {
            ti.value += char = this.shift();
        } while (this.a2z() || this.num_10() || this.is("_"));
        ti.type = TokenType.ID;
        return true;
    }

    read_str(ti: IToken) {
        ti.type = TokenType.String;
        let eof_: boolean;
        let closed = this.is("[[") ? "]]" : this.at();
        let ec = closed.length > 1 ? this.eof.bind(this) : this.line_or_eof.bind(this);
        ti.value += this.shift();
        while (!this.is(closed) && !(eof_ = ec())) {
            if (this.is("\\"))
                ti.value += this.shift();
            ti.value += this.shift();
        }
        if (!eof_)
            ti.value += this.shift(closed.length);
        return true;
    }

    read_note(ti: IToken) {
        if (this.is("--[[")) { //块注释
            let close: boolean;
            while (!(close = this.is("]]")) && !this.eof())
                ti.value += this.shift();
            if (close)
                ti.value += this.shift(2);
        } else {
            while (!this.line_or_eof())
                ti.value += this.shift();
        }
        ti.type = TokenType.Note;
    }

    read_space(ti?: IToken) {
        let char: string;
        do {
            char = this.shift();
            ti && (ti.value += char);
        } while (this.is_space_h());
        ti && (ti.type = TokenType.ID);
        return true;
    }

    read_num(ti: IToken) {
        this.save();
        ti.type = TokenType.Number;
        let hex = false, flo = 0;
        if (this.is("-")) ti.value += this.shift();
        let is_num: Function = this.num_10.bind(this);
        if (this.is("0")) {
            ti.value += this.shift();
            if (this.some("Xx")) { //16进制
                ti.value += this.shift();
                is_num = this.num_16.bind(this);
                hex = true;
            }
        } else if (this.num_10()) {
            ti.value += this.shift();
        }
        if (!hex && this.is(".") && !this.is("..")) { //10进制及以下
            flo++;
            ti.value += this.shift();
        }
        while (is_num()) {
            ti.value += this.shift();
            if (!this.is("..") && this.is("."))
                if (flo)
                    break;
                else {
                    ti.value += this.shift();
                    flo++;
                }
        }
        if (!this.num_end() && !this.is(".."))
            return this.throw_error(ti, this.restore());
        return true;
    };

    private throw_error(ti: IToken, index: number) {
        ti.type = TokenType.Error;
        ti.offset = index;
        return false;
    }

    take(): IToken {
        let ti: IToken = { value: "", type: TokenType.Symbol, };
        if (this.is_space_h())
            this.read_space();

        if (this.eof()) {
            ti.type = TokenType.Eof;
        } else if (this.is_note_h()) {
            this.read_note(ti);
        } else if (this.is_num_h()) {
            this.read_num(ti);
        } else if (this.is("...")) {
            ti.value = this.shift(3);
        } else if (["..", "::", ">>", "<<", "//", "\r\n", ">=", "<=", "==", "~="/** , "!=","++","--","+=","-=" */].some(k => this.is(k))) {
            ti.value = this.shift(2);
        } else if (this.is_str_h()) {
            this.read_str(ti);
        } else if (this.is_id_h()) {
            this.read_id(ti);
        } else if (this.some("\n(){}[]+-*/,><=;:#.^%&|~")) {
            ti.value = this.shift(1);
        } else {
            ti.type = TokenType.Error;
            ti.value = this.at();
        }
        return ti;
    }
}

function format(code: string, options?: { lua_version?: string, space?: number }) {
    if (!options) {
        options = {}
        if (!options.space) options.space = 4;
    }

    let tker = new Tokenize(code);

    let tokens: IToken[] = [];
    let suftext: string = "";
    let limit = code.length;
    while (!tker.eof()) {
        let it = tker.take();
        tokens.push(it);
        if (it.type == TokenType.Error) {
            console.log(it);
            suftext = code.substring(tker._offset, code.length);
            break;
        }
        if (--limit <= 0)  // 防止解析逻辑死循环 正常来说不会发生
            break;
    }

    let statcks = [];
    let formatcode = "";

    let tks = tokens.map(d => d.value).reverse();
    let tkt = tokens.map(d => d.type).reverse();

    let prespace = ['&', '|', '%', "^", '*', '+', '-', '..', "//", '/', '<', '<', '<<', '<=', '=', '==', '>', '>', '>=', '>>', '^', 'and', 'do', 'end', 'or', 'return', 'then', '~='];
    let sufspace = ['&', '|', '%', , "^", '*', '+', ',', '-', "//", '..', '..', '/', ';', '<', '<<', '<=', '=', '==', '>', '>=', '>>', '^', 'and', 'do', 'else', 'elseif', 'end', 'for', 'goto', 'if', 'local', 'not', 'or', 'repeat', 'then', 'until', 'while', '~='];

    let open = ['(', '[', 'do', 'function', 'if', 'repeat', '{'];
    let close = [')', ']', 'end', 'until', '}'];

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
            if (tkt.at(tks.length - 1) != TokenType.ID) {
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

    let row = 0, line_start_pos = 0;
    while (tks.length) {
        let tk: string = tks.pop();
        let tt = tkt[tks.length];
        let ntk: string;
        let ntt: TokenType;
        if (tks.length) {
            ntk = tks.at(-1); //next
            ntt = tkt.at(tks.length - 1);
        }

        if (tt == TokenType.Error) {
            console.log(`Uncaught SyntaxError: Invalid or unexpected token "${tk}" ${row + 1}:${formatcode.length - line_start_pos}`)
            break;
        } else if (tt == TokenType.Eof) {
            break;
        } else if (tt == TokenType.Note) {
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

            line_start_pos = formatcode.length;
            row++;
            tab += curlineTab ? (curlineTab / Math.abs(curlineTab)) : 0;
            curlineTab = 0;
            let isClose = ["elseif", "else", "then"].indexOf(ntk) >= 0 || close.indexOf(ntk) >= 0;
            if (!(ntk == "\r\n" || ntk == "\n")) { //下一行有内容的时候才添加tab
                formatcode += (" ".repeat(4)).repeat(Math.max(0, tab - (isClose ? 1 : 0)));
            }
        } else if (tk == ")" || tk == "}" || tk == "]" || tk == "end") {
            if (!(!ntk || ntk == "." || ntk == "(" || ntk == ")" || ntk == "{" || ntk == "}" || ntk == "[" || ntk == "]" || ntk == "," || ntk == ";" || ntk == ":" || ntk == "\r\n" || ntk == "\n")) {
                tryaddspace(-1)
            }
        } else if (sufspace.indexOf(tk) >= 0) {
            tryaddspace(-1)
        } else {
            if ([TokenType.String, TokenType.Number, TokenType.ID].indexOf(tt) >= 0 && [TokenType.String, TokenType.Number, TokenType.ID].indexOf(ntt) >= 0) { //这里错误了
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

