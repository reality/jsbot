jsbot = require('./jsbot');

var instance = jsbot.createJSBot('jsbot', 'a.server.net', 6667, function() {
    instance.join('#channel');
    instance.say('#channel', 'javascript is the future. python bots are old and rusty.');
}.bind(this));

instance.addListener('JOIN', function(data) {
    instance.say(data['channel'], 'Life is slightly better with ' + data['user'] + ' here :)');
});

instance.addListener('PART', function(data) {
    instance.say(data['channel'], 'Life is pointless without ' + data['user'] + ' here :(');
});

instance.addListener('PRIVMSG', function(data) {
    instance.say(data['channel'], data['user'] + ' said: ' + data['message']);
});
