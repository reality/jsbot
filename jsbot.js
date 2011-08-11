require('prototype');
var sys = require('sys');
var net = require('net');

var JSBot = Class.create({
    initialize: function(nick, host, port, onReady) {
        this.nick = nick;
        this.host = host;
        this.port = port;
        this.encoding = 'utf8';
        this.lineBuffer = '';
        this.onReady = onReady;
        this.connect();
    },

    connect: function() {
        this.conn = net.createConnection(this.port, this.host);
        this.conn.setEncoding(this.encoding);

        this.conn.addListener('connect', function() {
            this.send('NICK', this.nick);
            this.send('USER', this.nick, '0', '*', this.nick);
            this.onReady();
        }.bind(this));

        this.conn.addListener('data', function(chunk) {
            this.lineBuffer += chunk;
            if(chunk.endsWith('\r\n')) {
                this.parse();
                this.lineBuffer = '';
            }
        }.bind(this));
    },

    send: function() {
        message = [].splice.call(arguments, 0).join(' ');
        message += '\r\n';
        this.conn.write(message, this.encoding);
    },

    join: function(channel) {
        this.send('JOIN', channel);
    },

    say: function(channel, message) {
        this.send('PRIVMSG', channel, ':' + message);
    },

    parse: function() {
        if(this.lineBuffer.startsWith('PING')) {
            this.pong(this.lineBuffer);
        }

        console.log('Got line: ' + this.lineBuffer);
    },

    pong: function(message) {
        this.send('PONG', ':' + message.split(':')[1]);
    }
});

exports.createJSBot = function(nick, host, port, onReady) {
    return new JSBot(nick, host, port, onReady);
};
