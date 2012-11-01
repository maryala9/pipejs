/**
 *				RFC6455	-	THE WEBSOCKET PROTOCOL
 *
 * Implementation of rfc6455 (IETF WebSocket Draft 17). Instead of whole
 * messages this protocol emits the messages at the start of the transmission.
 * The messages emit single frames, which can be redirected directly to
 * another stream.
 */

var net = require('net'),
  http = require('http'),
  url = require('url'),
  crypto = require('crypto'),
  events = require('events'),
  stream = require('stream'),
  lpipe = require('../limited_pipe.js'),
  Masking_Provider = require('./masking_provider.js'),
  ws_frame = require('./ws_frame.js'),
  ws_message = require('./ws_message.js'),
  ws_connection = require('./ws_connection.js');
  

/**
 * Settings
 */

var secWebSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var closeTimout = 1000; //ms
var pingResponseTime = 500; //ms

/**
 * Use this protocol to handle the connection 
 * request.
 */

module.exports = {
  use: function(req, socket, head, onConnReq) {
	  handleRequest(req, socket, head, onConnReq);
  }
};
  


/**
 *  Send a frame to the client.
 *  @frame  {ws_frame}  
 */

function sendFrame(frame,socket){
  /* masked bit must be set */
	if (frame.mask) {
    var overhead;

		/*  Create answer header  */
		var header = frame.getHeader();
		var offs = header.length;
    //console.log("the frame socket: " + frame.socket.remotePort);
    //console.log("writing header %s to socket: %s : ", header.length, socket.remotePort);
		socket.write(header);

    /* Calculate missing bytes */
		var missing = frame.length - frame.body.length;

    if(missing < 0){
      /* The body is longer than the message. Split overhead from body.  */
      overhead = frame.body.slice(frame.length,frame.body.length);

      /* set the message as new body */
      frame.body = frame.body.slice(0,frame.length);
    }

		/*  Redirect Payload  */
		var maskProv = new Masking_Provider(frame.masking_key);
		maskProv.maskData(frame.body);
    //console.log("writing body %s to socket: %s : ", frame.body.length, socket.remotePort);
		socket.write(frame.body);
      
		if (missing > 0) {
      /* the message is longer than the received chunk */

			var msk = function(msgBuff) {
				maskProv.maskData(msgBuff);
			}
      
      /* mask every chunk of remaining data when received */
			frame.socket.on('data', msk);
      
      /* stream <missing> bytes of data to the other socket */
			lpipe(frame.socket, socket, {
				limit: missing
			},
			function(overhead) {
        //console.log("Overhead returned by pipe: ", overhead);
        /*  remove the old masking provider from the */
				frame.socket.removeListener('data', msk);

				if (overhead) {
          /* Undo the unnecessary masking */
          //console.log("self.length ", frame.length);
					maskProv.forceOffset(frame.length);
					maskProv.maskData(overhead);
				}
        /* Emit the overhead. This is the start of the next data frame  */
				frame.emit('transferred', overhead);
			});
		}
		else {
      if(overhead){
        //console.log("emit the overhead. This is the start of the next data frame: ", overhead);
        /* Emit the overhead. This is the start of the next data frame  */
        frame.emit('transferred',overhead);
      }
      else{
        //console.log("There is no overhead. Emit only the transferred event.", overhead);
        /* There is no overhead. Emit only the 'tranferred' event */
        frame.emit('transferred')
      }
		}
	}
	else {
		//console.log("Masked-Flag is not set: Sending protocol error 1002.");
		//protocol error 1002
	}
}


/**
 * When a pong was received this will be set to true.
 */
