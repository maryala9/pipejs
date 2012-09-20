/*
 *  MASKING_PROVIDER.JS
 *  
 *  Is able to mask all the parts of a message, while keeping
 *  track of the current offset. To force a specific offset call forceOffset.
 */

var MaskingProvider = function(masking_key) {
	this.offs = 0;
	this.mask = masking_key;

	// write mask to buffer
	this.m = new Buffer(4);
	this.m.writeInt32BE(this.mask, 0);
}

MaskingProvider.prototype.maskData = function(msgBuff) {
	//console.log("Masking " + msgBuff.length + " bytes data with o ffset " + this.offs);
	for (var i = 0; i < msgBuff.length; i++) {
		//get mask octet nr. i
		var oct = this.m.readInt8((i + this.offs) % 4);
		//xor single octet.
		msgBuff.writeInt8(oct ^ msgBuff.readInt8(i), i);
	}
	this.offs = (this.offs + msgBuff.length) % 4;
}

// force a new offset, for example to unmask data that has already been masked.
MaskingProvider.prototype.forceOffset = function(o){
  this.offs = o % 4;
}

module.exports = MaskingProvider;
