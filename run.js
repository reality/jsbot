jsbot = require('./jsbot');

var instance = jsbot.createJSBot('jsbot', 'a.server.net', 6667, function() {
    instance.join('#channel');
    instance.say('#channel', 'javascript is the future. python bots are old and rusty.');
}.bind(this));
