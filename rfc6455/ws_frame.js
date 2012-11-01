/*  
 *   A rfc6455 WebSocket Frame.  
 */

///
//  Require
//
var Masking_provider = require('./masking_provider.js'),
lpipe = require('../limited_pipe.js'),
events = require('events');

//  Create the header-object from an already existing buffer.
function createFromBuffer(buffer, socket) {
	var frame = new Frame(socket),
	offset = 0,
	headerStart;

	if (buffer.length < 2) {
		return {
			error: "Malformed header. Buffer length smaller than 2."
		}
	}

	/*  Read bytes 1-2  */
	headerStart = buffer.readUInt16BE(0);
	offset += 2;

	/*  Final Fragment of the Message?  */
	frame.fin = ((headerStart & 0x8000) !== 0);

	/*  RSV 1-3 must be zero. */
	if (headerStart & 0x7000) {
		return {
			error: "Error: RSV 1-3 is not zero. Hex value headerStart & 0x7000:" + (0x7000 & hstart)
		}
	}

	/*		Read the Opcode		*/
	frame.OpCode = (headerStart & 0x0F00) >> 8;

	/*    Get the 'masked' flag   */
	frame.mask = (headerStart & 0x0080) !== 0;

	/*    Get the length    */
	var len = (headerStart & 0x007F);
	if (len < 126) {
		//7 bits length for Payload length if bits 9 to 15 are < 126 
		frame.length = len;
	}
	else if (len === 126) {
		offset += 2;
		// 16 bits length for Payload length if bits 9 to 15 are 126
		if (buffer.length < offset) {
			return {
				error: "Cannot read the length: Malformed header. " + buffer
			};
		}
		frame.length = buffer.readUInt16BE(2);
	}
	else if (len === 127) {
		offset += 8;
		if (buffer.length < offset) {
			return {
				error: "Cannot read the length: Malformed header. " + buffer
			};
		}

		// 64 bits length for Payload length if bits 9 to 15 are 127 
		var mostSignif = buffer.readUInt32BE(2);
		var leastSignif = buffer.readUInt32BE(6);

		//Check if convertable to 'int'. 2^52 is the highest possible integer.
		if (mostSignif & 0xffff0000) {
			return {
				error: "Error: Malformed header. Length is bigger than 2^48 bytes\n" + "4 most significant bytes: " + mostSignif + "\n" + "4 least significant bytes: " + leastSignif + "."
			}
		}

		frame.length = leastSignif + (4294967296 * mostSignif);
		//console.log("64 bit length: " + frame.length);
	}
	/*    Read the mask   */
	if (frame.mask) {
		if (buffer.length < offset) {
			return {
				error: "Cannot read the mask :Malformed header. " + buffer
			};
		}
		frame.masking_key = buffer.readInt32BE(offset);
		offset += 4;
		//console.log("masking-key: " + frame.masking_key);
	}

	/*  get the body  */
	frame.body = buffer.slice(offset);
	//console.log("payload length: " + frame.body.length);
	return frame;
}

///   Create a new Frame. 
//  socket: the socket where this frame is coming from.
		//get mask octet nr. i
//  type: type string
//  find: bool
//  payload:  buffer
var Frame = function(socket, type, fin, body) {
	this.socket = socket;
	this.fin = fin || true;
	this.OpCode = null;
	this.body = body || {
		length: 0
	};
	this.length = this.body.length || 0;

	//masking must not be done by the server.
	this.masking_key = null;
	this.mask = false;

	if (type) {
		switch (type) {
		case "continuation frame":
			this.OpCode = 0x0;
			break;
		case "text frame":
			this.OpCode = 0x1;
			break;
		case "binary frame":
			this.OpCode = 0x2;
			break;
		case "connection close":
			this.OpCode = 0x8;
			break;
		case "ping":
			this.OpCode = 0x9;
			break;
		case "pong":
			this.OpCode = 0xA;
			break;
		default:
			throw {
				error:
				"unknown type",
				type: type
			};
			break;
		}
	}
}

Frame.prototype = new events.EventEmitter();

//returns the Header as a buffer.
Frame.prototype.getHeader = function() {
	var header = new Buffer(10);
	debugger;
	//OPCODE and FIN
	header.writeUInt8(((this.fin === true) ? 0x80: 0x00) | this.OpCode, 0);

	//LENGTH
	var offs = 2;
	if (this.length < 126) {
		//byte 2
		header.writeUInt8(this.length, 1);
	}
	else if (this.length < 65536) {
		//byte 2,3,4
		header.writeUInt8(126, 1);
		header.writeUInt16BE(this.length, 2);
		offs += 2;
	}
	else {
		header.writeUInt8(127, 1);
		//write most significant byte of length
		header.writeUInt32BE(Math.floor(this.length / 4294967296), 2);
		//write least significant byte of length
		header.writeUInt32BE(this.length % 4294967296, 6);
		offs += 8;
	}

	//NO FRAMING. ONLY DONE BY CLIENT.
	var t = header.slice(0, offs);

	return t;
}

///
// Exports
//
module.exports = {
	Frame: Frame,
	createFromBuffer: createFromBuffer
}

