"use strict";

var nodeUrl = require("url");
//var RpcProtocol = require('../protocol/rpc-protocol.js');
var channel = require('../infrastructure/channel.js');
var uuid = require('node-uuid');
var RSVP = require('rsvp');
require('sexylog');
var Handler = require('../infrastructure/handler-class.js');
var messages = require('../domain/messages.js');


var handlerMappings = {};
var serviceName;
var protocolName = 'rpc';
exports.getApi = function(name, transport) {
    serviceName = name;

    var api = {
        name: function() {
            return protocolName;
        },
        request: function(remoteServiceUrl, data, clientCallback) {
           var serviceRequest = nodeUrl.parse(remoteServiceUrl, true);
           var transChannel = transport.openChannel(serviceRequest.hostname, protocolName);
           var clientChannel = channel.create("client-api");
           var rpcProtocolClientHandler = clientHandler(remoteServiceUrl);
           clientChannel.rightHandler(rpcProtocolClientHandler);
           transChannel.handler(rpcProtocolClientHandler);

           var promise = new RSVP.Promise(function(resolve, reject) {
                var callback = function(event) {
                        if (! event) {
                            logger.warn('client-api promise failed check! calling promise.reject()');
                            reject(event);
                        } else {
                            logger.trace('promise calling promise.resolve() event.id=' + event.id);
                            resolve(event);
                        }
                };
                if (clientCallback) callback = clientCallback;
                clientChannel.leftConnection().listen(callback);
                clientChannel.leftConnection().send(data);
            });

            return promise;

        },
        handle: function(endpoint, callback) {
            logger.debug('[*** API ***] registering handler endpoint: ' + endpoint);
            handlerMappings[endpoint] = callback;
        },
        protocolHandler: function() {
            return {
                server: function() {
                    return serverHandler();
                },
                client: function(remoteServiceUrl) {
                    return clientHandler(remoteServiceUrl);
                }
            }
        }
    }
    return api;
}



function serverHandler() {

         var incomingMuonMessage;

         class RpcProtocolHandler extends Handler {

           outgoingFunction(message, forward, back, route) {
               logger.debug("[*** PROTOCOL:SERVER:RPC ***] server rpc protocol outgoing message=%s", JSON.stringify(message));
                var serverResponse = {
                     status: 200,
                     body: messages.encode(message),
                     content_type: "application/json"
                   };
                var outboundMuonMessage = messages.muonMessage(serverResponse, serviceName, incomingMuonMessage.origin_service, protocolName, "request.response");
                logger.trace("[*** PROTOCOL:SERVER:RPC ***] rpc protocol outgoing muonMessage=" + JSON.stringify(outboundMuonMessage));
               forward(outboundMuonMessage);
           }

           incomingFunction(message, forward, back, route) {
               incomingMuonMessage = message;
               logger.info("[*** PROTOCOL:SERVER:RPC ***] rpc protocol incoming event id=" + incomingMuonMessage.id);
               logger.debug("[*** PROTOCOL:SERVER:RPC ***] rpc protocol incoming message=%s", JSON.stringify(incomingMuonMessage));
               logger.trace("[*** PROTOCOL:SERVER:RPC ***] rpc protocol incoming message type=%s", (typeof incomingMuonMessage));

               var payload = messages.decode(incomingMuonMessage.payload, incomingMuonMessage.content_type);
               logger.info("[*** PROTOCOL:SERVER:RPC ***] RPC payload =%s", JSON.stringify(payload));

               var endpoint = payload.url;
               payload.body = messages.decode(payload.body, payload.content_type)

               var handler = handlerMappings[endpoint];
               if (! handler) {
                   logger.warn('[*** PROTOCOL:SERVER:RPC ***] NO HANDLER FOUND FOR ENDPOINT: "' + endpoint + '" RETURN 404! event.id=' + incomingMuonMessage.id);
                   payload.status = 404
                   var return404msg = messages.resource404(incomingMuonMessage, payload);
                   back(return404msg);
               } else {
                   logger.info('[*** PROTOCOL:SERVER:RPC ***] Handler found for endpoint "'+ endpoint + '" event.id=' + incomingMuonMessage.id);
                   route(payload, endpoint);
               }
           }
         };

         var rpcProtocolHandler = new RpcProtocolHandler('server-rpc', handlerMappings);
         return rpcProtocolHandler;
}





function clientHandler(remoteServiceUrl) {
        var TIMEOUT_MS = 10000;
        var responseReceived = false;
         var remoteService = nodeUrl.parse(remoteServiceUrl, true).hostname;

        class RpcProtocolHandler extends Handler {

             outgoingFunction(message, forward, back, route) {
                 logger.debug("[*** PROTOCOL:CLIENT:RPC ***] client rpc protocol outgoing message=%s", JSON.stringify(message));

                  var request = {
                       url: remoteServiceUrl,
                       body: messages.encode(message),
                       content_type: "application/json"
                     };
                  var muonMessage = messages.muonMessage(request, serviceName, remoteService, protocolName, "request.made");
                  logger.trace("[*** PROTOCOL:CLIENT:RPC ***] client rpc protocol outgoing muonMessage=%s", JSON.stringify(muonMessage));
                 forward(muonMessage);

                 setTimeout(function () {
                     if (! responseReceived) {
                           logger.info('[*** PROTOCOL:CLIENT:RPC ***] timeout reached responding with timeout message');
                           var timeoutMsg = rpcMessage("timeout", remoteServiceUrl, {}, {status: 'timeout', body: 'rpc response timeout exceeded'});
                           back(timeoutMsg);
                     }
                 }, TIMEOUT_MS);
             }


             incomingFunction(message, forward, back, route) {
                 logger.info("[*** PROTOCOL:CLIENT:RPC ***] rpc protocol incoming message id=" + message.id);
                 logger.debug("[*** PROTOCOL:CLIENT:RPC ***] rpc protocol incoming message=%s", JSON.stringify(message));
                 responseReceived = true;
                 var rpcMessage =  messages.decode(message.payload, message.content_type)
                 if (rpcMessage.body != undefined) {
                     rpcMessage.body = messages.decode(rpcMessage.body, rpcMessage.content_type)
                 }
                 logger.info ("Sending the response payload " + rpcMessage)
                 forward(rpcMessage);
             }

        }; //RpcProtocolHandler


        var rpcProtocolHandler = new RpcProtocolHandler('client-rpc');
         return rpcProtocolHandler;

}




function rpcMessage(statusCode, url, body, error) {
    if (! body) body = {};
    if (! error) error = {};
    if (! statusCode)  {
        var error = new Error('rpcMessage() invalid status: "' + statusCode + '"');
        logger.error(error);
        throw error;
    }
    var rpcMsg = {
        body: body,
        status: statusCode,
        url: url,
        error: error,
        endpoint: function() {
             return nodeUrl.parse(url, true).path;
        }
    }
    return rpcMsg;
}

function rpcRequest(statusCode, url, body, error) {
    if (! body) body = {};
    if (! error) error = {};
    if (! statusCode)  {
        var error = new Error('rpcMessage() invalid status: "' + statusCode + '"');
        logger.error(error);
        throw error;
    }
    var rpcMsg = {
        body: body,
        status: statusCode,
        url: url,
        error: error,
        endpoint: function() {
             return nodeUrl.parse(url, true).path;
        }
    }
    return rpcMsg;
}
