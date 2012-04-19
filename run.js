jsbot = require('./jsbot');

var instance = jsbot.createJSBot('jsbot');

instance.addConnection('aberwiki', 'irc.aberwiki.org', 6667, 'reality', function(event) {
    instance.join(event, '#42'); 
}.bind(this));

instance.addListener('JOIN', function(event) {
    event.reply('I love ' + event.user);
});

