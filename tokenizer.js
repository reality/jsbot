/*
 * String tokenizer thing.
 * by speeddefrost <origin206@protonmail.ch>
 */

function Tokenizer(str) {
    this.str = str;
    this.pos = 0;
}

Tokenizer.prototype.tokenize = function(delim) {
    if(this.pos == -1)
        return null;

    if(!delim) {
        var leftover = this.str.slice(this.pos);
        this.pos = -1;
        return leftover;
    }

    var i = this.pos,
        j = this.pos + delim.length
        z = this.str.length - delim.length;

    while(i <= z) {
        if(this.str.substring(i,j) == delim) {
            var token = this.str.substring(this.pos, i);
            this.pos = j;
            return token;
        }

        ++i; ++j;
    }

    return null;
}

module.exports = Tokenizer;
