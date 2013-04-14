var _ = require('underscore')._,
    net = require('net'),
    tls = require('tls');

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
        'MODE': [],
        'KICK': []
    };
    this.addDefaultListeners();
};

/**
 * Add a new server connection.
 */
JSBot.prototype.addConnection = function(name, host, port, owner, onReady, nickserv, password, tlsOptions) {
    tlsOptions = tlsOptions || {};
    tlsOptions = _.defaults(tlsOptions, {rejectUnauthorized: false});
    this.connections[name] = new Connection(name, this, host, port, owner, onReady,
            nickserv, password, tlsOptions);
};

/**
 * Activate a named connection.
 */
JSBot.prototype.connect = function(name) {
    this.connections[name].connect();
    this.addListener('004', 'onReady', function(event) {
        var conn = this.connections[event.server];
        conn.instance.say(conn.name, conn.nickserv, 'identify ' + conn.password);
        conn.onReady(event);
    }.bind(this));
};

/**
 * Activate all of the connections.
 */
JSBot.prototype.connectAll = function() {
    _.each(this.connections, function(connection, name) {
        this.connect(name); 
    }, this);
};

/**
 * Take some input and populate an event object.
 */
JSBot.prototype.parse = function(connection, input) {
    var event = new Event(this);
    event.server = connection.name;

    if(input.substring(0, 4) == 'PING') { // ewwww
        this.connections[connection.name].pong(input);
    } else {
        var message = input.match(/(?:(:[^\s]+) )?([^\s]+) (.+)/);
        var prefix = message[1];
        var command = message[2];
        var parameters = message[3];

        try { // This could be nicer
            // the substring removes the : preceding the user's nick, while
            // the regex replace removes any special user mode symbols the
            // IRCd may have alerted us to (e.g. @ for op, + for voice)
            event.user = prefix.split('!')[0].substring(1).replace(/[~&@%+]/g, '');
        } catch(err) {
            event.user = false;
        }

        event.prefix = prefix;
        event.params = parameters;
        event.raw = message;
        event.action = command;
        event.time = new Date();

        switch(command) {
            case 'JOIN':
                event.channel = parameters.split(' ')[0];
                if(event.channel.charAt(0) == ':') event.channel = event.channel.substr(1);
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

            case 'NICK':
                event.newNick = parameters.split(' ')[0];
                if(event.newNick.substring(0, 1) == ":") {
                    event.newNick = event.newNick.substring(1);
                }
                event.channel = event.newNick
                break;

            case '474':
                event.channel = parameters.split(' ')[1];
                break;

            default:
                event.channel = parameters.split(' ')[0];
                event.message = parameters.split(' ')[1];
        }

        if(command == '366') {
            event.channel = event.message; // I don't even
        }
        
        if(event.channel === this.nick) {
            event.channel = event.user;
        } else {
            event.channel = this.connections[event.server].channels[event.channel];
        }
        event.allChannels = this.connections[event.server].channels;

        this.emit(event);
        console.log('line: ' + message[0]);
    }
};

JSBot.prototype.emit = function(event) {
    if(event.action in this.events) {
        _.each(this.events[event.action], function(listener) {
            var eventFunc = listener.listener;
            if(_.isFunction(eventFunc) && 
                (_.has(this.ignores, event.user) && _.include(this.ignores[event.user], listener.tag)) == false &&
                (_.has(this.ignores, event.channel) && _.include(this.ignores[event.channel], listener.tag)) == false) {
                try {
                    eventFunc.call(this, event);
                } catch(err) {
                    console.log('ERROR: ' + eventFunc + '\n' + err);
                    console.log(err.stack.split('\n')[1].trim());
                }
            }
        }, this);
    }
};

/**
 * Add a listener tag for an 'item' (channel or user) to ignore.
 */
JSBot.prototype.ignoreTag = function(item, tag) {
    if(!_.has(this.ignores, item)) {
        this.ignores[item] = [];
    }

    this.ignores[item].push(tag);
}

JSBot.prototype.clearIgnores = function() {
    this.ignores = {};
}

