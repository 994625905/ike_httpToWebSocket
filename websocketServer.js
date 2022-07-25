const ws = require('ws');

let wsServer = new ws.Server({
    port: 3000,
    host:'127.0.0.1',
});

wsServer.on('connection', function (server) {

    console.log('client connected');

    server.on('message', function (message) {
        console.dir(message)
        console.log(message.toString());
        server.send(`hello:${message}`)
    });
});