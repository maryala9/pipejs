PIPE|JS 0.2
===========

PIPE|JS can connect two client-side websockets directly to each other using an intermediate server. This allows you to send websocket messages directly between two clients without passing the messages manually, using server side code. It could also be usefull for sending big chunks of data between two clients without delay, because it directly pipes the streams of payload between the two client WebSockets instead of waiting for the whole messages to arrive.

Attention: This project is still under development and in a very early phase: 
using it in critical applications would be insane. It might even not work at
all.

Features
--------

- The server doesn't wait until a message is received completely. As soon as the first bytes of a message stream are received, the server starts sending it to the other client. This allows you to pass big chunks of data between two clients, without worrying about the delay.

- Support for all types of websocket messages (Binary, Text, etc..).

- Simple usage. Just start the server and connect each websocket to the same session URL.


Drawbacks:
----------

This application is in a very early development phase, so it still has some drawbacks right now:

- Currently only support for the final Websocket Protocol (rfc6544).
  Unfortunately many browsers still use the old WebSocket protocols.

- Only two clients per session are possible, but I'm thinking about implementing sessions with multiple clients. Each message would then be piped to every other client in the session.

- Secure connections are not yet implemented.

- There is still much room for performance optimisation.


Dependencies:
-------------

-   nodejs v0.8.8 or higher.


Usage:
------


1. Start the server with:

    node pipe.js


2. Create two client-WebSockets and connect them to the same session.

3. Wait until you get a "session ready" message.

4. Send messages between the two clients.

###	Client1.html ###

    ws = new WebSocket('ws://localhost:8088/sessions/myChosenSessionName'); 
			ws.onmessage = function(evt){
				if(evt.data === "session ready"){
					ws.send("Hi, this is client 1. How do you do client 2?");
				}
		}


### Client2.html ###

		 ws = new WebSocket('ws://localhost:8088/sessions/myChosenSessionName'); 
		 ws.onmessage = function(evt){
				if(evt.data === "session ready"){
					ws.onmessage = function(evt){
						alert(evt.data);
					}
				}
	 	 }


Miscellaneous
-------------

#### Where does the name come from? ####

This applications works by piping the payload streams of WebSocket to
another one. Therefore I called it pipe|js.


