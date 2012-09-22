var events = require('events');

var Connection = function(socket) {
	this.socket = socket;
	this.state = "connecting";
};

Connection.prototype = new events.EventEmitter();

Connection.prototype.newMessage = function(msg) {
	this.emit('message', msg);
}

Connection.prototype.close = function(cause) {
	if (this.state !== "closing" && this.state !== "closed") {
		this.state = "closing";
		this.emit('close', cause);
	}
}

Connection.prototype.ping = function() {
	// Not implemented yet.
	// send a ping to check if the connection is still alive.
}

module.exports = Connection;

