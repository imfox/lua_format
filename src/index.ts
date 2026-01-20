namespace lua_sytles {
    type IToken = { value: string, type: TokenType, offset?: number, flags?: string, block?: number };
    enum TokenType { Error, ID, String, Number, Symbol, Note, Eof, Bof, Line };
    type Options = { space?: number };

    function charAt(str: string, i: number): string | undefined { // 支持负数索引
        let idx = i < 0 ? str.length + i : i;
        if (idx >= 0 && idx < str.length)
            return str.charAt(idx);
    }

    class Tokenize {
        _raw: string;
        public _offset: number;
        protected _size: number;
        protected _offsetStacks: number[];
        protected _block: number;
        protected _bof: boolean;

        constructor(raw: any) {
            this._block = 0;
            this._offsetStacks = [];
            this._raw = raw as any;
            this._offset = 0;
            this._size = raw.length;
            this._bof = false;
        }

        public save() { this._offsetStacks.push(this._offset); }
        public restore() { return this._offset = this._offsetStacks.length ? this._offsetStacks.pop()! : this._offset; }
        public pop() { this._offsetStacks.pop(); }

        eof(offset: number = 0) { return (this._offset + offset) >= this._size; }
        at(index: number = 0) { return charAt(this._raw, this._offset + index)!; }

        shift(size: number = 1) {
            this._offset += size;
            return this._raw.slice(this._offset - size, this._offset);
        }

        is(t: string, offset: number = 0) {
            for (let i = 0; i < t.length; i++)
                if (t.charAt(i) != this.at(offset + i))
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
        is_line_h(offset: number = 0) { return this.some("\r\n", offset); }
        is_str_h(offset: number = 0) { return this.some(`'"`, offset) || this.is("[[", offset); }
        is_id_h(offset: number = 0) { return this.is("_", offset) || this.a2z(offset); }                  // _a, a
        is_num_h(offset: number = 0) {
            return (this.is("-", offset) && ((this.num_10(offset + 1) || this.at(offset + 1) == ".")))    // -.1, -1, -0x
                || this.num_10(offset)                                                                    // 123, 0123
                || (this.at(offset) == "." && this.num_10(offset + 1));                                   // .1
        }

        try_read_line() {
            this.read_space();
            if (this.is_line_h()) {
                if (this.is("\r\n")) {
                    this.shift(2);
                } else if (this.is("\n")) {
                    this.shift(1);
                }
                return true;
            }
            return false;
        }

        try_read_key(ti: IToken) {
            this.read_space();
            if (this.is_id_h()) {
                this.read_id(ti);
                return true;
            } else if (this.is_num_h()) {
                this.read_num(ti);
                return true;
            } else if (this.is_str_h()) {
                this.read_str(ti);
                return true;
            }
            return false;
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
            let eof_: boolean = false;
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
            while (this.is_space_h()) {
                char = this.shift();
                ti && (ti.value += char);
            }
            ti && (ti.type = TokenType.Symbol);
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
            this.pop();
            return true;
        };

        private throw_error(ti: IToken, index: number) {
            ti.type = TokenType.Error;
            ti.offset = index;
            ti.value = "";
            while (!this.line_or_eof() && !this.is("--") && !this.is("[["))  //只能被注释与文本块与换行打断
                ti.value += this.shift();
            return false;
        }

        private align_test(ti: IToken) {
            this.save(); //这里会试着寻找满足自动对齐的条件
            do { // 这里其实可以加一个判定 如果已经在对齐的过程中 那么不需要再次做判断
                let tmp: IToken = { value: "", type: TokenType.Error };
                if (!this.try_read_key(tmp)) break;
                if ((tmp.value == "local" || tmp.value == "global") && !this.try_read_key(tmp)) break;
                tmp.value = "";
                this.read_space(tmp);
                if (tmp.value.length < 2) break;
                if (!this.is_symbol_h() || !this.is("=")) break;

                ti.flags = "---@align";
            } while (false);
            this.restore();
        }

        take(): IToken {
            let ti: IToken = { value: "", type: TokenType.Symbol, };
            if (this.is_space_h()) this.read_space();

            if (!this._bof) {
                this._bof = true;
                ti.type = TokenType.Bof;
                this.align_test(ti);
            } else if (this.eof()) {
                ti.type = TokenType.Eof;
            } else if (this.is_note_h()) {
                this.read_note(ti);
            } else if (this.is_num_h()) {
                this.read_num(ti);
            } else if (this.is("...")) {
                ti.value = this.shift(3);
            } else if (this.is_line_h()) {
                ti.value = this.is("\r\n") ? this.shift(2) : this.shift(1);
                ti.type = TokenType.Line;
                this.align_test(ti);
            } else if (["..", "::", ">>", "<<", "//", ">=", "<=", "==", "~="/** , "!=","++","--","+=","-=" */].some(k => this.is(k))) {
                ti.value = this.shift(2);
            } else if (this.is_str_h()) {
                this.read_str(ti);
            } else if (this.is_id_h()) {
                this.read_id(ti);
            } else if (this.some("(){}[]+-*/,><=;:#.^%&|~")) {
                ti.value = this.shift(1);
                let bks = ["function", "if", "(", "{", "[", "0", "]", "}", ")", "end", "end"]; //"({[0]})";
                let bi = bks.indexOf(ti.value);
                if (bi >= 0 && bks.length % 2) {
                    let v = -((bi + 1) - Math.ceil(bks.length / 2));
                    this._block += v / Math.abs(v);
                }
            } else {
                ti.type = TokenType.Error;
                ti.value = this.at();
            }
            ti.block = this._block;
            return ti;
        }
    }

    const prespace = ['%', '&', '*', '+', '-', '..', '/', '//', '<', '<<', '<=', '=', '==', '>', '>=', '>>', '^', 'and', 'do', 'end', 'or', 'return', 'then', '|', '~='];
    const sufspace = ['%', '&', '*', '+', ',', '-', '..', '/', '//', ';', '<', '<<', '<=', '=', '==', '>', '>=', '>>', '^', 'and', 'do', 'else', 'elseif', 'end', 'for', 'goto', 'if', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while', '|', '~='];

    let open = ['(', '[', 'do', 'function', 'if', 'repeat', '{'];
    let close = [')', ']', 'end', 'until', '}'];

    export type FormatError = { row: number, col: number, token: IToken, msg: string };
    type FormatState = { formatcode: string, cur: number, row: number, line_start_pos: number, tokens: IToken[], options: Options, error?: FormatError[] };

    function align(prespace: string, formatstate: FormatState): number {
        let tokens = formatstate.tokens;
        let j = formatstate.cur;
        let list = [];
        let lineCount = 0;
        let lastJ: number = j;
        for (; j < tokens.length;) {
            let kl = 0;
            let sk = tokens[j].value == "[";
            let block = tokens[j].block! - (sk ? 1 : 0);
            if (sk) {
                j++;
                if ([TokenType.ID, TokenType.String, TokenType.Number].indexOf(tokens[j].type) >= 0) j++; else break;
                if (tokens[j].value == "]") j++; else break;
                kl = 3;
            } else if (tokens[j].type == TokenType.ID) {
                let v = tokens[j].value;
                kl = 1;
                j++;
                if ((v == "local" || v == "global") && tokens[j].type == TokenType.ID) {
                    kl = 2;
                    j++;
                }
            } else
                break;
            if (tokens[j].value == "=") j++; else break;

            let vl = 0;
            while ([TokenType.Eof, TokenType.Line, TokenType.Error].indexOf(tokens[j].type) == -1) {
                vl++;
                j++;
            }

            if (tokens[j].block != block) break;
            if (tokens[j].type == TokenType.Error) break;
            if (tokens[j].type == TokenType.Line) j++; //吃掉本行的结尾

            lineCount++;
            list.push(kl, vl);
            lastJ = j;

            if (tokens[j].type == TokenType.Eof || tokens[j].type == TokenType.Line || tokens[j].value == "}") {
                //遇到两个换行当成结束处理
                break;
            }
        }

        if (lineCount > 1) {
            j = lastJ;
            let table = [];
            let kw = 0;
            let vw = 0;
            for (let i = 0, n = formatstate.cur; i < list.length; i += 2) {
                let key = format_token(tokens.slice(n, n + list[i]));
                n += list[i] + 1;
                let val = format_token(tokens.slice(n, n + list[i + 1] + 1));
                kw = Math.max(kw, key.length);
                vw = Math.max(vw, val.length);
                n += list[i + 1] + 1;
                let line = [key, val];
                table.push(line);
            }
            let formatcode = "";
            for (let i = 0; i < table.length; i++) {
                formatcode += `${i > 0 ? prespace : ""}${table[i][0]}${" ".repeat(kw - table[i][0].length)} = ${table[i][1]}`;
            }

            formatstate.row += list.length / 2;
            formatstate.formatcode += formatcode;
            formatstate.line_start_pos = formatstate.formatcode.length;
            formatstate.cur = j;
        }

        return 0;
    }

    function format_token(tokens: IToken[], formatstate?: FormatState) {
        let tabs = [];
        let tab = 0;
        let statcks = [];
        let curlineTab = 0;
        let fs: FormatState = formatstate || { formatcode: "", row: 0, line_start_pos: 0, cur: 0, tokens: tokens, options: { space: 4 } };
        function try_add_space() { fs.formatcode += (["\r\n", "\n", "\t", " "].indexOf(charAt(fs.formatcode, -1)!) >= 0) ? "" : " "; }

        let limit = tokens.length;
        while (fs.cur < tokens.length && --limit >= 0) {
            let { value: tk, type: tt } = tokens[fs.cur];
            let ntk: string, ntt: TokenType;
            if (fs.cur + 1 < tokens.length) { //next
                ntk = tokens[fs.cur + 1].value;
                ntt = tokens[fs.cur + 1].type;
            }
            if (tt == TokenType.Error) {
                try_add_space()
                let row = fs.row + 1, col = fs.formatcode.length - fs.line_start_pos;
                let error: FormatError = {
                    col: col,
                    row: row,
                    token: tokens[fs.cur],
                    msg: `Uncaught SyntaxError: Invalid or unexpected token "${tk}" ${row}:${col}`,
                };
                fs?.error?.push(error);
            } else if (tt == TokenType.Eof) {
                break;
            } else if (tt == TokenType.Note) {
                try_add_space()
            } else if (prespace.indexOf(tk) >= 0) {
                try_add_space()
            }
            fs.formatcode += tk;

            if (open.indexOf(tk) >= 0) {
                curlineTab++;
                statcks.push(tk);
            } else if (close.indexOf(tk) >= 0) {
                curlineTab--;
                statcks.pop();
            }
            let headspace = "";
            if (tt == TokenType.Line) {
                if (curlineTab > 0) {
                    tabs.push(curlineTab);
                } else if (curlineTab < 0) {
                    let dec = curlineTab;
                    while (tabs.length && (dec += tabs.pop()!) < 0) {
                        tab--;
                    }
                }

                fs.line_start_pos = fs.formatcode.length;
                fs.row++;
                tab += curlineTab ? (curlineTab / Math.abs(curlineTab)) : 0;
                curlineTab = 0;
                let isClose = ["elseif", "else", "then"].indexOf(ntk!) >= 0 || close.indexOf(ntk!) >= 0;
                if (!(ntt! == TokenType.Line)) { //下一行有内容的时候才添加tab
                    fs.formatcode += headspace = (" ".repeat(fs.options.space!)).repeat(Math.max(0, tab - (isClose ? 1 : 0)));
                }
            } else {
                let is_line_end = ntt! == TokenType.Line || ntt! == TokenType.Eof;
                if (!is_line_end) {
                    if (tk == ")" || tk == "}" || tk == "]" || tk == "end") {
                        if (!(!ntk! || ntk == "." || ntk == "(" || ntk == ")" || ntk == "{" || ntk == "}" || ntk == "[" || ntk == "]" || ntk == "," || ntk == ";" || ntk == ":")) {
                            try_add_space()
                        }
                    } else if (sufspace.indexOf(tk) >= 0) {
                        try_add_space()
                    } else {
                        if ([TokenType.String, TokenType.Number, TokenType.ID].indexOf(tt) >= 0 && [TokenType.String, TokenType.Number, TokenType.ID].indexOf(ntt!) >= 0) { //这里错误了
                            try_add_space()
                        }
                    }
                }
            }

            let needAlign = (tt == TokenType.Line || tt == TokenType.Bof) && tokens[fs.cur].flags == "---@align";
            fs.cur++;
            if (needAlign) {
                align(headspace, fs);
            }
        }

        return fs.formatcode;
    }

    export function styles(code: string, options?: Options, out_errors?: FormatError[]) {
        if (!code) return code;
        code += "";

        if (!options) options = {}
        if (!options.space) options.space = 4;

        let tk = new Tokenize(code);
        let tokens: IToken[] = [];
        let limit = code.length;
        do {
            let it = tk.take();
            tokens.push(it); // console.log(it)
            if (it.type == TokenType.Eof) {
                break;
            }
        } while (--limit > 0);  // 防止解析逻辑死循环 正常来说不会发生

        let fs: FormatState = { formatcode: "", row: 0, line_start_pos: 0, cur: 0, tokens: tokens, options: options, error: out_errors };
        return tokens[tokens.length - 1].type == TokenType.Eof ? format_token(tokens, fs) : code; //没有被正常的解析结束
    }
}

export = lua_sytles;