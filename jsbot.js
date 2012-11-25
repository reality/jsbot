var net = require('net');
require('./snippets');

/**
 * Javascript IRC bot library! Deal with it.
 *
 * This class itself manages Connection objects, the event listeners and 
 * provides the client-code interface for the library.
 */
var JSBot = function(nick) {
    this.nick = nick;
    this.connections = {};
    this.ignores = {};

    this.events = {
        'JOIN': [],
        'PART': [],
        'KICK': [],
        'PRIVMSG': [],
        'MODE': []
    };
    this.addDefaultListeners();
};

/**
 * Add a new server connection.
 */
JSBot.prototype.addConnection = function(name, host, port, owner, onReady, nickserv, password) {
    this.connections[name] = new Connection(name, this, host, port, owner, onReady,
            nickserv, password);
};

/**
 * Activate a named connection.
 */
JSBot.prototype.connect = function(name) {
    this.connections[name].connect();
};

/**
 * Activate all of the connections.
 */
JSBot.prototype.connectAll = function() {
    for(var name in this.connections) {
        if(this.connections.hasOwnProperty(name)) {
            this.connections[name].connect();
        }
    }
};

/**
 * Take some input and populate an event object.
 */
JSBot.prototype.parse = function(connection, input) {
    var event = new Event(this);
    event.server = connection.name;

    if(input.startsWith('PING')) {
        this.connections[connection.name].pong(input);
    } else {
        var message = input.match(/(?:(:[^\s]+) )?([^\s]+) (.+)/);
        var prefix = message[1];
        var command = message[2];
        var parameters = message[3];

        try { // This could be nicer
            event.user = prefix.split('!')[0].substring(1);
        } catch(err) {
            event.user = false;
        }

        event.prefix = prefix;
        event.params = parameters;
        event.raw = message;
        event.action = command;

        switch(command) {
            case 'JOIN':
                event.channel = parameters.split(':')[1];
                event.message = parameters.split(':')[1];
                break;

            case 'PART': 
                event.channel = parameters;
                break;

            case 'MODE': // This is probably broken
                event.channel = parameters.split(' ')[0];
                event.modeChanges = parameters.split(' ')[1];
                event.targetUser = parameters.split(' ')[2];
                break;

            case 'PRIVMSG':
                var colonSplit = parameters.split(':');
                event.channel = parameters.split(' ')[0];
                event.message = colonSplit.slice(1, colonSplit.length).join(':');
                event.params = event.message.split(' ');
                break;

            case 'KICK':
                event.channel = parameters.split(' ')[0];
                event.kickee = parameters.split(' ')[1];
                break;

            default:
                event.channel = parameters.split(' ')[0];
                event.message = parameters.split(' ')[1];
        }
        
        if(event.channel === this.nick) event.channel = event.user;
        this.emit(event);
        console.log('line: ' + message[0]);
    }
};

JSBot.prototype.emit = function(event) {
    if(event.action in this.events) {
        this.events[event.action].each(function(listener) {
            var eventFunc = listener.listener;
            if(Object.isFunction(eventFunc) && (this.ignores.hasOwnProperty(event.user) && 
                    this.ignores[event.user].include(listener.tag)) == false) {
                try {
                    eventFunc.call(this, event);
                } catch(err) {
                    console.log('ERROR: ' + eventFunc + '\n' + err);
                }
            }
        }.bind(this));
    }
};

/**
 * Add a listener tag for a user to ignore.
 */
JSBot.prototype.ignoreTag = function(user, tag) {
    if(!this.ignores.hasOwnProperty(user)) {
        this.ignores[user] = [];
    }

    this.ignores[user].push(tag);
}

JSBot.prototype.clearIgnores = function() {
    this.ignores = {};
}

JSBot.prototype.removeIgnore = function(user, tag) {
    if(this.ignores.hasOwnProperty(user) && this.ignores[user].include(tag)) {
        this.ignores[user].slice(this.ignores[user].indexOf(tag), 1);
    }
}

/**
 * Say something in a given server and channel.
 */
JSBot.prototype.say = function(server, channel, msg) {
    var event = new Event(this);
    event.server = server;
    event.channel = channel;
    event.msg = msg;

    event.reply(msg);
};

/**
 * Reply to an event with a PRIVMSG. Called by the Event.reply.
 */
JSBot.prototype.reply = function(event, msg) {
    this.connections[event.server].send('PRIVMSG', event.channel, ':' + msg);
};

/**
 * Add a listener function for a given event.
 */
