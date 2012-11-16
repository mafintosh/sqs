# sqs

use the amazon simple queue service (sqs) with node

	npm install sqs

usage is simple

``` js
var sqs = require('sqs');

var queue = sqs({
	access:'my-aws-access-key',
	secret:'my-aws-secret-key',
	region:'us-east-1' // defaults to us-east-1
});

// push some data to the test queue
queue.push('test', {some:'data'});

// pull some data from the test queue
queue.pull('test', function(message, callback) {
	console.log('someone pushed', message, 'to the queue');
	callback();
});
```

## methods

	queue.push(name, message)

push a new message to the queue defined by name.

	queue.pull(name, [workers=1], onmessage)

pull a message from the queue.

when a message has arrived it is passed to `onmessage(message, callback)`.
after you have processed the message call `callback` and the message is deleted from the queue.
if for some reason the callback is not called amazon sqs will re-add the message to the queue.

## env config

you can use env variables to configure `sqs` as well

```
SQS_ACCESS_KEY=my-access-key
SQS_SECRET_KEY=my-secret-key
SQS_REGION=us-east-1
```

then in your application you can just call an empty constructor

``` js
var queue = sqs();
```