var ponged;

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
         *  handles the pinging, when nothing is send
         */
        var pinger = pingInterval(1000,socket,Connection);
        /**
         *  Send a message
         */
        Connection.send = function(message){
          pinger.stop();
          //console.log("Message start. Connection socket: " + Connection.socket.remotePort + " this socket: " + socket.remotePort);
          var sending = true;
          var fin = false;
          message.on('Frame',function(frame){
            frame.on('transferred',function(){
              console.log(Connection.socket.remotePort + ": frame transferred.");
              if(frame.fin){
                sending = false;
                console.log(Connection.socket.remotePort + ": Message ended....");
                /*
                 *  Start pinging.
                 */
                pinger.start();
              }
            });
            sendFrame(frame,socket);
          });
        }

				acceptRequest(secKey, head, socket, Connection);

        /*
         *  Connection initialised. Start pinging.
         */
        pinger.start();
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
  var intId;
  var stopped = true;
  var stop = function(){
    console.log(socket.remotePort + ": pinging stopped. clearing Ping setInterval");
    clearInterval(intId);
  };
  return {
    start: function(){
      if(stopped){
        console.log(socket.remotePort + ": starting to ping in an intervall of " + intervall);
        stopped = false;
        intId = setInterval(
          function(){
            if(connection.state === 'closed' ||
               connection.state === 'closing'
              ){
              stop();
              return;
            }
            if(!stopped){
              sendPing(socket,connection);
            }else{
              console.log(socket.remotePort + ": not pinging to this socket. Stop was called in the meantime.");
            }
          },
          intervall);
      }
    },
    stop: function(){
      if(!stopped){
        stopped = true;
        stop(); 
      }
    }
  }
}

/**
 * Sends a ping and waits on the pong frame.
 * If no pong is received after <pingResponsetime> ms
 * the connection will be closed
 */
function sendPing(socket,connection){
  console.log(socket.remotePort, " sending ping...");
  var pingFrame = new ws_frame.Frame(null,'ping',true,null);
  socket.write(pingFrame.getHeader());
  ponged = false;
  /*
  setTimeout(function(){
    if(!ponged){
      console.log("Error: The client did not answer on a ping. " +
        "It is assumed that the connection is lost.");
      endConnection(connection);     
      }
    },pingResponseTime);
   */
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
			console.log(Connection.socket.remotePort + ": Unexpected end. Closing connection.");
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

	 
  /**
   * Takes the first bytes of the buffer and reads them as a websocket header.
   * (See http://tools.ietf.org/html/rfc6455#section-5.1)
	 */	
	function handleHeader(buffer) {
    /* the connection is still used */
    var idle = false;

//   console.log(socket.remotePort + ": handling message header.");
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
      console.log("%s: continuation frame",socket.remotePort);
      message.fin = frame.fin;
			handleDataFrame(message);
			break;
		case 0x1:
			//text frame
			if (message && message.completed == false) {
				console.log("Error: New Message received while old one wasn't complete.");
			}
			message = new ws_message('text frame');
      console.log("%s: text frame",socket.remotePort);
      message.fin = frame.fin;
			connection.emit('Message', message);
			handleDataFrame(message);
			break;
		case 0x2:
			//binary frame
      console.log("%s: binary frame",socket.remotePort);
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
			if (connection.state !== "closing") {
				connection.close();
			}
			else {
				//This frame is the answer to an already existing close.
				endConnection(socket,connection);
			}
			break;
		case 0x9:
      console.log("%s: ping frame",socket.remotePort);
			//ping
			handlePing();
			break;
		case 0xA:
			//pong
      console.log("%s: pong frame",socket.remotePort);
			handlePong();
			break;
		}

		/*   Handle a data frame with the given message as context.   */
		function handleDataFrame(message) {
      //console.log("handling data frame",message);

			frame.on('transferred', function(overhead) {
				if (overhead) {
					handleHeader(overhead);
				}
				else {  
          console.log("waiting for new header...");
					socket.once('data', handleHeader);
					//the pipe has paused the socket, resume it.
					socket.resume();
				}
			});
			message.newFrame(frame);
		}

		/*  Handling of control frames  */
		function handlePing() {
			var pong = new ws_frame.Frame(null, 'Pong', true);
			socket.write(pong.getHeader());
			socket.once('data', handleHeader);
			//create new pong and send   
		}

		function handlePong() {
      ponged = true;
			socket.once('data', handleHeader);
		}

		//The handling of the header is done, listen for further messages.
		socket.resume();
	}
}