JSBot.prototype.addListener = function(index, tag, func) {
    if(!(index instanceof Array)) {
        index = [index];
    }

    var listener = {
        'listener': func,
        'tag': tag
    };

    index.each((function(eventType) {
        if(!this.events.hasOwnProperty(eventType)) {
            this.events[eventType] = [];
        }
        this.events[eventType].push(listener);
    }).bind(this));
    console.log('Added listener for ' + index);
};

JSBot.prototype.join = function(event, channel) {
    this.connections[event.server].join(channel);
};

JSBot.prototype.part = function(event, channel) {
    this.connections[event.server].send('PART', channel);
};

JSBot.prototype.mode = function(event, msg) {
    this.connections[event.server].send('MODE', event.channel, msg);
}

/**
 * Remove all of the listeners and reset the map.
 */
JSBot.prototype.removeListeners = function() {
    this.events = {
        'JOIN': [],
        'PART': [],
        'KICK': [],
        'PRIVMSG': [],
        'MODE': []
    };
    this.addDefaultListeners();
};

/**
 * Default listeners to handle a channel nicklist.
 *
 * TODO: I'd like to split this out into its own file, and perhaps it could 
 *  act as a jsbot plugin?
 */
JSBot.prototype.addDefaultListeners = function() {
    this.addListener('353', 'names', function(event) {
        event.params = event.params.match(/.+? = (#.+?) \:(.+)/);
        event.channel = event.params[1];
        var newNicks = event.params[2].trim().split(' ');
        var channelNicks = this.connections[event.server].channels[event.channel].nicks;

        for(var i=0;i<newNicks.length;i++) {
            channelNicks.push(newNicks[i].replace(/@/g, ''));
        }
    }.bind(this));

    this.addListener('JOIN', 'joinname', function(event) {
        if(event.user !== this.nick) {
            var channelNicks = this.connections[event.server].channels[event.channel].nicks;
            channelNicks.push(event.user);
        }
    });

    this.addListener('PART', 'partname', function(event) {
        var channelNicks = this.connections[event.server].channels[event.channel].nicks;
        channelNicks.splice(channelNicks.indexOf(event.user), 1);
    });
};

///////////////////////////////////////////////////////////////////////////////

/**
 * Single connection to an IRC server. Managed by the JSBot object.
 */
var Connection = function(name, instance, host, port, owner, onReady, nickserv, password) {
    this.name = name;
    this.instance = instance;
    this.host = host;
    this.port = port;
    this.owner = owner;
    this.onReady = onReady;
    this.nickserv = nickserv;
    this.password = password;

    this.channels = {};
    this.commands = {};
    this.encoding = 'utf8';
    this.lineBuffer = '';
    this.netBuffer = '';
    this.conn = null;
};

/**
 * Actually connect to the IRC server with the information given in the
 * constructor.
 */
Connection.prototype.connect = function() {
    this.conn = net.createConnection(this.port, this.host);
    this.conn.setTimeout(60 * 60 * 1000);
    this.conn.setEncoding(this.encoding);
    this.conn.setKeepAlive(enable=true, 10000);

    this.conn.addListener('connect', function() {
        this.send('NICK', this.instance.nick);
        this.send('USER', this.instance.nick, '0', '*', this.instance.nick);
        this.instance.say(this.name, this.nickserv, 'identify ' + this.password);

        var readyEvent = new Event(this.instance);
        readyEvent.server = this.name;
        this.onReady(readyEvent);
    }.bind(this));

    this.conn.addListener('data', function(chunk) {
	this.netBuffer += chunk;
        var ind;
        while((ind = this.netBuffer.indexOf('\r\n')) != -1) {
            this.lineBuffer = this.netBuffer.substring(0, ind);
            this.instance.parse(this, this.lineBuffer);
            this.netBuffer = this.netBuffer.substring(ind+2);
        }
    }.bind(this));

};

/**
 * Takes variable number of arguments, joins them into a string split by spaces
 * and sends to the server.
 */
Connection.prototype.send = function() {
    var message = [].splice.call(arguments, 0).join(' ');
    message += '\r\n';
    this.conn.write(message, this.encoding);
};

/**
 * Send a pong response to a ping from the server.
 */
Connection.prototype.pong = function(message) {
    this.send('PONG', ':' + message.split(':')[1]);
};

Connection.prototype.join = function(channel) {
    this.send('JOIN', channel); 
    this.channels[channel] = {
        'nicks': []
    };
};

///////////////////////////////////////////////////////////////////////////////

var Event = function(instance) {
    this.instance = instance;
};

Event.prototype.reply = function(msg) {
    this.instance.reply(this, msg);
};

///////////////////////////////////////////////////////////////////////////////

exports.createJSBot = function(name) {
    return new JSBot(name);
};
