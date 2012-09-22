/*
 *  MASKING_PROVIDER.JS
 *  
 *  Is able to mask all the parts of a message, while keeping
 *  track of the current offset. To force a specific offset call forceOffset.
 */

var MaskingProvider = function(masking_key) {
	this.offs = 0;
	this.mask = masking_key;

	// write mask to buffer. Doubling it allows us to 
	this.m = new Buffer(8);
	this.m.writeInt32BE(this.mask, 0);
  this.m.writeInt32BE(this.mask, 4);
}

MaskingProvider.prototype.maskData = function(msgBuff) {
  var offsMsk = this.m.readInt32BE(this.offs);

  //all bytes that can be masked "fast"
  var fst = (msgBuff.length - (msgBuff.length % 4));
  //mask bytes "fast".
  for(var j = 0; j < fst; j += 4){
    msgBuff.writeInt32BE(offsMsk ^ msgBuff.readInt32BE(j),j);  
  }
  
  //all overhanging bytes must be masked byte-wise
  var slw = msgBuff.length % 4;
	for (var i = fst; i < msgBuff.length; i++) {
		//get mask octet nr. i
		var oct = this.m.readInt8((i + this.offs) % 4);
		//xor single octet.
		msgBuff.writeInt8(oct ^ msgBuff.readInt8(i), i);
	}
  //update offset for next masking.
	this.offs = (this.offs + msgBuff.length) % 4;
}

// force a new offset, for example to unmask data that has already been masked.
MaskingProvider.prototype.forceOffset = function(o){
  this.offs = o % 4;
}

module.exports = MaskingProvider;
