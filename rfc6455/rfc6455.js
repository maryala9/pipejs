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

/**
 * Settings
 */
var secWebSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var closeTimout = 1000; //ms
var pingResponseTime = 400; //ms


/**
 * Use this protocol to handle the connection 
 * request.
 */
exports.use = function(req, socket, head, onConnReq) {
	handleRequest(req, socket, head, onConnReq);
};

/**
 * When a pong was received this will be set to true.
 */
var ponged;


/**
 * Logs the timestamp of the last action and determines 
 * if the application is idle.
 */
var actionLog = (function(){
  var d = 3000;
  var lastAct = Date.now();
  return {
    action: function(){
      lastAct = Date.now();
    },
    isIdle: function(){
      return ((lastAct + d) < Date.now());
    }
  };
})();

/**
 * Application
 */
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

        /**
         * Logs a new action to avoid pinging.
         */
        Connection.touch = function(){
          console.log(socket.remotePort, "touched...");
          actionLog.action();
        }
				acceptRequest(secKey, head, socket, Connection);
        pingInterval(750,socket,Connection);
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

/**
 * Send pings in in an intervall of <intervall> ms, whenever
 * the connection isn't transferring a message.
 */
function pingInterval(intervall, socket, connection){
  var intId = setInterval(
    function(){
      if(connection.state === 'closed' ||
         connection.state === 'closing'
        ){
        stop();
        return;
      }
      sendPing(socket,connection)
    },
    intervall);
  var stop = function(){
    clearInterval(intId);
  };
}

/**
 * Sends a ping and waits on the pong frame.
 * If no pong is received after <pingResponsetime> ms
 * the connection will be closed
 */
function sendPing(socket,connection){
  console.log(socket.remotePort, " sending ping...");
  if(actionLog.isIdle()){
    var pingFrame = new ws_frame.Frame(null,'ping',true,null);
    socket.write(pingFrame.getHeader());
    ponged = false;
    setTimeout(function(){
      if(!ponged){
        console.log("Error: The client did not answer on a ping. " +
          "It is assumed that the connection is lost.");
        endConnection(connection);     
        }
      },pingResponseTime);
  }else{
    console.log(socket.remotePort, " is busy. Not pinging...");
  }
}

/**
 *  Fail the handshake
 */
function failConnection(head) {
	head.write('HTTP/1.1 400 Bad Request\r\n' + '\r\n');
}


/**
 *  Ends the connection and closes the
 *  socket.
 */
function endConnection(socket,connection) {
  connection.state = "closed";
  socket.end();
}

//	Accept the WebSocket-Connection, by sending the server handshake to the client and start listening for
//	incoming messages.
function acceptRequest(secKey, head, socket, connection) {
	//create Sec-WebSocket-Accept hash
	var hashed = crypto.createHash("SHA1").update(secKey + secWebSocketGUID).digest("base64");
	console.log(
    '\nSending server handshake: ' + 
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' + 
    'Connection: upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + hashed + '\r\n' 
    + '\r\n');

	//send the server handshake
	socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' + 
    'Upgrade: websocket\r\n' + 
    'Connection: upgrade\r\n' + 
    'Sec-WebSocket-Accept: ' + hashed + '\r\n' 
    + '\r\n');

	//listen for WebSocket-Messages.
	handleMessages(socket, connection);
}

function handleMessages(socket, connection) {
	//Current websocket message
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
    connection.state = 'closing';
		var closeAck = new ws_frame.Frame(null, 'connection close', true);
		try {
			socket.write(closeAck.getHeader());
		}
		catch(e) {
			console.log("Cannot send closing frame. Socket probably already closed: " + e);
		}

		//close after timout if the close isnt ACKed.
		setTimeout(function() {
			endConnection(socket,connection);
		},
		closeTimout);
	});

	//Takes the first bytes of the buffer and reads them as a websocket header.
	//	(See http://tools.ietf.org/html/rfc6455#section-5.1)
	function handleHeader(buffer) {
    /* the connection is still used */
    var idle = false;

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
      console.log("continuation frame");
      message.fin = frame.fin;
			handleDataFrame(message);
			break;
		case 0x1:
			//text frame
      console.log("text frame");
			if (message && message.completed == false) {
				console.log("Error: New Message received while old one wasn't complete.");
			}
			message = new ws_message('text frame');
      message.fin = frame.fin;
			connection.emit('Message', message);
			handleDataFrame(message);
			break;
		case 0x2:
			//binary frame
      console.log("binary frame");
			if (message && message.completed == false) {
				console.log("Error: New Message received while old one wasn't complete.");
			}
			message = new ws_message('binary frame');
      message.fin = frame.fin;
			connection.emit('Message', message);
			handleDataFrame(message);
			break;
		case 0x8:
			//connection close
      console.log("connection close frame");
			if (connection.state !== "closing") {
				connection.close();
			}
			else {
				//This frame is the answer to an already existing close.
				endConnection(socket,connection);
			}
			break;
		case 0x9:
      console.log("ping frame");
			//ping
			handlePing();
			break;
		case 0xA:
			//pong
      console.log("pong frame");
			handlePong();
			break;
		}

		/*   Handle a data frame with the given message as context.   */

		function handleDataFrame(message) {

			frame.on('transferred', function(overhead) {
				if (overhead) {
					handleHeader(overhead);
				}
				else {  
					socket.once('data', handleHeader);
					//the pipe has paused the socket, resume it.
					socket.resume();
				}
			});
			message.newFrame(frame);
		}

		/*  Handling of control frames  */

		function handlePing() {
			console.log("ping received");
			var pong = new ws_frame.Frame(null, 'Pong', true);
			socket.write(pong.getHeader());
			socket.once('data', handleHeader);
			//create new pong and send   
		}

		function handlePong() {
			console.log("pong received");
      ponged = true;
			socket.once('data', handleHeader);
		}

		//The handling of the header is done, listen for further messages.
		socket.resume();
	}
}
