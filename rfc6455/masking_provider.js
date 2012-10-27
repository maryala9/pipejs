/*
 *  MASKING_PROVIDER.JS
 *  
 *  Is able to mask all the parts of a message, while keeping
 *  track of the current offset. To force a specific offset call forceOffset.
 */

var MaskingProvider = function(masking_key) {
	this.offs = 0;
	this.mask = masking_key;
  
  /*
   *  Buffer that is used for masking.
   */
	this.m = new Buffer(8);
	this.m.writeInt32BE(this.mask, 0);
  this.m.writeInt32BE(this.mask, 4);
}

MaskingProvider.prototype.maskData = function(msgBuff) {
  console.log("masking a blob of length: " + msgBuff.length);
  try{
    var offsMsk = this.m.readInt32BE(this.offs);
  }
  catch(e){
    console.error("Message buffer: ",msgBuff);
    console.error("Mask buffer: ",this.m);
  }

  /* mask bytes 'fast' */
  var fst = (msgBuff.length - (msgBuff.length % 4));
  for(var j = 0; j < fst; j += 4){
    msgBuff.writeInt32BE(offsMsk ^ msgBuff.readInt32BE(j),j);  
  }
  
  try{
    /* mask overhanging bytes */
    var slw = msgBuff.length % 4;
    for (var i = fst; i < msgBuff.length; i++) {
      var oct = this.m.readInt8((i + this.offs) % 4);
      msgBuff.writeInt8(oct ^ msgBuff.readInt8(i), i);
    }
    this.offs = (this.offs + msgBuff.length) % 4;
  }
  catch(e){
    console.log("exception: ", e);
    console.log("this.offs " + this.offs);
    console.log(msgBuff);
    console.log("i: " + i);
    console.trace();
  }
}

/* may be needed to unmask data */
MaskingProvider.prototype.forceOffset = function(o){
  this.offs = o % 4;
  console.log("forcing new offset: " + this.offs);
}

module.exports = MaskingProvider;
