/*
 *  A RFC6455 WebSocket Message
 */

//
//  Require
var events = require('events');

module.exports = Message;

function Message(type) {
	this.type = type;
	this.completed = false;
}

Message.prototype = new events.EventEmitter();
Message.prototype.newFrame = function(frame) {
	if (frame.fin) {
		this.completed = true;
	}
	this.emit('Frame', frame);
}

