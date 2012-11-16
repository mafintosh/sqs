# sqs

use the amazon simple queue service (sqs) with node

	npm install sqs

usage is simple

``` js
var sqs = require('sqs');

var queue = sqs({
	access:'my-aws-access-key',
	secret:'my-aws-secret-key'
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

	queue.pull(name, [workers], onmessage)

pull a message from the queue. when a message has arrived it is passed to `onmessage(message, callback)`.
when you are done with the message you call the callback and the message is deleted from the queue.
if the callback isn't called for some reason the message will be readded to the queue by amazon sqs.