JSBot.prototype.removeIgnore = function(item, tag) {
    if(_.has(this.ignores, item) && _.include(this.ignores[item], tag)) {
        this.ignores[item].slice(this.ignores[item].indexOf(tag), 1);
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
 * Reply to an event with a NOTICE. Called by the Event.replyNotice.
 */
JSBot.prototype.replyNotice = function(event, msg) {
    this.connections[event.server].send('NOTICE', event.channel, ':' + msg);
}

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

    _.each(index, function(type) {
        if(!_.has(this.events, type)) this.events[type] = [];
        this.events[type].push(listener);
    }, this);
};

JSBot.prototype.join = function(event, channel) {
    this.connections[event.server].join(channel);
};

JSBot.prototype.part = function(event, channel) {
    this.connections[event.server].send('PART', channel);
    delete this.connections[event.server].channels[channel];
};

JSBot.prototype.mode = function(event, channel, msg) {
    this.connections[event.server].send('MODE', channel, msg);
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
        'MODE': [],
        'KICK': []
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
        event.params = event.params.match(/.+? [*|=|@] (#.+?) \:(.+)/);

        event.channel = event.allChannels[event.params[1]];
        var newNicks = event.params[2].trim().split(' ');
        var channelNicks = event.channel.nicks;

        for(var i=0;i<newNicks.length;i++) {
            // remove any user modes the IRCd may have put in the names list
            // (e.g. @ for op, + for voice)
            var name = newNicks[i].replace(/[~&@%+]/g, '');
            channelNicks[name] = {
                'name': name, 
                'op': false,
                'voice': false,
                'toString': function() {
                    return this.name;
                }
            };
            if(newNicks[i].indexOf('@') == 0) {
                channelNicks[name].op = true;
            }
            if(newNicks[i].indexOf('+') == 0) {
                channelNicks[name].voice = true;
            }
        }
    }.bind(this));

    this.addListener('JOIN', 'joinname', function(event) {
        if(event.user !== this.nick) {
            var channelNicks = event.channel.nicks;
            channelNicks[event.user] = {
                'name': event.user, 
                'op': false,
                'toString': function() {
                    return this.name;
                }
            };
        }
    });

    this.addListener('474', 'banname', function(event) {
	delete this.connections[event.server].channels[event.channel];
    }.bind(this));

    this.addListener('PART', 'partname', function(event) {
        var channelNicks = event.channel.nicks;
        delete channelNicks[event.user];
    });

    this.addListener('KICK', 'kickname', function(event) {
        var channelNicks = event.channel.nicks;
        delete channelNicks[event.user];
    });
    
    this.addListener('PRIVMSG', 'ping', function(event) {
        if(event.message.match(/\x01PING .+\x01/) !== null) {
            event.replyNotice(event.message);
        }
    });
};

///////////////////////////////////////////////////////////////////////////////

/**
 * Single connection to an IRC server. Managed by the JSBot object.
 */
var Connection = function(name, instance, host, port, owner, onReady, nickserv, password, tlsOptions) {
    this.name = name;
    this.instance = instance;
    this.host = host;
    this.port = port;
    this.owner = owner;
    this.onReady = onReady;
    this.nickserv = nickserv;
    this.password = password;
    this.tlsOptions = tlsOptions;

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
    if((typeof this.port == 'string' || this.port instanceof String) && 
        this.port.substring(0, 1) == '+') {
        this.conn = tls.connect(parseInt(this.port.substring(1)), this.host, this.tlsOptions);
    } else {
        this.conn = net.createConnection(this.port, this.host);
    }
    this.conn.setTimeout(60 * 60 * 1000);
    this.conn.setEncoding(this.encoding);
    this.conn.setKeepAlive(enable=true, 10000);

    connectListener = function() {
        this.send('NICK', this.instance.nick);
        this.send('USER', this.instance.nick, '0', '*', this.instance.nick);
    }
    this.conn.addListener('connect', connectListener.bind(this));
    this.conn.addListener('secureConnect', connectListener.bind(this));

    this.conn.addListener('data', function(chunk) {
	this.netBuffer += chunk;
        var ind;
        while((ind = this.netBuffer.indexOf('\r\n')) != -1) {
            this.lineBuffer = this.netBuffer.substring(0, ind);
            this.instance.parse(this, this.lineBuffer);
            this.netBuffer = this.netBuffer.substring(ind+2);
        }
    }.bind(this));

    setInterval(this.updateNickLists.bind(this), 1200000);
};

Connection.prototype.updateNickLists = function() {
    for(var channel in this.channels) {
        if(_.has(this.channels, channel)) {
            this.channels[channel] = {
                'name': channel,
                'nicks': {},
                'toString': function() {
                    return this.name;
                }
            };
            this.send('NAMES ' + channel);
        }
    }
}

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
        'name': channel,
        'nicks': {},
        'toString': function() {
            return this.name;
        }
    };
};

///////////////////////////////////////////////////////////////////////////////

var Event = function(instance) {
    this.instance = instance;
};

Event.prototype.reply = function(msg) {
    this.instance.reply(this, msg);
};

Event.prototype.replyNotice = function(msg) {
    this.instance.replyNotice(this, msg);
}

///////////////////////////////////////////////////////////////////////////////

exports.createJSBot = function(name) {
    return new JSBot(name);
};
