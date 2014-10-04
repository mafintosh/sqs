var request = require('request');
var crypto = require('crypto');
var qs = require('querystring');
var http = require('http');
var https = require('https');

var SIGNATURE_METHOD  = 'HmacSHA256';
var SIGNATURE_VERSION = '2';
var SIGNATURE_TTL = 150*1000;
var VERSION = '2012-11-05';
var DEFAULT_REGION = 'us-east-1';

var text = function(xml, tag) {
	var i = xml.indexOf('<'+tag+'>');
	if (i === -1) return null;
	i += tag.length+2;

	return xml.substring(i, xml.indexOf('</', i));
};

var unscape = function(xml) {
	return xml.replace(/&quot;/g, '"').replace(/$apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};

var range = function(num) {
	return Array(num).join(',').split(',');
};

module.exports = function(options) {
	options = options || {};

	options.access = options.access || process.env.SQS_ACCESS_KEY;
	options.secret = options.secret || process.env.SQS_SECRET_KEY;
	options.region = options.region || process.env.SQS_REGION || DEFAULT_REGION;

	if (!options.access || !options.secret) throw new Error('options.access and options.secret are required');

	var queues = {};
	var closed = false;
	var proto = options.https ? 'https://' : 'http://';
	var host = 'sqs.'+options.region+'.amazonaws.com';
	var namespace = options.namespace ? options.namespace+'-' : '';

	namespace = namespace.replace(/[^a-zA-Z0-9]/g, '-').replace(/\-+/g, '-');

	var queryURL = function(action, path, params) {
		params = params || {};

		params.Action = action;
		params.AWSAccessKeyId = options.access;
		params.SignatureMethod = SIGNATURE_METHOD;
		params.SignatureVersion = SIGNATURE_VERSION;
		params.Expires = new Date(Date.now()+SIGNATURE_TTL).toISOString();
		params.Version = VERSION;

		var stringToSign = 'GET\n'+host+'\n'+path+'\n'+Object.keys(params).sort().map(function(name) {
			return name+'='+encodeURIComponent(params[name]).replace(/[!'()]/g, escape).replace(/\*/g, '%2A');
		}).join('&');

		params.Signature = crypto.createHmac('sha256',options.secret).update(stringToSign).digest('base64');

		return proto+host+path+'?'+qs.stringify(params);
	};

	var retry = function(req, url, callback) {
		var retries = 0;
		var action = function() {
			req(url, {timeout:10000}, function(err, res) {
				if (!err && res.statusCode >= 500) err = new Error('invalid status-code: '+res.statusCode);
				if (callback) return callback(err);
				if (!err) return;
				retries++;
				if (retries > 15) return that.emit('error', new Error('could not send '+url));
				setTimeout(action, retries*1000);
			});
		};

		action();
	};

	var queueURL = function(name, callback) {
		if (queues[name]) return queues[name](callback);

		var stack = [callback];

		queues[name] = function(callback) {
			stack.push(callback);
		};

		var onresult = function(err, url) {
			if (err) return that.emit('error', err);

			queues[name] = function(callback) {
				callback(url);
			};

			while (stack.length) {
				stack.shift()(url);
			}
		};

		request(queryURL('CreateQueue', '/', {QueueName:name}), function(err) {
			if (err) return onresult(err);
			request(queryURL('GetQueueUrl', '/', {QueueName:name}), function(err, res) {
				if (err || res.statusCode !== 200) return onresult(err || new Error('invalid status code from GetQueueUrl: '+res.statusCode));
				onresult(null, '/'+text(res.body, 'QueueUrl').split('/').slice(3).join('/'));
			});
		});
	};

	var that = new process.EventEmitter();

	that.push = function(name, message, callback) {
		name = namespace+name;

		queueURL(name, function(url) {
			retry(request, queryURL('SendMessage', url, {MessageBody:JSON.stringify(message)}), callback);
		});
	};

	that.delete = that.del = function(name, callback) {
		name = namespace+name;

		queueURL(name, function(url) {
			retry(request, queryURL('DeleteQueue', url), callback);
		});
	};

	var pullIntervalSeconds = options.pullIntervalSeconds || 2;

	that.pull = function(name, workers, onmessage) {
		if (typeof workers === 'function') return that.pull(name, options.workers || 1, workers);

		name = namespace+name;

		var agent =  options.https ? new https.Agent({maxSockets:workers}) : new http.Agent({maxSockets:workers}); // long poll should use its own agent
		var req = request.defaults({agent:agent});

		range(workers).forEach(function() {
			var next = function() {
				if (closed) return;

				queueURL(name, function(url) {
					req(queryURL('ReceiveMessage', url, {WaitTimeSeconds:20}), function(err, res) {
						if (err || res.statusCode !== 200) {
							return setTimeout(next, pullIntervalSeconds * 1000);
						}

						var body = text(res.body, 'Body');

						if (!body)
							return options.pullIntervalSeconds
								? setTimeout(next, pullIntervalSeconds * 1000)
								: next();

						var receipt = text(res.body, 'ReceiptHandle');

						try {
							body = JSON.parse(unscape(body));
						} catch (err) {
							return next();
						}

						// Callback takes an arbitrary error and a `stop` attribute to stop
						// polling for messages
						onmessage(body, function(err, ctx) {
							if (err) return next();
							retry(request, queryURL('DeleteMessage', url, {ReceiptHandle:receipt}));
							if (ctx && ctx.stop === true) return;
							next();
						});

					});
				});
			};

			next();
		});
	};

	that.close = function() {
		closed = true;
	};

	return that;
};
