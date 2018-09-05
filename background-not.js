(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Buffer     = require("./buffer");
var Controller = require("./controller");
var utils      = require("./utils");

var connectionsBuffer = new Buffer.ConnectionsBuffer();
var controller        = new Controller();

var tcpServer = chrome.sockets.tcpServer;
var tcpSocket = chrome.sockets.tcp;

var serverSocketId;

tcpServer.onAccept.addListener( onAccept );
tcpSocket.onReceive.addListener( connectionsBuffer.receive );

function showErrorWindow() {
	chrome.app.window.create('/html/error.html', {		
		innerBounds: {
			width: 400,
			height: 200
    	},
    	resizable : false
  	});
};

function onAccept( acceptInfo ) {
    tcpSocket.setPaused(acceptInfo.clientSocketId, false);

    if (acceptInfo.socketId != serverSocketId) {
        return;
    }    
};
function sendReplyToSocket( socketId, responseObject ) {
	var buffer = utils.createHttpResponse( responseObject );

	// verify that socket is still connected before trying to send data
	tcpSocket.getInfo( socketId, function( socketInfo ) {
		if ( !socketInfo || !socketInfo.connected ) {
			destroySocketById( socketId );
			return;
		}

		tcpSocket.send( socketId, buffer, function( writeInfo ) {			
			destroySocketById( socketId );			
		});
		
	});
};

function destroySocketById( socketId, callback ) {
	tcpSocket.disconnect( socketId, function() {
		tcpSocket.close( socketId );

		if ( callback ) callback();
	});
};
function createNotificationServer( port, ipport ) {
	tcpServer.create( {}, function( socketInfo ) {
		serverSocketId = socketInfo.socketId;
        console.log("Notification server started.");
		connectionsBuffer.initialize();

		connectionsBuffer.onComplite( function( socketData ) {		
			controller.execute( socketData.get(), function( responseObj ) {
				sendReplyToSocket( socketData.getSocketId(), responseObj );	
			});		
		} );

		connectionsBuffer.onError( function( socketData ) {
			sendReplyToSocket( socketData.getSocketId(), {
				"response"   : socketData.get(),
				"statusCode" : 400
			});				
		} );
        tcpServer.listen(serverSocketId, ipport, port, 10, function(result) {	//Aca modificar el ip del equipo donde se instala la aplicacion para que muestre la notificacion	
			if ( chrome.runtime.lastError ) {				
				console.log( chrome.runtime.lastError["message"] );		
				showErrorWindow();		
				return; 
			}
			
			console.log("Notification server started.");
	    });
	});	
};

function restartNotificationServer( port ) {
	if ( serverSocketId ) {
		console.log( "Destroy socket: ", serverSocketId );
		tcpServer.disconnect( serverSocketId, function() {
			tcpServer.close( serverSocketId, function() {
				createNotificationServer( port );
			} );						
		} );
	}
	else {
		createNotificationServer( port );		
	}	
};

    chrome.storage.sync.get(["port", "ipport"], function (data) {
    if (window.localOptions) {
        var options = window.localOptions

        console.log("Starting server on port: ", options.port);
        console.log("Starting server on port: ", options.IPport);
        var port = options.port;
        var ipport = options.IPport
        createNotificationServer(port, ipport);
    } else {
        console.log(chrome.runtime.lastError["message"]);
        showErrorWindow();
        return;
    }
    
 	
});

/**
 * Restart Notification Server on different port if user change it
 */
chrome.storage.onChanged.addListener(function(changes, namespace) {
	if ( changes["port"] ) {
		var port = parseInt( changes["port"]["newValue"] );

		restartNotificationServer( port );		
	}
});
},{"./buffer":2,"./controller":5,"./utils":6}],2:[function(require,module,exports){
var utils = require("./utils");

var SocketData = function( socketId ) {
	var self = this;

	this._socketId      = socketId;
	this._isInitialized = false;	

	this._initialize = function( data ) {
		var request = utils.parseRequest( data );
		var headers = request["headers"];
		if ( !headers ) {
			throw new Error("Bad request");
			return;
		}

		if ( !headers["content-length"] ) {
			throw new Error("No content-length header");
			return;
		}		

		self._contentLength = parseInt( headers["content-length"] );
		self._loadedLength  = request["message"].length;
		self._data          = request["message"]; 
		self._isInitialized = true;
	}

	this.add = function( data ) {
		if ( !self._isInitialized ) {
			self._initialize( data );			
		}
		else {
			self._loadedLength += data.length;
			self._data         += data;
		}

		if ( self._contentLength == self._loadedLength ) {
			return true;
		}
		
		return false;
	},

	this.get = function() {
		return self._data;
	},

	this._set = function( data ) {
		self._data = data;
	}

	this.getSocketId = function() {
		return self._socketId;
	}
}

module.exports.SocketData = SocketData;

module.exports.ConnectionsBuffer = function() {
	var self = this;

	this.initialize = function() {
		self._sockets   = {};
		self._compliteListeners = [];
		self._errorListeners    = [];
	}

	this.receive = function( receiveInfo ) {
		var socketId  = receiveInfo.socketId;
		var data      = utils.arrayBufferToString(receiveInfo.data);

		var isReceiveComplite = false;

		try {
			isReceiveComplite = self._addSocketData( socketId, data );
		}
		catch( e ) {
			console.log(e);
			self._error( socketId, e.toString() );
		}

		if ( isReceiveComplite ) {
			self._complite( socketId );			
		}
	}

	this.hasSocket = function( socketId ) {
		if ( !self._sockets[ socketId ] ) return false;
		return true;
	}

	this._addSocketData = function( socketId, data ) {
		if ( !self.hasSocket( socketId ) ) {
			self._sockets[ socketId ] = new SocketData( socketId );
		}

		var socketData = self._sockets[ socketId ];
		return socketData.add( data );
	}

	this._complite = function( socketId ) {
		var socketData = self._sockets[ socketId ];

		delete self._sockets[ socketId ];

		for( var i in self._compliteListeners ) {
			self._compliteListeners[i]( socketData );
		}
	}

	this.onComplite = function( callback ) {
		self._compliteListeners.push( callback );
	}

	this._error = function( socketId, errorText ) {
		var socketData = self._sockets[ socketId ];
		socketData._set( errorText );

		for( var i in self._errorListeners ) {
			self._errorListeners[i]( socketData );
		}
	}

	this.onError = function( callback ) {
		self._errorListeners.push( callback );
	}

}
},{"./utils":6}],3:[function(require,module,exports){
var commandName = "notification";

module.exports = function( data, callback ) {

	if ( data && !data["iconUrl"] ) {
        data["iconUrl"] = chrome.runtime.getURL( "/images/odoo_o128.png" );
	}

	chrome.notifications.create( data, function() {
		if ( chrome.runtime.lastError ) {
			callback( chrome.runtime.lastError["message"], 400 );
			return;
		}
		
		callback( "OK" );
		return;		
	} );
}
},{}],4:[function(require,module,exports){
var commandName = "ping";

module.exports = function( data, callback ) {
	callback( "chrome-notification-server" );
}
},{}],5:[function(require,module,exports){
var utils = require("./utils");
var commands = {
	"ping"          : require("./commands/ping"),
	"notification"  : require("./commands/notification")
};

module.exports = function Controller() {

	var self = this;	

	this.execute = function( dataString, callback ) {
		try {  
			var request = this._parseRequest( dataString );
			var command = request["command"];
			var data    = request["data"];
		}
		catch( e ) {			
			callback( self._createResponse( e.toString(), 400 ) );
			return;
		}		

		if ( command in commands ) {
			commands[command]( data, function( response, httpCode ) {
				httpCode = httpCode || 200;
				callback( self._createResponse( response ), httpCode );
			} );
			return;
		}

		callback( self._createResponse( "Unknown command" ), 400 );		
	}

	this._parseRequest = function( data ) {
		var request = null;

		try {
			request = JSON.parse( data );
		}
		catch ( e ) {
			throw new Error( "Bad JSON syntax" );
		} 

		if ( (typeof request != "object") || !("command" in request) || !("data" in request) ) {
			throw new Error( "Field 'command' or 'data' doesn't exist" );	
		}

		return request;
	}

	this._createResponse = function( dataString, statusCode ) {
		return {
			"response"   : dataString,
			"statusCode" : statusCode
		}
	}
		
}
},{"./commands/notification":3,"./commands/ping":4,"./utils":6}],6:[function(require,module,exports){
module.exports.arrayBufferToString = function( buffer ) {
	var str = "";
	var uArrayVal = new Uint8Array(buffer);
	for (var s = 0; s < uArrayVal.length; s++) {
	    str += String.fromCharCode(uArrayVal[s]);
	}
	return str;
};

module.exports.stringToUint8Array = function( string ) {
    var buffer = new ArrayBuffer(string.length);
    var view = new Uint8Array(buffer);
    for (var i = 0; i < string.length; i++) {
      view[i] = string.charCodeAt(i);
    }
    return view;
};

var methods = {
	"GET"     : true,
	"POST"    : true,
	"PUT"     : true,
	"HEAD"    : true,
	"DELETE"  : true,
	"OPTIONS" : true,
	"PATCH"   : true,
	"TRACE"   : true,
	"CONNECT" : true
};

module.exports.parseRequest = function( response ) {
	var request = {};
	request["headers"] = null;
	request["message"] = null;

	// Remove first line with HTTP method name
	if ( response.substring(0, response.indexOf(' ') ) in methods ) {
		response = response.substring( response.indexOf('\n') );
	}

	var httpParts = response.split("\r\n\r\n");
	if ( httpParts.length != 2 ) {
		return request;
	}

	var headersBlock = httpParts[0];
	var parts = headersBlock.split("\n");

	var headers = {};
	for( var i in parts ) {
		var headerString = parts[i];
		var headerParts  = headerString.split(":");

		if ( headerParts[1] == undefined ) continue;

		headers[ headerParts[0].toLowerCase() ] = headerParts[1].trim();
	}

	request["headers"] = headers;
	request["message"] = httpParts[1];

	return request;
}

module.exports.createHttpResponse = function( response ) {
	var dataString = response["response"];
	var statusCode = response["statusCode"] || 200;

	var contentType   = "application/json";
    var contentLength = dataString.length;    

    var lines = [
      "HTTP/1.0 " + statusCode + " OK",
      "Content-length: " + contentLength,
      "Content-type:"    + contentType      
    ];	    

    var response = lines.join("\n");
    response += "\n\n" + dataString;

    var responseArray = module.exports.stringToUint8Array( response );	    
    var outputBuffer = new ArrayBuffer(responseArray.byteLength);

	var view = new Uint8Array(outputBuffer);
    view.set(responseArray, 0);

    return outputBuffer;
}

module.exports.validatePort = function( input ) {
	input += "";
	var min = 1;
	var max = 65535;
    var num = +input;
    return num >= min && num <= max && input === num.toString() && input.indexOf(".") == -1;
}

},{}]},{},[1]);
