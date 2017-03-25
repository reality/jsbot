var _ = require('underscore')._,
    net = require('net'),
    async = require('async'),
    tls = require('tls'),
    Tokenizer = require('./tokenizer');

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
    this.preEmitHooks = [];
    this.events = {
        'JOIN': [],
        'PART': [],
        'QUIT': [],
        'NICK': [],
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
    var conn = this.connections[name];
    this.addListener('004', 'onReady', function(event) {
        conn.instance.say(conn.name, conn.nickserv, 'identify ' + conn.password);
        setTimeout(function(){conn.onReady(event);},5000);
    }.bind(this));
    conn.instance.say(conn.name, conn.nickserv, 'identify ' + conn.password);
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
    var event = new Event(this),
        t = new Tokenizer(input);

    console.log(input);

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
    } else {
        // first attempt succeeded, extract message
        event.message = t.tokenize(null);
    }

    // split the parameter string
    event.params = paramsStr.split(' ');
    // use first item as action, remove from list
    event.action = event.params.shift();

//  -- Common Event Variables --
//  All channel/nick/target parameters in server-to-client events are accounted for here.
//  Others need to be handled manually via event.params.

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
            event.user = event.params[0];
        }
        else if(channelRsps.indexOf(rsp) != -1) {
            event.channel = event.params[0];
        }
        else if(channelNickRsps.indexOf(rsp) != -1) {
            event.channel = event.params[0];
            event.user = event.params[1];
        }
        else if(targetRsps.indexOf(rsp) != -1) {
            if ('&#!+.~'.indexOf(event.params[0][0]) != -1) {
                event.channel = event.params[0];
            } else {
                event.user = event.params[0];
            }
        }
        else if(rsp == 352) {
            event.channel = event.params[0];
            event.user = event.params[4];
        }
        else if(rsp == 353) {
            event.channel = event.params[1];
        }
        else if(rsp == 441) {
            event.user = event.params[0];
            event.channel = event.params[1];
        }
    }
    else {
        if(event.action == 'PRIVMSG') {
            if('&#!+.~'.indexOf(event.params[0][0]) != -1)
                event.channel = event.params[0];
            else
                event.targetUser = event.params[0];
        }
        else if(event.action == 'JOIN' ||
                event.action == 'PART' ||
                event.action == 'TOPIC')
        {
            event.channel = event.params[0];
        }
        else if(event.action == 'KICK') {
            event.channel = event.params[0];
            event.targetUser = event.params[1];
        }
        else if(event.action == 'NICK') {
            event.newNick = event.params[1];
            event.multiChannel = true;
        }
        else if(event.action == 'MODE') {
            event.channel = event.params[0];
            event.modeChanges = event.params[1];
            if(event.params.length > 2) {
                event.targetUsers = event.params.slice(2);
            }
        }
        else if(event.action == 'QUIT') {
            event.multiChannel = true;
        }

        if(event.multiChannel) {
            event.channels = [];
            var channels = this.connections[event.server].channels;
            for(var ch in channels) {
                for(var nick in channels[ch].nicks) {
                    if(nick == event.user) {
                        event.channels.append(channels[ch]);
                    }
                }
            }
        }
        else if(event.channel && this.connections[event.server].channels[event.channel]) {
            event.channel = this.connections[event.server].channels[event.channel];
        }
    }

    // Run any pre-emit hooks
    async.eachSeries(this.preEmitHooks, function(hook, callback) {
        hook(event, callback);
    }, function(err) {
        this.emit(event);
    }.bind(this));
};

JSBot.prototype.addPreEmitHook = function(func) {
    this.preEmitHooks.push(func);
};

JSBot.prototype.clearHooks = function() {
    this.preEmitHooks = [];
};

JSBot.prototype.emit = function(event) {
    if(event.action in this.events) {
        _.each(this.events[event.action], function(listener) {
            var eventFunc = listener.listener;

            var channel = false;
            if(event.channel) {
                channel = event.channel.name;
            }

            if(_.isFunction(eventFunc) && this.ignores &&
                (_.has(this.ignores, event.user) && _.include(this.ignores[event.user], listener.tag)) == false &&
                (_.has(this.ignores, channel) && _.include(this.ignores[channel], listener.tag)) == false) {
                try {
                    eventFunc.call(this, event);
                } catch(err) {
                    console.log('ERROR: ' + eventFunc + '\n' + err);
                    console.log(err.stack.split('\n')[1].trim());
                }
            }
        }.bind(this));
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
    this.connections[event.server].send('NOTICE', event.user , ':' + msg);
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
        if(!_.has(this.events, type)) {
            this.events[type] = [];
        }
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
        'QUIT': [],
        'NICK': [],
        'PRIVMSG': [],
        'MODE': [],
        'KICK': []
    };
    this.addDefaultListeners();
};

