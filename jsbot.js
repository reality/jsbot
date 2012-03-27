var sys = require('sys');
var net = require('net');

var JSBot = function(nick, host, port, owner, onReady, nickserv, password) {
    this.nick = nick;
    this.host = host;
    this.port = port;
    this.nickserv = nickserv;
    this.password = password;
    this.owner = owner;
    this.channels = [];
    this.commands = {};
    this.encoding = 'utf8';
    this.lineBuffer = '';
    this.netBuffer = '';
    this.onReady = onReady;
    this.events = {
        'JOIN': [],
        'PART': [],
        'KICK': [],
        'PRIVMSG': [],
        'MODE': []
    };
};

JSBot.prototype.inChannel = function(channel) {
    if(this.channels.include(channel)) {
        return true;
    } else {
        return false;
    }
};

JSBot.prototype.connect = function() {
    this.conn = net.createConnection(this.port, this.host);
    this.conn.setTimeout(60 * 60 * 1000);
    this.conn.setEncoding(this.encoding);
    this.conn.setKeepAlive(enable=true, 10000);

    this.conn.addListener('connect', function() {
        this.send('NICK', this.nick);
        this.send('USER', this.nick, '0', '*', this.nick);
        this.say(this.nickserv, 'identify ' + this.password);
        this.onReady();
    }.bind(this));

    this.conn.addListener('data', function(chunk) {
	this.netBuffer += chunk;
        var ind;
        while( (ind = this.netBuffer.indexOf( '\r\n' )) != -1 )
        {
            this.lineBuffer = this.netBuffer.substring(0, ind);
            this.parse();
            this.netBuffer = this.netBuffer.substring(ind+2);
        }
    }.bind(this));

    this.conn.addListener('end', function() {
        this.connect();
    }.bind(this));
};

JSBot.prototype.send = function() {
    var message = [].splice.call(arguments, 0).join(' ');
    message += '\r\n';
    this.conn.write(message, this.encoding);
};

JSBot.prototype.join = function(channel) {
    this.send('JOIN', channel);
    this.channels.push(channel);
};

JSBot.prototype.part = function(channel) {
    this.send('PART', channel);
    this.channels.remove(channel);
};

JSBot.prototype.say = function(channel, message) {
    this.send('PRIVMSG', channel, ':' + message);
};

JSBot.prototype.parse = function() {
    if(this.lineBuffer.startsWith('PING')) {
        this.pong(this.lineBuffer);
    } else {
        var message = this.lineBuffer.match(/(?:(:[^\s]+) )?([^\s]+) (.+)/);
        var prefix = message[1];
        var command = message[2];
        var parameters = message[3];
        try {
            var data = {
                'raw': message,
                'user': prefix.split('!')[0].substring(1)
            };
        } catch(err) {
            var data = {
                'raw': message,
                'user': 'none'
            };
        }

        // TODO: Further regex to avoid all this stringwork?
        switch(command) {
            case 'JOIN': case 'PART':
                data['channel'] = parameters.split(' ')[0];
                data['message'] = parameters.split(':')[1];  // only PARTs have this, so it'll be undefined in JOINs
                break;

            case 'MODE':
                data['channel'] = parameters.split(' ')[0];
                data['modeChanges'] = parameters.split(' ')[1];
                data['targetUser'] = parameters.split(' ')[2];
                break;

            case 'PRIVMSG':
                var colonSplit = parameters.split(':');
                data['channel'] = parameters.split(' ')[0];
                data['message'] = colonSplit.slice(1, colonSplit.length).join(':');
                break;

            case 'KICK':
                data['channel'] = parameters.split(' ')[0];
                data['kickee'] = parameters.split(' ')[1];
                break;
        }

        if(command in this.events) {
            this.events[command].each(function(eventFunc) {
                if(Object.isFunction(eventFunc)) {
                    try {
                        eventFunc.call(this.owner, data, command);
                    } catch(err) {
                        console.log('ERROR: ' + eventFunc + '\n' + err);
                    }
                }
            });
        }

        // DEBUG
        console.log('line: ' + message[0]);
    }
};

JSBot.prototype.pong = function(message) {
    this.send('PONG', ':' + message.split(':')[1]);
    console.log('PONG');
};

JSBot.prototype.addListener = function(index, func) {
    if(!(index instanceof Array)) {
        index = [index];
    }
    index.each((function(eventType) {
        this.events[eventType].push(func);
    }).bind(this));
};

JSBot.prototype.removeListeners = function() {
    this.events = {
        'JOIN': [],
        'PART': [],
        'KICK': [],
        'PRIVMSG': [],
        'MODE': []
    };
};

exports.createJSBot = function(nick, host, port, owner, onReady, nickserv, password) {
    return new JSBot(nick, host, port, owner, onReady, nickserv, password);
};
