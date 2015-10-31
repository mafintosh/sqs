# sqs

A message queue using [Amazon Simple Queue Service](http://docs.amazonwebservices.com/AWSSimpleQueueService/latest/APIReference/Welcome.html).

	npm install sqs

Usage is simple

``` js
var sqs = require('sqs');

var queue = sqs({
	access:'my-aws-access-key',
	secret:'my-aws-secret-key',
	region:'us-east-1' // defaults to us-east-1
});

// push some data to the test queue
queue.push('test', {
	some:'data'
}, function () {
	// complete
});

// pull messages from the test queue
queue.pull('test', function(message, callback) {
	console.log('someone pushed', message);
	callback(); // we are done with this message - pull a new one
	            // calling the callback will also delete the message from the queue
});
```

## API

	var queue = sqs(options)

Create a queue instance. Available options are

* `options.access` - Your AWS access key (required)
* `options.secret` - Your AWS secret key (required)
* `options.region` - The AWS region for the queue. Defaults to us-east-1
* `options.namespace` - Prefix all queues with `namespace`. Defaults to empty string.
* `options.https` - If true use https. Defaults to false.
* `options.raw` - If true it doesn't parse message's body to JSON. Defaults to false.

Some of the options can be configured using env vars. See below for more.

	queue.push(name, message, [callback])

Push a new message to the queue defined by name. If the queue doesn't exist sqs will create it. Optional callback called once request is completed.

	queue.pull(name, [workers=1], onmessage)

Pull messages from the queue defined by name.

The pull flow is as follows:

1. A message is pulled and is passed to `onmessage(message, callback)`
2. You process the message
3. Call `callback` when you are done and the message will be deleted from the queue.
4. Goto 1

If for some reason the callback is not called amazon sqs will re-add the message to the queue after 30s.

## Fault tolerance

Both `pull` and `push` will retry multiple times if a network error occurs or if amazon sqs is temporary unavailable.

## Env config

You can use env variables to configure `sqs` as well

```
SQS_ACCESS_KEY=my-access-key
SQS_SECRET_KEY=my-secret-key
SQS_REGION=us-east-1
```

In your application you can just call an empty constructor

``` js
var queue = sqs();
```

This is very useful if you dont want to hardcode your keys in the application.
