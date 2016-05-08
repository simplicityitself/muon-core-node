var nodeUrl = require("url");
//var RpcProtocol = require('../protocol/rpc-protocol.js');
var channel = require('../infrastructure/channel.js');
var uuid = require('node-uuid');
var RSVP = require('rsvp');
require('sexylog');
var handler = require('../infrastructure/handler.js');
var messages = require('../domain/messages.js');


var serviceName;
var protocols = [];
var protocolName = 'introspect';
exports.getApi = function (name, transport) {
    serviceName = name;

    var api = {
        name: function () {
            return protocolName;
        },
        introspect: function (remoteService, clientCallback) {
            var transChannel = transport.openChannel(remoteService, protocolName);
            var clientChannel = channel.create("client-api");
            var rpcProtocolClientHandler = clientHandler(remoteService);
            clientChannel.rightHandler(rpcProtocolClientHandler);
            transChannel.handler(rpcProtocolClientHandler);

            var promise = new RSVP.Promise(function (resolve, reject) {
                var callback = function (event) {
                    if (!event) {
                        logger.warn('client-api promise failed check! calling promise.reject()');
                        reject(event);
                    } else {
                        logger.trace('promise calling promise.resolve() event.id=' + event.id);
                        resolve(event);
                    }
                };
                if (clientCallback) callback = clientCallback;
                clientChannel.leftConnection().listen(callback);
                logger.info("SENDING DATA DOWN THE WIRE FOR THE AWESOME")
                clientChannel.leftConnection().send({});
            });

            return promise;

        },
        protocols: function(ps) {
            protocols = ps;
        },
        protocolHandler: function () {
            return {
                server: function () {
                    return serverHandler();
                },
                client: function (remoteServiceUrl) {
                    return clientHandler(remoteServiceUrl);
                }
            }
        }
    }
    return api;
}


function clientHandler(remoteService) {
    var TIMEOUT_MS = 10000;
    var responseReceived = false;
    var protocolHandler = handler.create('client-introspect');

    // OUTGOING/DOWNSTREAM event handling protocol logic
    protocolHandler.outgoing(function (requestData, accept, reject, route) {
        logger.info("[*** PROTOCOL:CLIENT:INTROSPECT ***] client protocol outgoing requestData=%s", JSON.stringify(requestData));

        var request = {};
        var muonMessage = messages.muonMessage(request, serviceName, remoteService, protocolName, "introspectionRequested");
        accept(muonMessage);

        setTimeout(function () {
            if (!responseReceived) {
                logger.info('[*** PROTOCOL:CLIENT:INTROSPECT ***] timeout reached responding with timeout message');
                var timeoutMsg = introspectionRequest("timeout", remoteService, {}, {
                    status: 'timeout',
                    message: 'response timeout exceeded'
                });
                reject(timeoutMsg);
            }
        }, TIMEOUT_MS);
    });


    // INCOMING/UPSTREAM  event handling protocol logic
    protocolHandler.incoming(function (introspectionResponse, accept, reject, route) {
        logger.info("[*** PROTOCOL:CLIENT:INTROSPECT ***] protocol incoming event id=" + introspectionResponse.id);
        logger.info("[*** PROTOCOL:CLIENT:INTROSPECT ***] protocol incoming message=%s", JSON.stringify(introspectionResponse));
        responseReceived = true;
        var introspectionReport = messages.decode(introspectionResponse.payload, introspectionResponse.content_type)
        if (introspectionReport.body != undefined) {
            introspectionReport.body = messages.decode(introspectionReport.body, introspectionReport.content_type)
        }
        logger.info("Sending the introspection payload " + introspectionReport)
        accept(introspectionReport);
    });
    //logger.trace('**** rpc proto: '+JSON.stringify(rpcProtocolHandler));
    return protocolHandler;

}


  function serverHandler() {

         var protocolHandler = handler.create('client-introspect');

        // OUTGOING/DOWNSTREAM event handling protocol logic
         protocolHandler.outgoing(function(serverResponseData, accept, reject, route) {
                logger.info("[*** PROTOCOL:SERVER:INTROSPECT ***] server protocol outgoing requestData=%s", JSON.stringify(serverResponseData));
                accept(serverResponseData);
         });

         // INCOMING/UPSTREAM  event handling protocol logic
         protocolHandler.incoming(function(msg, accept, reject, route) {
                incomingMuonMessage = msg;
                logger.debug("[*** PROTOCOL:SERVER:INTROSPECT ***] rpc protocol incoming message=%s", JSON.stringify(incomingMuonMessage));

                protocolsResponse = [];
                for (var i = 0 ; i < protocols.length ; i++) {
                  var protocol = protocols[i];
                  protocolsResponse.push({
                    protocolScheme: protocol.name(),
                        protocolName: 'N/A',
                        description: 'N/A',
                        operations: 'N/A'

                  });
                }

                var introResponse = {
                  serviceName: serviceName,
                  protocols: protocolsResponse
                }

                var outboundMuonMessage = messages.muonMessage(introResponse, serviceName, incomingMuonMessage.origin_service, protocolName, "introspectResponse");
                reject(outboundMuonMessage);

         });
         return protocolHandler;

}


function introspectionRequest(statusCode, url, body, error) {
    if (!body) body = {};
    if (!error) error = {};
    if (!statusCode) {
        var error = new Error('introspectionRequest() invalid status: "' + statusCode + '"');
        logger.error(error);
        throw error;
    }
    var rpcMsg = {
        body: body,
        statusCode: statusCode,
        url: url,
        error: error,
        endpoint: function () {
            return nodeUrl.parse(url, true).path;
        }
    }
    return rpcMsg;
}

function rpcRequest(statusCode, url, body, error) {
    if (!body) body = {};
    if (!error) error = {};
    if (!statusCode) {
        var error = new Error('introspectionRequest() invalid status: "' + statusCode + '"');
        logger.error(error);
        throw error;
    }
    var rpcMsg = {
        body: body,
        statusCode: statusCode,
        url: url,
        error: error,
        endpoint: function () {
            return nodeUrl.parse(url, true).path;
        }
    }
    return rpcMsg;
}
