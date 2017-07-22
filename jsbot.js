//
// JSBot
// ------
//
// Andrew Felske <origin206@protonmail.ch> [rewrite]
// Luke Slater <tinmachin3@gmail.com>
//

var _ = require('underscore')._,
    net = require('net'),
    async = require('async'),
    tls = require('tls'),
    Tokenizer = require('./tokenizer');

// main JSBot object

var JSBot = function(nick, debug) {
    this.nick = nick;
    this.connections = {};
    this.preEmitHooks = [];
    this.listeners = [];
    this.ignores = {};
    this.debug = debug;
    this.addDefaultListeners();
};

JSBot.prototype.debugp = function(msg) {
    if(this.debug)
        console.log(msg);
};

// client functionality

JSBot.prototype.say = function(server, channel, msg) {
    var event = new Event(this);
    event.server = server;
    event.channel = channel;
    event.msg = msg;
    event.reply(msg);
};

JSBot.prototype.reply = function(event, msg) {
    this.connections[event.server].send('PRIVMSG', event.channel, ':' + msg);
};

JSBot.prototype.act = function(event, msg) {
    this.connections[event.server].send('PRIVMSG', event.channel, '\001ACTION ' + msg + '\001');
}

JSBot.prototype.replyNotice = function(event, msg) {
    this.connections[event.server].send('NOTICE', event.user , ':' + msg);
}

JSBot.prototype.join = function(event, channel) {
    this.connections[event.server].join(channel);
};

JSBot.prototype.part = function(event, channel) {
    this.connections[event.server].part(channel);
};

JSBot.prototype.mode = function(event, channel, msg) {
    this.connections[event.server].send('MODE', channel, msg);
}

JSBot.prototype.nick = function(event, nick) {
    this.connections[event.server].send('NICK', nick);
}

// connections

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
    this.netBuffer = '';
    this.conn = null;
    this.lastSent = Date.now();
};

Connection.prototype.connect = function() {
    if((typeof this.port == 'string' || this.port instanceof String) && this.port.substring(0, 1) == '+')
        this.conn = tls.connect(parseInt(this.port.substring(1)), this.host, this.tlsOptions);
    else
        this.conn = net.createConnection(this.port, this.host);

    this.conn.setTimeout(60 * 60 * 1000);
    this.conn.setEncoding(this.encoding);
    this.conn.setKeepAlive(enable=true, 10000);

    connectListener = function() {
        this.send('NICK', this.instance.nick);
        this.send('USER', this.instance.nick, '0', '*', this.instance.nick);
    }.bind(this);

    this.conn.addListener('connect', connectListener.bind(this));
    this.conn.addListener('secureConnect', connectListener.bind(this));

    this.conn.addListener('data', function(chunk) {
        this.netBuffer += chunk;

        var t = new Tokenizer(this.netBuffer);
            lines = [];

        while(true) {
            var line = t.tokenize('\r\n');
            if(line == null) {
                this.netBuffer = t.tokenize(null);
                break;
            }

            lines.push(line);
        }

        async.eachSeries(
            lines,
            function(line, callback) {
                this.instance.parse(this, line, callback);
            }.bind(this)
        );
    }.bind(this));
};

// connection-specific client functions

Connection.prototype.send = function() {
    var args = Array.prototype.slice.call(arguments),
        message = args.join(" ") + "\r\n";

    this.conn.write(message, this.encoding);
    this.lastSent = Date.now();
};

Connection.prototype.pong = function(message) {
    this.send('PONG', ':' + message.split(':')[1]);
};

Connection.prototype.join = function(channel) {
    this.send('JOIN', channel);
};

Connection.prototype.part = function(channel) {
    this.send('PART', channel);
};

// connection management

JSBot.prototype.addConnection = function(name, host, port, owner, onReady, nickserv, password, tlsOptions) {
    tlsOptions = tlsOptions || {};
    tlsOptions = _.defaults(tlsOptions, {rejectUnauthorized: false});
    this.connections[name] = new Connection(name, this, host, port, owner, onReady,
                                            nickserv, password, tlsOptions);
};

JSBot.prototype.connect = function(name) {
    var conn = this.connections[name];
    conn.connect();

    this.addListener('001', 'onReady', function(event) {
        conn.instance.say(conn.name, conn.nickserv, 'IDENTIFY ' + this.nick + " " + conn.password);
        if(conn.onReady != null)
            conn.onReady(event);
    });
};

JSBot.prototype.connectAll = function() {
    _.each(this.connections, function(connection, name) {
        this.connect(name);
    }, this);
};

// event parsing and processing

