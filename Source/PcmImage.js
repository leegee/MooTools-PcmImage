/*
---
description: Create PCM wavefile graphs via the Web Audio API

license: MIT-style

authors:
- Lee Goddard

requires:
- Core
- Element/Measure

provides: [PcmImage]

...
*/

/*
	Version 0.3

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
		element: 	null,	/* conatiner to replace with canvas/image */
		uri: 		null,	/* uri of sound */
		strokestyle: null,	/* foreground colour, may come from css */
		background:  null,	/* background colour, may come from css */
		linewidth: 	1,		/* width of line used in graph */
		step:		4,		/* process PCM in steps */
		asimg:		false,	/* replace canvas with image, prevents playable */
		playable:	true,	/* can the image be clicked to play? */
		overlayclr:	'red',	/* overlaid when image played */
		onXhrError: function(){ throw 'XHR Error getting '+this.options.uri },
		onNoBufferError: function(){
			throw 'Error decoding file data from '+self.options.uri;
		}
	},
	
	buffer: 		null,	/* Audio buffer object */
	canvas:		null,	/* Canvas element added to options.element */
	actx:		null,	/* Audio context object */
    cctx:		null,	/* Canvas context object */
    img:			null	,	/* May hold an img element */
    xFactor:		null,	/* amount to increment x when itterating through PCM by options.step */
    audioReady:	false,	/* True when sound loaded */
    playing:		false,	/* True when audio is playing */
    pauseTimer:	null,	/* Used to togglePlay at end of sound */
    renderTimer:	null,	/* Rendering the overlay during play */
    nowSeconds:	0,		/* Current time ini sound, for pausing */
    width:		0,		/* Size of visual element */
    height:		0,		/* Size of visual element */
    
	initialize: function( options, actx ){
		var self = this;
		this.setOptions(options);
		
		this.element = (typeof this.options.element == 'string')?
			document.id(this.options.element) 
			: this.element = this.options.element;

		if (!this.element) console.error(options);
			
		if (typeof this.options.playable == "string"
		  && this.options.playable.match(/^(0|false|)$/)) this.options.playable = false;

		this.options.background = this.options.background 
			|| this.element.getStyle('backgroundColor');	
		this.options.strokestyle = this.options.strokestyle || this.element.getStyle('color');	

		if (actx)  
			this.actx = actx;
		else if (typeof AudioContext == "function") 
			this.actx = new AudioContext();
		else if (typeof webkitAudioContext == "function") 
			this.actx = new webkitAudioContext();
		else throw('This browser does not support Web Audio Context');	

		if (this.options.playable){
			// Convert colors to standard format to allow names and shorthand hex:
			var c = new  Element('div',{styles:{color:this.options.overlayclr}}).getStyle('color')
			this.overlay = {};
			this.overlay.fg   = {};
			this.overlay.fg.r = parseInt( '0x'+c.substr(1,2) );
			this.overlay.fg.g = parseInt( '0x'+c.substr(3,2) );
			this.overlay.fg.b = parseInt( '0x'+c.substr(5,2) );
			console.log( this.overlay);
		}
		
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
		this.width  = this.options.width  || this.element.getComputedSize().totalWidth;
		this.height = this.options.height || this.element.getComputedSize().totalHeight;
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
					self.audioReady = true;
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
		var self = this;
		var channelValues = [];
		var cd = [];
		
		this.cctx.beginPath();
		this.cctx.strokeStyle = this.options.strokestyle;
		this.cctx.lineWidth = this.options.linewidth;
		
		// XXX TODO UGLY HACK!
		this.cctx.moveTo( 0, this.height/1.9);

		for (var c=0; c < this.buffer.numberOfChannels; c++)
			cd[c] = this.buffer.getChannelData( c );

		this.xFactor = this.width / cd[0].length;
		
		for (var i=0; i < cd[0].length; i += parseInt(this.options.step)){
			for (var c=0; c < this.buffer.numberOfChannels; c++){
				this.cctx.lineTo(
					i * this.xFactor, 
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
			
			if (this.options.playable){
				this.img.addEvent('click', function(){
					self.togglePlay();	
				});
			}
		}
		
		else if (this.options.playable){
			this.canvas.addEvent('click', function(){
				self.togglePlay();	
			});
		}
	},
	
	togglePlay: function(){
		if (this.playing) this.pause()
		else this.play();
	},
	
	_stop: function( pause ) {
		if (!this.playing) return;
		this.playing = false;
		this.node.noteOff( 0 );
		this.nowSeconds = pause? this.actx.currentTime : 0;
		clearTimeout( this.pauseTimer );
		clearTimeout( this.renderTimer );
	},
	
	pause: function(){
		this._stop(true);
	},
	
	stop: function(){
		this._stop(false);
	},

	play: function(){
		if (!this.audioReady) return;
		if (this.playing) return;
		this.playing = true;
		this.node = this.actx.createBufferSource();
		this.node.buffer = this.buffer;
		this.analyser = this.actx.createAnalyser();
		this.node.connect( this.analyser );
		this.analyser.connect( this.actx.destination );
		this.node.noteGrainOn( 
			0, 
			this.nowSeconds, 
			this.buffer.duration-(this.nowSeconds)
		);
		this.pauseTimer = this.stop.delay(
			this.buffer.duration * 1000,
			this
		);
		
		this.overlayInterval = 50; // quater second update
		var overlaySteps = ((this.buffer.duration*1000) / this.overlayInterval );
		this.overlay.inc = this.width / overlaySteps;
		this.overlay.lastX = this.overlay.inc * -1;
		this.overlay.thisX = 0;
		
		this.overlay.inc /= 1.8; // nearly
		
		//console.log( this.width );
		//console.log( this.buffer.duration * 1000);
		//console.log( this.overlay.inc * this.overlayInterval);
		
		this.renderTimer = this.overlayImg.periodical( 
			this.overlayInterval,
			this 
		);
	},
	
	overlayImg: function(){
	//	this.cctx.fillStyle = 'rgba( 0, 255, 255, 1)';
		this.overlay.lastX = this.overlay.thisX;
		this.overlay.thisX += this.overlay.inc;
		
		var imgd = this.cctx.getImageData( 
			this.overlay.lastX, 0,
			this.overlay.thisX, this.canvas.height
		);
		
		var found=0;
		for (var i=0; i < imgd.data.length; i+=4){
			// var update = 0;
			// for (var p=0; p<3; p++){
			// 	if (imgd.data[i+p] > 0) update ++;
			// }
			// if (update==3) {
				imgd.data[i]	= this.overlay.fg.r;
				imgd.data[i+1]	= this.overlay.fg.g;
				imgd.data[i+2]	= this.overlay.fg.b;
			// }
		}

		this.cctx.putImageData(imgd, this.overlay.lastX, 0);
	}
});

/* Convert to PcmImages all DOM elements selected by 
   the 'selector' supplied as the sole argument, which
   defaults to '.pcmimg' */
PcmImage.parseDOM = function( selector ){
	selector = selector || '.pcmimg';
	$$( selector ).each( function(el){
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

