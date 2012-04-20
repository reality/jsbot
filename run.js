jsbot = require('./jsbot');

var instance = jsbot.createJSBot('jsbot');

instance.addConnection('aberwiki', 'irc.aberwiki.org', 6667, 'reality', function(event) {
    instance.join(event, '#lambda'); 
}.bind(this));

instance.addListener('JOIN', function(event) {
    event.reply('I love ' + event.user);
});

instance.connectAll();
