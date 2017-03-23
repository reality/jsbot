/*
 * String tokenizer thing.
 * by speeddefrost <origin206@protonmail.ch>
 */

function Tokenizer(str) {
    this.str = str;
    this.pos = 0;
}

Tokenizer.prototype.tokenize = function(delim) {
    var r;

    if(this.pos == -1) {
        return null;
    }

    if(!delim) {
        r = this.str.slice(this.pos);
        this.pos = -1;
        return r;
    }

    var max = this.str.length - delim.length;
    for(var i=this.pos, j=this.pos+delim.length; i <= max; ++i,++j) {
        if(this.str.substring(i,j) == delim) {
            r = this.str.substring(this.pos, i);
            this.pos = j;
            break;
        }
    }

    return r;
}

module.exports = Tokenizer;