JSBot.prototype.parse = function(connection, input, parseCallback) {
    var event = new Event(this),
        t = new Tokenizer(input);

    this.debugp(input);

    event.server = connection.name;
    event.allChannels = this.connections[event.server].channels;

    if(input[0] == ':') {
        // consume to next whitespace, strip leading ':'
        var prefix = t.tokenize(' '),
            maskMatch = prefix.match(/:(.+)!(.+)@(.+)/);

        if(maskMatch && maskMatch.length == 4) {
            event.user = maskMatch[1];
            event.ident = maskMatch[2];
            event.host = maskMatch[3];
        }
        else {
            event.host = prefix.substring(1);
        }
    }

    /* parameter string extraction */

    // try consuming to beginning of a message
    var paramsStr = t.tokenize(' :');
    if(!paramsStr) {
        // if that fails (no message), fall back to line ending
        paramsStr = t.tokenize(null);
    }
    else {
        // first attempt succeeded, extract message
        event.message = t.tokenize(null);
    }

    // split the parameter string
    event.args = paramsStr.split(' ');
    // use first item as action, remove from list
    event.action = event.args.shift();

//  -- Common Event Variables --
//  All channel/nick/target parameters in server-to-client events are accounted for here.
//  Others need to be handled manually via event.args.

    if (/^\d+$/.test(event.action)) {
        var rsp =             parseInt(event.action),
            nickRsps =        [ 301, 311, 312, 313, 317, 318, 319, 314,
                                369, 322, 324, 401, 406, 432, 433, 436 ],
            channelRsps =     [ 322, 324, 331, 332, 346, 347, 348, 349,
                                366, 367, 368, 403, 404, 405, 467, 471,
                                473, 474, 475, 476, 477, 478, 482 ],
            channelNickRsps = [ 325, 341 ],
            targetRsps =      [ 407, 437 ];

        if(nickRsps.indexOf(rsp) != -1) {
            event.user = event.args[0];
        }
        else if(channelRsps.indexOf(rsp) != -1) {
            event.channel = event.args[0];
        }
        else if(channelNickRsps.indexOf(rsp) != -1) {
            event.channel = event.args[0];
            event.user = event.args[1];
        }
        else if(targetRsps.indexOf(rsp) != -1) {
            if ('&#!+.~'.indexOf(event.args[0][0]) != -1) {
                event.channel = event.args[0];
            } else {
                event.user = event.args[0];
            }
        }
        else if(rsp == 352) {
            event.channel = event.args[0];
            event.user = event.args[4];
        }
        else if(rsp == 353) {
            event.channel = event.args[2];
        }
        else if(rsp == 441) {
            event.user = event.args[0];
            event.channel = event.args[1];
        }
    }
    else {
        if(event.action == 'PRIVMSG') {
            if('&#!+.~'.indexOf(event.args[0][0]) != -1) {
                event.channel = event.args[0];
            }
        }
        else if(event.action == 'JOIN' ||
                event.action == 'PART' ||
                event.action == 'TOPIC')
        {
            event.channel = event.args[0];
        }
        else if(event.action == 'KICK') {
            event.channel = event.args[0];
            event.targetUser = event.args[1];
       }
        else if(event.action == 'NICK') {
            event.newNick = event.args[1];
            event.multiChannel = true;
        }
        else if(event.action == 'MODE') {
            event.channel = event.args[0];
            event.modeChanges = event.args[1];
            if(event.args.length > 2)
                event.targetUsers = event.args.slice(2);
        }
        else if(event.action == 'QUIT') {
            event.multiChannel = true;
        }

        if(event.multiChannel) {
            // populate a list of channels this event applies to
            event.channels = [];
            _.each(event.allChannels, function(channel) {
                _.each(channel.nicks, function(nick) {
                    if(nick == event.user)
                        event.channels.push(channel);
                });
            });
        }
        else if(event.channel) {
            if(_.has(event.allChannels, event.channel))
                event.channel = event.allChannels[event.channel];
        }
        else {
            event.channel = {
                'name': event.user,
                'nicks': {},
                'toString': function() {
                    return this.name;
                }
            }
        }
    }

    if(event.message)
        event.params = event.message.split(' ');
    else
        event.params = [];

    async.eachSeries(
        this.preEmitHooks,
        function(hook, callback) {
            hook(event, callback);
        },
        function(err) {
            this.emit(event);
            // continue to the next parse operation
            parseCallback();
        }.bind(this)
    );
};

// pre-emit hooks

JSBot.prototype.addPreEmitHook = function(func) {
    this.preEmitHooks.push(func);
};

JSBot.prototype.clearHooks = function() {
    this.preEmitHooks = [];
};

JSBot.prototype.emit = function(event) {
    _.each(this.listeners, function(listener) {
        var channel;
        if(event.channel)
            channel = event.channel;
        else
            channel = null;

        if(_.contains(listener.actions, event.action) && _.isFunction(listener.callback) &&
           (_.has(this.ignores, event.user) && _.include(this.ignores[event.user], listener.tag)) == false &&
           (_.has(this.ignores, channel) && _.include(this.ignores[channel], listener.tag)) == false)
        {
            try {
                listener.callback.call(this, event);
            }
            catch(err) {
                this.debugp('ERROR: ' + listener.callback + '\n' + err);
                this.debugp(err.stack.split('\n')[1].trim());
            }
        }
    }.bind(this));
};

// listeners

JSBot.prototype.addListener = function(actions, tag, cb) {
    if(actions instanceof Array == false)
        actions = [actions];

    var listener = {
        'actions': actions,
        'tag': tag,
        'callback': cb
    };

    this.listeners.push(listener);
};