/**
 * Default listeners.
 *
 * TODO: I'd like to split this out into its own file, and perhaps it could 
 *  act as a jsbot plugin?
 */
JSBot.prototype.addDefaultListeners = function() {

//  PING
//  Self-explanatory
    this.addListener('PING', 'pong', function(event) {
        this.connections[event.server].pong(event.message);
    }.bind(this));

//
//  353/474 replies
//  Fills in initial channel/nick info.
//

    this.addListener('353', 'names', function(event) {
        var newNicks = event.message.split(' ');
        for(var i=0; i < newNicks.length; ++i) {
            var nickMatch = newNicks[i].match(/([~&@%+])(.+)/);
            event.channel.nicks[name] = {
                'name': nickMatch[2],
                'op': nickMatch[1][0] == '@',
                'voice': nickMatch[1][0] == '+',
                'toString': function() {
                    return this.name;
                }
            };
        }
    }.bind(this));

    this.addListener('474', 'banname', function(event) {
        delete this.connections[event.server].channels[event.channel];
    }.bind(this));

//
//  JOIN/PART/KICK/NICK/MODE/QUIT
//  Adjusts channel/nick info as needed.
//

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

    this.addListener('PART', 'partname', function(event) {
        var channelNicks = event.channel.nicks;
        delete channelNicks[event.user];
    });

    this.addListener('KICK', 'kickname', function(event) {
        var channelNicks = event.channel.nicks;
        delete channelNicks[event.user];
    });

    this.addListener('NICK', 'nickchan', function(event) {
        _.each(event.allChannels, function(channel) {
            if(_.has(channel.nicks, event.user)) {
                channel.nicks[event.newNick] = channel.nicks[event.user];
                channel.nicks[event.newNick].name = event.newNick;
                delete channel.nicks[event.user];
            }
        });
    });

    this.addListener('MODE', 'modop', function(event) {
        if(!event.modeChanges || !event.targetUsers) {
            return;
        }

        var changeSets = event.modeChanges.match(/[+-][ov]+/);
        if(!changeSets) {
            return;
        }

        for(var i=0; i < changeSets.length; ++i) {
            var chanUser = event.channel.nicks[event.targetUsers[i]],
                prefix = changeSets[i].match(/[+-]/)[0],
                flags = changeSets[i].match(/[ov]+/)[0],
                value = prefix == '+';

            for(var f=0; f < flags.length; ++f) {
                if(flags[f] == 'o') {
                    chanUser.op = value;
                } else if(flags[f] == 'v') {
                    chanUser.voice = value;
                }
            }
        }
    });

    this.addListener('QUIT', 'quitname', function(event) {
        _.each(event.allChannels, function(channel) {
            delete event.channel.nicks[event.user];
        });
    }.bind(this));
    


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
    this.lastSent = Date.now();
};

/**
 * Actually connect to the IRC server with the information given in the
 * constructor.
 */
Connection.prototype.connect = function() {
    if((typeof this.port == 'string' || this.port instanceof String) && this.port.substring(0, 1) == '+') {
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

      var t = new Tokenizer(this.netBuffer);
      while(true) {
          var line = t.tokenize('\r\n');
          if(line == null)
              break;

          this.lineBuffer = line;
          // remove line from buffer and parse
          this.netBuffer = this.netBuffer.substring(t.pos, -1);
          this.instance.parse(this, this.lineBuffer);
      }
    }.bind(this));

    setInterval(this.updateNickLists.bind(this), 3600000);
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
    //if(Date.now() > this.lastSent + 500) {
        message += '\r\n';
        this.conn.write(message, this.encoding);
        this.lastSent = Date.now();
    //} else {
    /*    setImmediate(function() {
            this.send(message);
        }.bind(this));
    }*/
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
