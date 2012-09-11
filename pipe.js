
///
//  Require
//
var net = require('net'),
http = require('http'),
url = require('url'),
rfc6455 = require('./rfc6455/rfc6455.js');

///
//  Settings
//
port = 8088;
useNagleAlg = true;
sessionPath = "/sessions";
pipeIdLength = 12;

///
//  Applications
//
var httpServer = http.createServer();
var busy = false;
var sessions = {};

httpServer.on('upgrade', function(req, socket, head) {

	var vers = req.headers["sec-websocket-version"];
	console.log("received websocket request version: " + vers);

	if (vers == "13") {
    socket.setNoDelay(!useNagleAlg);
		rfc6455.use(req, socket, head, function(req) {
			var wsConn = req.accept();
      addConnection(wsConn);
		});
	}
  else{
    //close connection
    console.log("Unsupported websocket version: closing connection.");
    socket.end();
  }
});

function addConnection(wsConn){
  var pid = getPipeId(wsConn.path);
  if(!pid){
    console.log("Cannot add connection. Pipe path is invalid: " + wsConn.path);
    return;
  }

  //get the matching session.
  var session = sessions[pid];
  if(!session){
      //Create a new Session
      sessions[pid] = [];
      sessions[pid].push(wsConn); 
      wsConn.pid = pid;
  }
  else{
    //Add to existing session
    if(session.length !== 1){
      console.log("Cannot add connection. Session is already full: " + session);
      //Session must contain exactly one other sesion.
    }
    else{
      session.push(wsConn);
      pipeWebSockets(session);
    }
  }
}

function getPipeId(path){
  var cleaned = path.replace(sessionPath + "/", "");
  if(cleaned.length === pipeIdLength){
    if(cleaned.indexOf("/") === -1){
      return cleaned;
    }
  }
}

function pipeWebSockets(session){
  var Conn1 = session[0], 
      Conn2 = session[1];

  function pipeOneWay(src,targ){
    src.on('Message',
      function(msg){
        msg.on('Frame', function(frame){
          console.log("Session:" +  src.pid + " redirecting frame\n"
          + "Source port: " + src.socket.remotePort + "Dest port: " + targ.socket.remotePort);
          frame.redirect(targ.socket);
        });
      });
    src.on('close',function(){
        console.log("Session " + src.pid + "was closed: Closing partner session " + targ.pid);
        targ.close();
        //delete the session
        sessions[getPipeId(Conn1.path)] = null;
      });
  }
  pipeOneWay(Conn1,Conn2);
  pipeOneWay(Conn2,Conn1);
}

httpServer.listen(port);
console.log("Listening on port " + port);
