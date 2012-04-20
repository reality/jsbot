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

    this.events = {
        'JOIN': [],
        'PART': [],
        'KICK': [],
        'PRIVMSG': [],
        'MODE': []
    };
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

        event.raw = message;
        event.action = command;

        switch(command) {
            case 'JOIN': case 'PART':
                event.channel = parameters.split(':')[1];
                event.message = parameters.split(':')[1];  // only PARTs have this, so it'll be undefined in JOINs
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
                break;

            case 'KICK':
                event.channel = parameters.split(' ')[0];
                event.kickee = parameters.split(' ')[1];
                break;
        }

        if(command in this.events) {
            this.events[command].each(function(eventFunc) {
                if(Object.isFunction(eventFunc)) {
                    try {
                        eventFunc.call(this, event);
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

/**
 * Reply to an event with a PRIVMSG. Called by the Event.reply.
 */
JSBot.prototype.reply = function(event, msg) {
    this.connections[event.server].send('PRIVMSG', event.channel, ':' + msg);
};

/**
 * Add a listener function for a given event.
 */
JSBot.prototype.addListener = function(index, func) {
    if(!(index instanceof Array)) {
        index = [index];
    }

    index.each((function(eventType) {
        this.events[eventType].push(func);
    }).bind(this));
};

JSBot.prototype.join = function(event, channel) {
    this.connections[event.server].send('JOIN', channel);
};

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

    this.commands = {};
    this.encoding = 'utf8';
    this.lineBuffer = '';
    this.netBuffer = '';
    this.conn = null;
};

Connection.prototype.connect = function() {
    this.conn = net.createConnection(this.port, this.host);
    this.conn.setTimeout(60 * 60 * 1000);
    this.conn.setEncoding(this.encoding);
    this.conn.setKeepAlive(enable=true, 10000);

    this.conn.addListener('connect', function() {
        this.send('NICK', this.instance.nick);
        this.send('USER', this.instance.nick, '0', '*', this.instance.nick);
        //this.say(this.nickserv, 'identify ' + this.password);

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

Connection.prototype.send = function() {
    var message = [].splice.call(arguments, 0).join(' ');
    message += '\r\n';
    this.conn.write(message, this.encoding);
};

Connection.prototype.pong = function(message) {
    this.send('PONG', ':' + message.split(':')[1]);
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
