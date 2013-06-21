jsbot = require('./jsbot');

var instance = jsbot.createJSBot('jsbottest');

instance.addConnection('aberwiki', 'irc.aberwiki.org', 6667, 'reality', function(event) {
    instance.join(event, '#realitest'); 
}.bind(this));

instance.addConnection('freenode', 'irc.freenode.net', 6667, 'reality', function(event) {
    instance.join(event, '#realitest'); 
}.bind(this));

instance.addConnection('darchoods', 'irc.darchoods.net', '+6697', 'reality', function(event) {
    instance.join(event, '#realitest');
}.bind(this));

instance.addPreEmitHook(function(event, callback) {
    if(event.user) event.user = event.user.toLowerCase();
    callback(false);
});

instance.addListener('JOIN', 'join', function(event) {
    event.reply('I love ' + event.user);
});

instance.ignoreTag('jsbottest', 'join');

instance.connectAll();
