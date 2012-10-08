/*
---
description: Create PCM wavefile graphs via the Web Audio API

license: MIT-style

authors:
- Lee Goddard

requires:
- Core

provides: [PcmImage]

...
*/

/*

	This code is copyright (C) 2012 Lee Goddard, Server-side Systems Ltd.
	All Rights Reserved.
	
	Available under the same terms as Perl5.

	Provides events:
	
	onSoundLoaded 
	
	onCanvasLoaded
	
	onXhrError
	
*/

var PcmImage = new Class({
	Implements: [Options, Events],
	
	options: {
		element: 	null,
		uri: 		null,
		strokeStyle: null, /* foreground colour */
		background:  null,
		lineWidth: 	1,
		onXhrError: function(){ throw 'XHR Error getting '+this.options.uri },
		onNoBufferError: function(){
			throw 'Error decoding file data from '+self.options.uri;
		},
		step:		4,
		asimg:		false,
	},
	
	buffer: null,	/* Audio buffer object */
	canvas:	null,	/* Canvas element added to options.element */
	actx:	null,	/* Audio context object */
    cctx:	null,	/* Canvas context object */
    img:		null	,	/* May hold an img element */
    
	initialize: function( options, actx ){
		var self = this;
		this.setOptions(options);
		
		this.element = (typeof this.options.element == 'string')?
			document.id(this.options.element) 
			: this.element = this.options.element;
		
		this.options.background = this.options.background 
			|| this.element.getStyle('backgroundColor');	
		this.options.strokeStyle = this.options.strokeStyle || this.element.getStyle('color');	
		if (actx)  
			this.actx = actx;
		else if (typeof AudioContext == "function") 
			this.actx = new AudioContext();
		else if (typeof webkitAudioContext == "function") 
			this.actx = new webkitAudioContext();
		else throw('This browser does not support Web Audio Context');	

		if (this.options.asimg 
		 && this.options.asimg != 'false'
	 	 && this.options.asimg != '0'
	 	){
	 		this.options.asimg = true
	 	}
		
		this.initCanvas();
		this.fireEvent('canvasLoaded');
		this.load();
	},

	initCanvas: function(){
		this.width  = this.options.width  || this.element.getSize().x;
		this.height = this.options.height || this.element.getSize().y;
		var attr = {
			width: this.width,
			height: this.height,
			styles: {
				left: 0,
				top: 0,
				backgroundColor: this.options.background || 'transparent',
				position: 'relative',
				zIndex: 2,
				border: 0,
				margin: 0,
				display: 'block',
				width: this.width,
				height: this.height
			}
		};
		
		this.canvas = new Element('canvas',attr);
		if (this.options.asimg) this.img = new Element('img',attr);
		
		this.options.element.appendChild( this.canvas );
		this.cctx = this.canvas.getContext('2d');
	},
		
	load: function(){
		var self=this;
		var request=new XMLHttpRequest();
		request.open("GET", this.options.uri, true);
		request.responseType="arraybuffer";
		request.onload=function(){
			self.actx.decodeAudioData(request.response,function(buffer){
				if (!buffer){
					alert('error decoding file data: '+self.options.uri);
				} else {
					self.buffer = buffer;
					self.fireEvent('soundLoaded');
					self.render();
				}
			});
		}
		request.onerror = self.options.onXhrError;
		request.send();
		
/* If mootools-core pulls https://github.com/mootools/mootools-core/pull/2433
	then this code works:
		new Request({
			method: 	'get',
			url:		this.options.uri,
			responseType: 'arraybuffer',
			onError: self.options.onXhrError,
			onSuccess:	function(res){
				self.actx.decodeAudioData(res, function(buffer){
					if (!buffer){
						self.options.onNoBufferError();
					} else {
						self.buffer = buffer;
						self.fireEvent('soundLoaded');
						self.render();
					}
				});
			}
		}).send();
*/

	},

	// Having tried all sorts of averaging and resampling,
	// the visually most appealing result is from allowing
	// the canvas to sort it out, though this is much slower.
	render: function(){
		var channelValues = [];
		var cd = [];
		
		this.cctx.beginPath();
		this.cctx.strokeStyle = this.options.strokeStyle;
		this.cctx.lineWidth = this.options.lineWidth;
		this.cctx.moveTo( 0, this.height/2);

		for (var c=0; c < this.buffer.numberOfChannels; c++){
			cd[c] = this.buffer.getChannelData( c );
		}
		
		var w = this.width / cd[0].length;
		
		for (var i=0; i < cd[0].length; i += parseInt(this.options.step)){
			for (var c=0; c < this.buffer.numberOfChannels; c++){
				this.cctx.lineTo(
					i * w, 
					cd[c][i] * this.height + (this.height/2)
				);
			}
		}
		
		this.cctx.stroke();
		
		if (this.options.asimg 
		 && this.options.asimg != 'false'
	 	 && this.options.asimg != '0'
	 	){
			//store the current globalCompositeOperation
			var compositeOperation = this.cctx.globalCompositeOperation;
			
			//set to draw behind current content
			this.cctx.globalCompositeOperation = "destination-over";
			
			//set background color
			this.cctx.fillStyle = this.options.background;
			
			//draw background / rect on entire canvas
			this.cctx.fillRect(0,0, this.canvas.width, this.canvas.height);

	 		this.img.src = this.canvas.toDataURL();
			this.img.replaces( this.canvas );
		}
	},
});

PcmImage.parseDOM = function(){
	$$('.pcmimg').each( function(el){
		var opts = {
			element:		 el,
			uri:			 el.dataset.uri,
		};
		Object.keys(el.dataset).each( function(i){
			opts[i] = el.dataset[i];
		});
		new PcmImage(opts);
	});
}	

document.addEvent('domready', function(){
	PcmImage.parseDOM();	
});

