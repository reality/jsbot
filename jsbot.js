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
        this.events = {
            'JOIN': null,
            'PART': null,
            'PRIVMSG': null
        };
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
        } else {
            var message = this.lineBuffer.match(/(?:(:[^\s]+) )?([^\s]+) (.+)/);
            var prefix = message[1];
            var command = message[2];
            var parameters = message[3];
            var data = {
                'raw': message,
                'user': prefix.split('!')[0].substring(1)
            };

            // TODO: Further regex to avoid all this stringwork?
            switch(command) {
                case 'JOIN': case 'PART':
                    data['channel'] = parameters.split(':')[1];
                    break;

                case 'PRIVMSG':
                    data['channel'] = parameters.split(' ')[0];
                    data['message'] = parameters.split(':')[1]
                    break;
            }

            if(Object.isFunction(this.events[command])) {
                this.events[command](data);
            }

            // DEBUG
            //console.log('line: ' + message[0]);
            //console.log('prefix: ' + message[1]);
            //console.log('command: ' + message[2]);
            //console.log('params: ' + message[3]);
        }
    },

    pong: function(message) {
        this.send('PONG', ':' + message.split(':')[1]);
    },

    addListener: function(index, func) {
        this.events[index] = func;
    }
});

exports.createJSBot = function(nick, host, port, onReady) {
    return new JSBot(nick, host, port, onReady);
};
