/*
 *  MASKING_PROVIDER.JS
 *  
 *  Is able to mask all the parts of a message, while keeping
 *  track of the current offset. To force a specific offset call forceOffset.
 */ 

module.exports = function(masking_key){
  var offs = 0;
  var mask = masking_key;

  // write mask to buffer
  var m = new Buffer(4);
  m.writeInt32BE(mask, 0);

  return {
    maskData: function(msgBuff){
      console.log("Masking " + msgBuff.length + " bytes data with offset " + offs);
      for (var i = 0; i < msgBuff.length; i++) {
        //get mask octet nr. i
        var oct = m.readInt8((i + offs)%4);
        //xor single octet.
        msgBuff.writeInt8(oct ^ msgBuff.readInt8(i), i);
      }
      offs = (offs + msgBuff.length) % 4;
    },
    // force a new offset, for example to unmask data that has already 
    // been masked.
    forceOffset: function(o){
      offs = o%4;
    }  
  }
}
