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
	Version 0.5

	This code is copyright (C) 2012 Lee Goddard.
	All Rights Reserved.
	
	Available under the same terms as Perl5.

	Provides events:
	
		onSoundLoaded 
	
		onCanvasLoaded
	
		onXhrError

		onCanvasLoaded

		onRendered

		onPlay

		onStop
	
	Consider overriding `overlayImg`, which is called 
	every `options.updateinterval` milliseconds when the
	track is playing.

*/

var PcmImage = new Class({
	Implements: [Options, Events],
	
	options: {
		element: 		null,	/* conatiner to replace with canvas/image */
		uri: 			null,	/* uri of sound */
		strokestyle: 	null,	/* foreground colour, may come from css if possible */
		background:  	null,	/* background colour, may come from css if possible */
		linewidth: 		1,		/* width of line used in graph */
		step:			4,		/* Graph PCM in steps */
		asimg:			false,	/* Replace canvas with image, prevents `pauseorjump` and `overlayclr` */
		pauseorjump: 	'jump',/* Either `pause` or `jump` (to a time) when waveform is clicked. */
		playable:		true,	/* Can the waveform be clicked to play? */
		overlayclr:		'rgba(200,0,0,100)',	/* Any valid CSS colour (hex, rgb, etc). Overlaid when image played */
		updateinterval: 60/40, 	/* Graph overlay update frequency in milliseconds */
		fftsize: 		1024,	/* FFT bin size for waveform frequency analysis. (Small=slow and detailed.) An unsigned long value representing the size of the Fast Fourier Transform to be used to determine the frequency domain. It must be a non-zero power of 2 in the range between 512 and 2048, included; its default value is 2048. If not a power of 2, or outside the specified range, the exception INDEX_SIZE_ERR is thrown. https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode */
		saturation: 	50, 	/* Waveform frequency colour (%) */
		lightness: 		50, 	/* waveform frequency colour (%) */
		frequencyby: 	'average', /* `average` or `max` - calculate frequency colour by the average frequency in the FFT bin, or that with the greatest amplitude. */
		onSoundLoaded: function(){},
		onXhrError: function(){ throw 'XHR Error getting '+this.options.uri },
		onNoBufferError: function(){
			throw 'Error decoding file data from '+self.options.uri;
		},
		onCanvasLoaded: function(){},
		onRendered: function(){	/* Fired when the waveform has been rendered. Default behaviour is to call `colourFrequencies()` to colour the waveform based on FFT frequency analysis. */
			this.colourFrequencies();
		},
		onPlay: function(){
			console.log( 'started at ', this.playbackTime, "("+this._actxStartTime+")" );
		},
		onStop: function(pause){
			console.log( (pause? 'paused':'stopped'), ' at ', this.playbackTime )
		}
	},
	
	buffer: 		null,	/* Audio buffer object */
	canvas:			null,	/* Canvas element added to options.element */
	actx:			null,	/* Audio context object */
	octx: 			null, 	/* Offline audio context object */
    cctx:			null,	/* Canvas context object */
    img:			null,	/* May hold an img element */
    audioReady:		false,	/* True when sound loaded */
    playing:		false,	/* True when audio is playing */
    renderTimer:	null,	/* Rendering the overlay during play */
    pauseTimer: 	null,	/* Stops the renderTimer */
    playbackTime:	0,		/* Current time ini sound, for pausing */
    width:			0,		/* Size of visual element */
    height:			0,		/* Size of visual element */
    overlay: 		{},		/* Private overlay details. */
    freqClrs: 		[],		/* Waveform frequency colour */
    canvasImgData: 	null,	/* Stores frequency-painted canvas ImageData for replay */ 
    offlineRenderStarted: false, /* Have to cover 0 */
    position: 		{		/* When `options.pauseorjump` is jump, used to hold position of the canvas */
    	x: null, 
    	y: null
    },

	initialize: function( options ){
		var self = this;
		this.setOptions(options);
		
		this.element = (typeof this.options.element == 'string')?
			document.id(this.options.element) 
			: this.element = this.options.element;

		if (!this.element) throw 'No valid options.element';

		if (typeof webkitAudioContext == "function"){
			window.AudioContext = webkitAudioContext;
			window.OfflineAudioContext = webkitOfflineAudioContext;
		}
		if (typeof AudioContext != 'function') throw new Error('This browser does not support Web Audio Context');

		if (typeof this.options.playable == "string"
		  && this.options.playable.match(/^(0|false|)$/)) this.options.playable = false;

		if (! this.options.pauseorjump.match(/jump/i))
			this.options.pauseorjump = 'pause';

		if (! this.options.frequencyby.match(/max/i))
			this.options.pauseorjump = 'average';

		this.options.background = this.options.background 
			|| this.element.getStyle('backgroundColor') || 'transparent';
		this.options.strokestyle = this.options.strokestyle || this.element.getStyle('color');	

		if (this.options.playable){
			// Convert colors to standard format to allow names and shorthand hex:
			var c = new  Element('div',{styles:{color:this.options.overlayclr}}).getStyle('color')
			this.overlay.fg   = {};
			this.overlay.fg.r = parseInt( '0x'+c.substr(1,2) );
			this.overlay.fg.g = parseInt( '0x'+c.substr(3,2) );
			this.overlay.fg.b = parseInt( '0x'+c.substr(5,2) );
			this.overlay.fg.all = c; 
		}
		
		if (this.options.asimg && this.options.asimg.match(/^(1|true|asimg|)$/i)) {
	 		this.options.asimg = true;
	 	} 
	 	// Allow negative markup
	 	else {
	 		this.options.asimg = false;
	 	}
		
		this.setClrs();
		this.initGraphics();
		this.fireEvent('canvasLoaded');
		this.load();
	},

	initGraphics: function(){
		this.width  = this.options.width  || this.element.getComputedSize().totalWidth;
		this.height = this.options.height || this.element.getComputedSize().totalHeight;
		var attr = {
			width: this.width,
			height: this.height,
			styles: {
				position: 'relative',
				display: 'block',
				zIndex: 2,
				left: 0,
				top: 0,
				width: this.width,
				height: this.height,
				backgroundColor: this.options.background
			},
			'class': this.options.element.get('class')
		};
		
		this.canvas = new Element('canvas',attr);
		if (this.options.asimg) this.img = new Element('img',attr);
	
		this.canvas.replaces( this.options.element );
		this.element = this.canvas;
		this.cctx = this.canvas.getContext('2d');
	},
		
	load: function(){
		var self = this;
		var request = new XMLHttpRequest();
		request.open("GET", this.options.uri, true);
		request.responseType = "arraybuffer";
		request.onload = function loaded(){
			self.actx = new AudioContext();
			self.actx.decodeAudioData(request.response,function(buffer){
				if (!buffer){
					alert('error decoding file data: '+self.options.uri);
					throw 'File decoding error';
				} 
				else {
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

	/*	Render a template of the waveform for later colour-overlay.
		Having tried all sorts of averaging and resampling,
		the visually most appealing result is from allowing
		the canvas to sort it out, though this is much slower.
	*/
	render: function(){
		var self = this;
		var cd = [];
		
		this.cctx.beginPath();
		this.cctx.strokeStyle = this.options.strokestyle;
		this.cctx.lineWidth   = this.options.linewidth;
		
		this.cctx.moveTo( 0, this.height/2);

		for (var c=0; c < this.buffer.numberOfChannels; c++)
			cd[c] = this.buffer.getChannelData( c );

		var xFactor = this.width / cd[0].length;

		for (var i=0; i < cd[0].length; i += parseInt(this.options.step)){
			var v = 0;
			for (var c=0; c < this.buffer.numberOfChannels; c++){
				v += cd[c][i];
			}

			this.cctx.lineTo(
				i * xFactor, 
				(v / this.buffer.numberOfChannels) * this.height + (this.height/2)
			);
		}
		
		this.cctx.stroke();

		self.fireEvent('rendered');
	},
	
	clickedGraphic: function(e){
		if (this.options.pauseorjump == 'jump'){
			console.log(this.playing)
			if (this.playing){
				// Store element position (it may have moved since last play)
				this.position = this.element.getPosition();
				this._stop(false);
				this.play(
					(e.page.x - this.position.x) / this.overlay.pxPerSec
				);
			} 
			else {
				this.play();
			}
		}

		else {
			if (this.playing) this.pause()
			else this.play();
		}
	},
	
	pause: function(){
		this._stop(true);
	},
	
	stop: function(){
		this._stop(false);
	},

	_stop: function( pause ) {
		// console.log('_stop', this.playing, 'pause?', pause);
		if (!this.playing) return;
		this.playbackTime = pause? this.now() : 0;
		this.node.stop();
		clearInterval( this.renderTimer );
		clearTimeout( this.pauseTimer );
		this.playing = false;
		if (! pause){
			this.playbackTime = 0;
		}
		this.fireEvent('stop', pause);
	},
	
	/** Specs say that the audio context currentTime is the time the audio context was created,
	    always moves forwards, and cannot be stopped or paused. now() is relative to the buffer.
	    {@see this#_actxStartTime}
	*/
	now: function(){
		return this.playbackTime + this.actx.currentTime - this._actxStartTime;
	},

	play: function( startAt ){
		if (!this.audioReady) return;
		if (this.playing) return;
		this.playing = true;

		this.setNode();

		if (typeof startAt !== 'undefined'){
			this.playbackTime = startAt;
			// Rerender canvas:
			this.overlay.thisX = 1;
			this.replaceCanvasImg();
			//this.overlayImg();
		}

		// Reset if done:
		if (this.playbackTime > this.node.buffer.duration){
			this.playbackTime = 0;
			this.replaceCanvasImg();
		}

		if (this.playbackTime == 0) this.replaceCanvasImg();

		// Render callback, cancelled as necessary by the callback
		this.renderTimer = this.overlayImg.periodical( 
			this.options.updateinterval,
			this 
		);

		var self = this;
		// setTimeout(function(){
			self.node.start( 
				0, 
				self.playbackTime	// 0 || where last paused
			);
		// }, this.options.updateinterval);

		this.fromX = this.playbackTime * this.overlay.pxPerSec;

		// '.pause' needs a place to start
		this._actxStartTime = this.actx.currentTime;

		this.fireEvent('play');
	},


	/* Overlays colour onto the wave form. Override this. */
	overlayImg: function(){
		this.overlay.lastX = 
			(typeof this.overlay.thisX === 'undefined')?
			0 : this.overlay.thisX-1;
		
		this.overlay.thisX = this.now() * this.overlay.pxPerSec;

		// console.info( this.now() +': ', this.overlay.lastX,'->', this.overlay.thisX);

		// Don't allow too-frequent calls:
		if (this.overlay.thisX - this.overlay.lastX <= 1) return;

		// if (this.overlay.thisX > this.element.width){
		if (this.now() >= this.node.buffer.duration){
			this.stop();
			return;
		}

		// If we error, cancel playback/rendering.
		try {
			/*
			var imgd = this.cctx.getImageData( 
				this.overlay.lastX, 0,
				(this.overlay.thisX - this.overlay.lastX), this.canvas.height
			);
			
			for (var i=0; i <= imgd.data.length; i+=4){
				imgd.data[i]	= this.overlay.fg.r;
				imgd.data[i+1]	= this.overlay.fg.g;
				imgd.data[i+2]	= this.overlay.fg.b;
				// imgd.data[i+3]  = 255; // imgd.data[i+3];
			}
			this.cctx.putImageData(imgd, this.overlay.lastX, 0);
			*/

			// this.cctx.globalAlpha = 12;
			this.cctx.globalCompositeOperation = 'source-atop';
		    this.cctx.fillStyle = this.overlay.fg.all;
		    this.cctx.fillRect(
				this.overlay.lastX, 0,
				(this.overlay.thisX - this.overlay.lastX), this.canvas.height
		    );
		}
		catch (e) {
			this.stop();
		}
	},

	/** Offline audio processing is faster than real time.
	    Used here to apply frequency analysis to colour the wave.
	    Sets a few parameters for use during playback. */
	offline_overlayImg: function(e){
		if (typeof this.overlay.pxPerSec == 'undefined'){
			this.overlay.pxPerSec = this.width / this.buffer.duration;
			//console.info( 'this.overlay.pxPerSec = ', this.overlay.pxPerSec)
			//console.log( 'width = ', this.width, ', total px = ', this.overlay.pxPerSec * this.buffer.duration);
		}
		
		var fromX = e.playbackTime * this.overlay.pxPerSec;
		var toX   =  fromX + ( e.inputBuffer.duration * this.overlay.pxPerSec);
		
		if (parseInt( toX ) > parseInt(fromX)){
			if (! this.offlineRenderStarted){
				this.offlineRenderStarted = true;
				fromX = 0;
			}

		    var data =  new Uint8Array( this.offline_analyser.frequencyBinCount );
		    this.offline_analyser.getByteFrequencyData(data);
		    
		    var clrIndex = 0;
		    if (this.options.frequencyby == 'average'){
			    var values = 0;
			    for (var j=0; j < data.length; j++) {
			        values += data[j];
			    }
			    clrIndex = parseInt( values / data.length );
			}
			else {
			    var max = 0;
			    for (var j=0; j < data.length; j++) {
				       	if (data[j] > max) max = data[j]
				    }
				clrIndex = max;
			}
			this.cctx.globalAlpha = 255;
			this.cctx.globalCompositeOperation = 'source-atop';
			this.cctx.fillStyle = 'hsl(' + this.freqClrs[ clrIndex ]+')';
			this.cctx.fillRect(
				fromX, 0,
				toX, this.canvas.height
			);
		}
	},

	colourFrequencies: function(){
		var self = this;
		if (this.buffer === null) throw 'setNode not caled, no buffer!';
		
		this.octx = new OfflineAudioContext( this.buffer.numberOfChannels, this.buffer.length, this.buffer.sampleRate );

		this.offline_node = this.octx.createBufferSource();

		this.offline_analyser = this.octx.createAnalyser();
		this.offline_analyser.fftsize = this.options.fftsize;
		this.offline_analyser.smoothingTimeConstant = .9;

		this.offline_processor = this.octx.createScriptProcessor( this.options.fftsize, this.buffer.numberOfChannels, this.buffer.numberOfChannels);
		this.offline_processor.connect( this.octx.destination );

		this.offline_analyser.connect( this.offline_processor );

		this.offline_node.connect( this.offline_analyser );

		// When rendered, store the canvas for replays
		this.octx.oncomplete = function(){
			self.graphComplete();
		}
        this.offline_processor.onaudioprocess = function(e){
        	self.offline_overlayImg( e )
        }

		this.offline_node.buffer = this.buffer; 
		this.offline_node.start();
        this.octx.startRendering();
	},

	setNode: function(){
		this.node 			=	this.actx.createBufferSource();
		this.node.buffer 	=	this.buffer;
		this.node.connect( 		this.actx.destination );
	},

	setClrs: function(){
		for (var i=0; i<=255; i++){
			this.freqClrs.push( 
				parseInt( 
					2 * (i * 254 / 360) 
				) + ',' +
				this.options.saturation + '%,' +
				this.options.lightness	+ '%'
			);
		}
	},

	/* Stores the graph for repainting on repeat plays; makes the graph clickable */
	graphComplete: function(){
		var self = this;

		this.storeCanvasImg();

		if (this.options.asimg ){
			// store the current globalCompositeOperation
			var compositeOperation = this.cctx.globalCompositeOperation;
			
			// Set to draw behind current content
			this.cctx.globalCompositeOperation = "destination-over";
			
			this.cctx.fillStyle = this.options.background;
			this.cctx.fillRect(0,0, this.canvas.width, this.canvas.height);

	 		this.img.src = this.canvas.toDataURL();
			this.img.replaces( this.canvas );
			
			// Restore the previous state
			this.cctx.globalCompositeOperation = compositeOperation;

			if (this.options.playable){
				this.img.addEvent('click', function(e){
					self.clickedGraphic(e);	
				});
			}
		}
		
		else if (this.options.playable){
			this.canvas.addEvent('click', function(e){
				self.clickedGraphic(e);	
			});
		}
	},

	storeCanvasImg: function(){
		this.canvasImgData = this.cctx.getImageData( 
			0, 0,
			this.canvas.width, this.canvas.height
		);
	},

	replaceCanvasImg: function(){
		this.canvas.width = this.canvas.width;
		this.cctx.putImageData( this.canvasImgData, 0, 0);
	}

});


/* Convert to PcmImages all DOM elements selected by 
   the 'selector' supplied as the sole argument, which
   defaults to '.pcmimg' 
   Could have read <audio> nodes and used their
   media element node, but want Ajax loading at times.
*/
PcmImage.parseDOM = function( selector ){
	selector = selector || '.pcmimg';
	$$( selector ).each( function(el){
		var opts = {
			element: el,
			uri:	 el.dataset.uri,
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

