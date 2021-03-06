///
//	Provides normal pipe functionality, but is able to limit the written bytes.
//	Calls the callback when all data is written and returns eventual overhead.
//
var events = require('events');
var util = require('util');


///
//	Application
//
pipe = function(source, dest, options, callback) {
  //var source = this;
  var limit = options.limit; 
  console.log("limit: " + limit);
  var written = 0;  		 

  function ondata(chunk) {
    if (dest.writable) {
      written += chunk.length; 
      if(written < limit){     
	  	//console.log("writing chunk to output.");
	    //just write the chunk to the output stream.
      //console.log("PIPE writing " + chunk.length + " bytes to socket.");
      //console.log("Buffer size: " + source.bufferSize);
      if (false === dest.write(chunk) && source.pause){
        //console.log("Destination buffer is full. Pausing source socket.");
        source.pause();
      }
	  }       			    
	  else{    			    
	    //pause the source always, because there will be no listeners anymore.
	    if(source.pause){   
		    source.pause();   
	    } 				    
    
      try{
        //split the chunk. Write one part to the stream and return the overhead.
        var over = written - limit; 						
        var last = chunk.slice(0, chunk.length - over); 

        if(over != 0){      
            var overhead = chunk.slice(chunk.length - over);
        }
      }
      catch(e){
        console.log(e);
        console.log("over, writte, limit, last", over, written, limit, last);
        console.log("chunk length: " + chunk.length);
        console.log("chunk: ", chunk);
        console.trace();
      }
          

      //write last chunk to target.
      //console.log("PIPE writing last " + last.length + " bytes to socket.");
      dest.write(last);   

      if(source.pause){   
        source.pause();   
      } 				    
      //ending destination stream
      cleanup();          

      //return the overhead.
      callback(overhead); 
      } 				    
	  }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once, and
  // only when all sources have ended.
  if (!dest._isStdio && (!options || options.end !== false)) {
    dest._pipeCount = dest._pipeCount || 0;
    dest._pipeCount++;

    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest._pipeCount--;

    // remove the listeners
    cleanup();

    if (dest._pipeCount > 0) {
      // waiting for other incoming streams to end.
      return;
    }

    dest.end();
  }

  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest._pipeCount--;

    // remove the listeners
    cleanup();

    if (dest._pipeCount > 0) {
      // waiting for other incoming streams to end.
      return;
    }

    dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (this.listeners('error').length === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('end', cleanup);
    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('end', cleanup);
  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};


///
//	Export

module.exports = pipe;
