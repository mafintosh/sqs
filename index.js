var request = require('request');
var crypto = require('crypto');
var qs = require('querystring');
var http = require('http');

var SIGNATURE_METHOD  = 'HmacSHA256';
var SIGNATURE_VERSION = '2';
var SIGNATURE_TTL = 30*1000;
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
	options.token  = options.token  || process.env.SQS_TOKEN;

	if (!options.access || !options.secret) throw new Error('options.access and options.secret are required');

	var queues = {};
	var closed = false;
	var agent = new http.Agent();

	var req = request.defaults({ // we use long polling so we wanna use over own agent
		agent:agent
	});

	var queryURL = function(action, path, params) {
		var host = 'sqs.'+(options.region || DEFAULT_REGION)+'.amazonaws.com';

		params = params || {};

		params.Action = action;
		params.AWSAccessKeyId = options.access;
		params.SignatureMethod = SIGNATURE_METHOD;
		params.SignatureVersion = SIGNATURE_VERSION;
		params.Expires = new Date(options.expires || Date.now()+SIGNATURE_TTL).toISOString();
		params.Version = VERSION;

		if (options.token) {
			params.SecurityToken = options.token;
		}

		var stringToSign = 'GET\n'+host+'\n'+path+'\n'+[].concat(Object.keys(params).sort().map(function(name) {
			return name+'='+encodeURIComponent(params[name]).replace(/\*/g, '%2A');
		})).join('&');

		params.Signature = options.signature || crypto.createHmac('sha256',options.secret).update(stringToSign).digest('base64');

		return 'http://'+host+path+'?'+qs.stringify(params);
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

		req(queryURL('CreateQueue', '/', {QueueName:name}), function(err) {
			if (err) return onresult(err);
			req(queryURL('GetQueueUrl', '/', {QueueName:name}), function(err, res) {
				if (err) return onresult(err);
				if (res.statusCode !== 200) return onresult(new Error('could not create queue'));
				onresult(null, '/'+text(res.body, 'QueueUrl').split('/').slice(3).join('/'));
			});
		});
	};

	var that = new process.EventEmitter();

	that.push = function(name, message) {
		queueURL(name, function(url) {
			req(queryURL('SendMessage', url, {MessageBody:JSON.stringify(message)})); // TODO: check response and retry if err
		});
	};

	that.pull = function(name, workers, onmessage) {
		if (typeof workers === 'function') return that.pull(name, options.workers || 1, workers);

		range(workers).forEach(function() {
			var next = function() {
				if (closed) return;

				queueURL(name, function(url) {
					req(queryURL('ReceiveMessage', url, {WaitTimeSeconds:20}), function(err, res) {
						if (err) return setTimeout(next, 2000);
						if (res.statusCode !== 200) return setTimeout(next, 2000);

						var body = text(res.body, 'Body');

						if (!body) return next();

						var receipt = text(res.body, 'ReceiptHandle');

						try {
							body = JSON.parse(unscape(body));
						} catch (err) {
							return next();
						}

						onmessage(body, function(err) {
							if (err) return next();
							req(queryURL('DeleteMessage', url, {ReceiptHandle:receipt})); // TODO: check response and retry if err
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