JSBot.prototype.removeListeners = function() {
    this.listeners = [];
    this.addDefaultListeners();
};

JSBot.prototype.addDefaultListeners = function() {
    // PINGS
    this.addListener('PING', 'ping-core', function(event) {
        this.connections[event.server].pong(event.message);
        this.debugp(">> PONG " + event.message);
    }.bind(this));

    this.addListener('PRIVMSG', 'notice-ping-core', function(event) {
        if(event.message.match(/\x01PING .+\x01/) != null)
            event.replyNotice(event.message);
    });

    // JOIN
    this.addListener('JOIN', 'join-core', function(event) {
        if(event.user == this.nick) {
            this.connections[event.server].channels[event.channel] = {
                'name': event.channel,
                'nicks': {},
                'toString': function() {
                    return this.name;
                }
            };

        }

        this.connections[event.server].channels[event.channel].nicks[event.user] = {
            'name': event.user,
            'op': false,
            'voice': false,
            'toString': function() {
                return this.name;
            }
        };

        event.channel = this.connections[event.server].channels[event.channel];
        event.user = this.connections[event.server].channels[event.channel].nicks[event.user];

        this.debugp(">> JOIN [" + event.channel + "] " + event.user);
    }.bind(this));

    // PART
    this.addListener('PART', 'part-core', function(event) {
        if(event.user == this.nick)
            delete this.connections[event.server].channels[event.channel];
        else
            delete this.connections[event.server].channels[event.channel].nicks[event.user];

        this.debugp(">> PART [" + event.channel + "] " + event.user);
    }.bind(this));

    // KICK
    this.addListener('KICK', 'kick-core', function(event) {
        if(event.targetUser == this.nick)
            delete this.connections[event.server].channels[event.channel];
        else
            delete this.connections[event.server].channels[event.channel].nicks[event.user];

        this.debugp(">> KICK [" + event.channel + "] " + event.user);
    }.bind(this));

    // MODE
    this.addListener('MODE', 'mode-core', function(event) {
        if(!event.modeChanges || !event.targetUsers)
            return;

        var changesets = event.modeChanges.match(/[+-][a-zA-Z]+/g);
        if(!changesets)
            return;

        var max = _.min([changesets.length, event.targetUsers.length]);
        for(var i=0; i < max; ++i) {
            var user = event.channel.nicks[event.targetUsers[i]];
            if(_.has(event.channel.nicks, user)) {
                var value;
                _.each(changesets[i], function(c) {
                    if(c == '+')
                        value = true;
                    else if(c == '-')
                        value = false;
                    else if(c == 'o')
                        user.op = value;
                    else if(c == 'v')
                        user.voice = value;
                });

                this.debugp(">> MODE [" + event.channel + "]" + user + " [op:" + user.op + " voice:" + user.voice + "]");
            }
        }
    });

    // NICK
    this.addListener('NICK', 'nick-core', function(event) {
        if(event.user == this.nick) {
            this.nick = event.newNick;
        }
        else {
            _.each(event.allChannels, function(channel) {
                if(_.has(channel.nicks, event.user)) {
                    channel.nicks[event.newNick] = channel.nicks[event.user];
                    channel.nicks[event.newNick].name = event.newNick;
                    delete channel.nicks[event.user];
                }
            });
        }

        this.debugp(">> NICK " + event.user + " -> " + event.newNick);
    }.bind(this));

    // QUIT
    this.addListener('QUIT', 'quit-core', function(event) {
        _.each(event.allChannels, function(channel) {
            delete event.allChannels[channel].nicks[event.user];
        });

        this.debugp(">> QUIT " + event.user);
    });

    // 353 replies
    this.addListener('353', 'names-core', function(event) {
        this.debugp(">> 353 " + event.channel);

        _.each(event.params, function(param) {
            var hasFlag = '~&@%+'.indexOf(param[0]) != -1,
                name = hasFlag ? param.slice(1) : param;

            this.connections[event.server].channels[event.channel].nicks[name] = {
                'name': name,
                'op': hasFlag && param[0] == '@',
                'voice': hasFlag && param[0] == '+',
                'toString': function() {
                    return this.name;
                }
            };

            this.debugp(" > " + name);
        }.bind(this));
    });
};

// ignore functionality

JSBot.prototype.ignoreTag = function(item, tag) {
    if(_.has(this.ignores, item) == false)
        this.ignores[item] = [];

    this.ignores[item].push(tag);
}

JSBot.prototype.clearIgnores = function() {
    this.ignores = {};
}

JSBot.prototype.removeIgnore = function(item, tag) {
    if(_.has(this.ignores, item) && _.include(this.ignores[item], tag))
        this.ignores[item].slice(this.ignores[item].indexOf(tag), 1);
}

// events

var Event = function(instance) {
    this.instance = instance;
};

Event.prototype.reply = function(msg) {
    this.instance.reply(this, msg);
};

Event.prototype.replyNotice = function(msg) {
    this.instance.replyNotice(this, msg);
}

// export that shit

exports.createJSBot = function(name, debug) {
    return new JSBot(name, debug);
};
