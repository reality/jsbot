## JSBot

JSBot is an IRC bot library written in Node JS.

With features like multiple server support and being 'pretty good, I guess,' 
JSBot is designed to be the IRC bot library of the future! For an example of a
large project which uses JSBot, take a look at 
[DepressionBot](http://github.com/reality/depressionbot/ "DepressionBot").

To get started with JSBot, take a look at the 'run.js' example provided with the
code, then head on over to the 
[online documentation](https://github.com/reality/jsbot/wiki/Documentation "JSBot Docs").

## ChangeLog

### 0.4

* Fixed race condition (Make handlers execute in proper order).
* More handler improvements.

### 0.3

* Fixed an edge case with the IRC line tokenisation /potentially/ causing events to be parsed twice
* Isolated all core channel/nick list logic in JOIN/PART/KICK/QUIT/NICK handlers
* Removed useless timeout in 004 handler, switched it to handle 001 instead
* Removed a duplicate send() call for IDENTIFY
* Semantically reorganised source code
* Various other improvements

speeddefrost <3

### 0.2

* Multiple server support. 
* Functionality for certain users to ignore listeners with certain tags.
* Better 'event' object passed to listeners.
* Ability to 'reply' to events.

### 0.1

* It connects to a server
* Listeners
* Ping/Pong
* Some of the other functionality you'd expect, like, what do you want from me?

