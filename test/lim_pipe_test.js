var TestMsgCount =  1291;
var IncMsgSize = 2*3*13537;
var PipeLimit = 104857602/6; // = 2*3*1291*13537
var diff = 7;

var MemoryStream = require('memorystream'),
	Assert = require('assert'),
	LimitedPipe = require('./limited_pipe.js');

function readIntoBuffer(streams, streamsize, ready){
 	var read = 0;
	var i = 0;
	var b = new Buffer(0);
	var chunks = [];

	function readSingleStream(buffer,stream){	
   	  stream.on('data', function(chunk){
	    read += chunk.length;
		console.log("concatenating chunk with length: " + chunk.length);
		chunks.push(chunk);
		console.log(streamsize - read);
		if(read === streamsize){
		  read = 0;
		  console.log("stream end");
			i++;
			if(i < streams.length){
			  console.log("streams still not completely ready. Iteration: " + i);
			  readSingleStream(buffer,streams[i]); 		
			  }
			else{
			  console.log("streams read completely.");
			  buffer = Buffer.concat(chunks );
			  ready(buffer);
		    }
		}
		else if(read > streamsize){
			console.log("Error: chunk too big.");
		}
	});
   	  stream.resume();
	}
	readSingleStream(b,streams[0]);
}

function simBufferGroup(buffercount, size, diff){
	var buffers = [];
	for(var i = 0; i < buffercount; i++){
		buffers.push(createTestBuffer(size, diff));
	}
	return Buffer.concat(buffers);
}

function createTestBuffer(size, diff){
	var buff = new Buffer(size);
	val = 0;
	for(var i = 0; i < size; i++){
		buff.writeUInt8(val,i);
		val = (val + diff) % 256;
	}
	return buff;
}

function bufferEqual(b1,b2){
	var valid = true;
	if(b1.length !== b2.length){
		console.log("size between two buffer differs: b1.length " + b1.length + "  b2.length: " + b2.length);
		return false;
	}
	for(var i=0; i < b1.length; i++){
		if(b1.readInt8(i) !== b2.readInt8(i)){
			valid = false;
			console.log("ERROR: byte " + i + " differs.\n" +
				" b1: " + b1.readUInt8(i) + "\n" +
			  	" b2: " + b2.readUInt8(i) + "\n");
		}
	}
	return true;
}

var inStream = new MemoryStream();

function getSingleStreams(input ,head ,len, streams){
  input.pause();
  var outStream = new MemoryStream({
	maxbufsize: len,
	bufoveflow: len*1.5
	});
  outStream.pause();
  
  if(head){
	input.write(head);
  }

  LimitedPipe.pipeLimited(
    input, 
	outStream, 
	{ limit: len }, 
	function(overhead){
	  if(overhead){
	      console.log('Overhead callback. size: ' + overhead.length);
		}
		else{
		  console.log('Callback without overhead.');	
		}
		outStream.end();
	    streams.push(outStream);
		getSingleStreams(input,overhead,len,streams);
	});
   input.resume();
  }
var outputStreams = [];
getSingleStreams(
	inStream, 
	{}, 
	PipeLimit, 
	outputStreams);

//write input stream
for(var i = 0; i < TestMsgCount; i++){
	inStream.write(	
		createTestBuffer(IncMsgSize, diff));
}
inStream.end();

readIntoBuffer(outputStreams,PipeLimit, function(buffer){
	console.log("buffer arrived: " + buffer.length);
	console.log("testing equality. outputlength " + buffer.length + " " ); 

	var testBuffer = simBufferGroup(TestMsgCount ,IncMsgSize, diff);
	console.log("unit test: " + bufferEqual(
		testBuffer,
	    buffer));
});
