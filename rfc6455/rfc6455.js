///		
//				RFC6455	-	THE WEBSOCKET PROTOCOL
//
//  Implementation of rfc6455 (IETF WebSocket Draft 17). Instead of whole
//  messages this protocol emits the messages at the start of the transmission.
//  The messages emit single frames, which can be redirected directly to
//  another stream.
///
//  Require
//
var net = require('net'),
http = require('http'),
url = require('url'),
crypto = require('crypto'),
module = require('module'),
events = require('events'),
stream = require('stream'),
lpipe = require('../limited_pipe.js'),
ws_frame = require('./ws_frame.js'),
ws_message = require('./ws_message.js'),
ws_connection = require('./ws_connection.js');

///
//  Constants
//
var secWebSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var closeTimout = 1000; //ms
///
//	Exports
// Use this protocol to handle the upgrade request.
exports.use = function(req, socket, head, onConnReq) {
	handleRequest(req, socket, head, onConnReq);
};

///
//  Application
//
function handleRequest(req, socket, head, conn) {
	var p = url.parse(req.url),
	ressName = p.pathname,
	query = p.query;

	//check validity
	if (req.httpVersion !== "1.1") {
		//fail the websocket connection
	}
	if (req.headers["upgrade"] !== "websocket") {
		//fail the websocket connection
	}

	var host = req.headers.host,
	origin = req.headers.origin,
	secKey = req.headers["sec-websocket-key"];

	if (secKey && origin && host) {
		var request = {
			headers: req.headers,
			origin: origin,
			protocols: req.headers["sec-websocket-protocol"],
			decline: function() {
				failConnection();
			},
			accept: function(protocols) {
				var Connection = new ws_connection(socket);
				Connection.state = "connected";
				Connection.path = p.pathname;
				Connection.query = p.query;

				acceptRequest(secKey, head, socket, Connection);
				return Connection;
			}
		};
		conn(request);
	}
	else {
		//fail the websocket connection
		failConnection();
	}
}

//fail the handshake.
function failConnection(head) {
	head.write('HTTP/1.1 400 Bad Request\r\n' + '\r\n');
}

//	Accept the WebSocket-Connection, by sending the server handshake to the client and start listening for
//	incoming messages.
function acceptRequest(secKey, head, socket, connection) {
	//create Sec-WebSocket-Accept hash
	var hashed = crypto.createHash("SHA1").update(secKey + secWebSocketGUID).digest("base64");

	console.log('\nSending server handshake: ' + 'HTTP/1.1 101 Switching Protocols\r\n' + 'Upgrade: websocket\r\n' + 'Connection: upgrade\r\n' + 'Sec-WebSocket-Accept: ' + hashed + '\r\n' + '\r\n');

	//send the server handshake
	socket.write('HTTP/1.1 101 Switching Protocols\r\n' + 'Upgrade: websocket\r\n' + 'Connection: upgrade\r\n' + 'Sec-WebSocket-Accept: ' + hashed + '\r\n' + '\r\n');

	//listen for WebSocket-Messages.
	handleMessages(socket, connection);
}

function handleMessages(socket, connection) {
	//Current websocket message
	//array of websocket frames.
	var message, frame;

	//listen for the first message.
	socket.once('data', handleHeader);

	socket.on('error', function(exc) {
		console.log("Connection errored: " + exc);
	});

	socket.on('end', function() {
		if (connection.state !== "closing" && connection.state !== "closed") {
			//socket was unecpectedly closed.
			console.log("Unexpected end. Closing connection.");
			connection.state = "closed";
			connection.close();
		}
	});

	connection.on('close', function(cause) {
		console.log('closing connection. cause: ' + cause);

		var closeAck = new ws_frame.Frame(null, 'connection close', true);
		try {
			socket.write(closeAck.getHeader());
		}
		catch(e) {
			console.log("Cannot send closing frame. Socket probably already closed: " + e);
		}

		//close after timout if the close isnt ACKed.
		setTimeout(function() {
			endConnection();
		},
		closeTimout);
	});

	//Takes the first bytes of the buffer and reads them as a websocket header.
	//	(See http://tools.ietf.org/html/rfc6455#section-5.1)
	function handleHeader(buffer) {
		//console.log("handling message header. Socket Port: " + socket.remotePort);
		socket.pause();
		//try to read the frame header.
		frame = ws_frame.createFromBuffer(buffer, socket);

		if (frame.error) {
			/*  FAIL THE WEBSOCKET CONNECTION */
			console.log(frame.error);
		}

		switch (frame.OpCode) {
		case 0x0:
			//continuation frame
			//console.log("continuation frame");
			if (!message) {
				//continuation frame while no socket
				/*  FAIL THE WEBSOCKET CONNECTION */
			}
			handleDataFrame(message);
			break;
		case 0x1:
			//text frame
			//console.log("text frame");
			if (message && message.completed == false) {
				console.log("Error: New Message received while old one wasn't complete.");
			}
			message = new ws_message('text frame');
			connection.emit('Message', message);
			handleDataFrame(message);
			break;
		case 0x2:
			//binary frame
			if (message && message.completed == false) {
				console.log("Error: New Message received while old one wasn't complete.");
			}
			//console.log("binary frame");
			message = new ws_message('binary frame');
			connection.emit('Message', message);
			handleDataFrame(message);
			break;
		case 0x8:
			//connection close
			if (connection.state !== "closing") {
				connection.close();
			}
			else {
				//This frame is the answer to an already existing close.
				endConnection();
			}
			break;
		case 0x9:
			//ping
			handlePing();
			break;
		case 0xA:
			//pong
			handlePong();
			break;
		}

		/*   Handle a data frame with the given message as context.   */

		function handleDataFrame(message) {
			frame.on('transferred', function(overhead) {
				if (overhead) {
					console.log("transfer done. Overhead returned...");
					handleHeader(overhead);
				}
				else {
					console.log("registering new handler.");
					socket.once('data', handleHeader);
					//the pipe has paused the socket, resume it.
					console.log("resuming socket");
					socket.resume();
				}
			});
			message.newFrame(frame);
		}

		/*  Handling of control frames  */

		function handlePing() {
			console.log("ping");
			var pong = new ws_frame.Frame(null, 'Pong', true);
			socket.write(pong.getHeader());
			//create new pong and send   
		}

		function handlePong() {
			console.log("pong received");
		}

		//The handling of the header is done, listen for further messages.
		socket.resume();
	}

	//close the socket after connection close.
	function endConnection() {
		connection.state = "closed";
		socket.end();
	}
}

