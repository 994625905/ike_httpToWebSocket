/**
 * create by ikejcwang on 2022.07.25.
 * 注：这只是一个测试的demo
 */
'use strict';
const http = require('http');
const nodeUtil = require('util');
const URL = require('url');
const net = require('net');
const settings = require('./settings').settings;
const configs = require('./settings').configs;
const connectTimeout = settings['connectTimeout'] ? settings['connectTimeout'] : 5000;  // 建立连接的超时设定
const connectKeepalive = settings['connectKeepalive'] ? settings['connectKeepalive'] : 60000;  // 连接后的keepalive超时设定
const socketTimeout = settings['socketTimeout'] ? settings['socketTimeout'] : 60000;  // socket的timeout，

httpServer();

/**
 * 启动入口
 */
function httpServer() {
    console.dir(settings)
    startHttpServer();
}

function startHttpServer() {
    let server = http.createServer();
    server.on('upgrade', listenUpgradeEvent);
    server.on('request', listenRequestEvent);
    server.on('close', () => {
        console.log('http Server has Stopped At:' + settings['bindPort'])
    });
    server.on('error', err => {
        console.log('http Server error:' + err.toString());
        setTimeout(() => {
            process.exit(1);
        }, 3000);
    });
    server.listen(settings['bindPort'], settings['bindIP'], settings['backlog'] || 8191, () => {
        console.log('Started Http Server At: ' + settings['bindIP'] + ':' + settings['bindPort']);
    });
}

/**
 * 监听upgrade事件
 * @param request
 * @param cliSocket
 * @param header
 * @returns {Promise<void>}
 */
async function listenUpgradeEvent(request, cliSocket, header) {
    let serverSocket = null;
    cliSocket.on('error', e => {
        if (serverSocket) {
            serverSocket.destroy();
        }
        logInfo('cliSocket has error', nodeUtil.inspect(e))
    });
    cliSocket.on('end', () => {
        logInfo('cliSocket has ended');
    });
    cliSocket.on('close', function () {
        logInfo('cliSocket has closed');
    });
    cliSocket.setTimeout(socketTimeout, () => {
        cliSocket.destroy(new Error('timeout'));
        if (serverSocket) {
            serverSocket.destroy();
        }
    })
    try {
        if (!configs || Object.keys(configs).length < 1) {
            cliSocket.end();
            return;
        }
        let sourceUrl = URL.parse(request.url, true);
        let pathArr = sourceUrl.pathname.split('/');
        if (pathArr.length === 1) {
            cliSocket.end();
            return;
        }
        let websocketName = pathArr[1];
        if (!websocketName || !configs[websocketName]) {
            cliSocket.end();
            return;
        }
        serverSocket = await connectSocket(configs[websocketName]);
        serverSocket.on('error', err => {
            cliSocket.end();
            logInfo('server socket error', nodeUtil.inspect(err));
        });
        cliSocket.on('data', chunk => {
            cliSocket.pause();  // 收到数据后，暂停当前cliSocket
            if (serverSocket.write(chunk)) {
                cliSocket.resume(); // server socket写成功后，在激活当前cliSocket
            }
        }).on('end', () => {
            console.log('end')
            serverSocket.end(); // 双写完处理
        });

        serverSocket.on('data', chunk => {
            serverSocket.pause();
            if (cliSocket.write(chunk)) {
                serverSocket.resume();
            } else {
                cliSocket.once('drain', () => serverSocket.resume());   // 如果调用 stream.write(chunk) 返回 false，则当可以继续写入数据到流时会触发 drain 事件
            }
        }).on('end', () => {
            cliSocket.end()
        });
        let connectHeaders = request.headers;
        connectHeaders['host'] = `${configs[websocketName].host}:${configs[websocketName].port}`;
        let headersTemp = '';
        for (let key in connectHeaders) {
            headersTemp += `${key}: ${connectHeaders[key]}\r\n`
        }
        serverSocket.write(`${request.method} ${request.url} HTTP/1.1\r\n${headersTemp}\r\n`); // 向真实的webSocket服务开始握手连接
        if (header && header.length > 0) {
            serverSocket.write(header)
        }
    } catch (e) {
        if (cliSocket.writable) {
            cliSocket.write(`HTTP/1.1 502 Server UnReachable\r\n\r\n`);
        }
        cliSocket.end();
        console.log(`request_error: ${nodeUtil.inspect(e)}`);
    }
}

/**
 * 监听request事件
 * @param request
 * @param response
 * @returns {Promise<void>}
 */
async function listenRequestEvent(request, response) {
    // 再次证实websocket握手时到不了这里，因为headers信息的connection字段为Upgrade，触发的是Upgrade事件
    console.log('listenRequestEvent')
}

/**
 * 连接socket
 * @param websocketConfig
 * @returns {Promise<unknown>}
 */
function connectSocket(websocketConfig) {
    return new Promise((resolve, reject) => {
        let socket = net.connect(websocketConfig);
        let timer = setTimeout(() => {
            socket.removeListener('error', onError)
            socket.destroy();
            reject(Object.assign(new Error('connect timeout'), websocketConfig))
        }, connectTimeout);

        let onConnect = () => {
            socket.setKeepAlive(true, connectKeepalive);
            socket.removeListener('error', onError)
            clearInterval(timer);

            // TODO 创建tcp连接时，默认都会启用Nagle算法，此处禁用它，(Nagle试图以延迟为代价来优化吞吐量，但是我们并不需要)，传参true或不传即禁用，
            socket.setNoDelay();
            socket.setTimeout(socketTimeout + 60000, () => {
                socket.destroy(new Error('socket server timeout'));
            })
            resolve(socket);
        }

        let onError = e => {
            clearInterval(timer);
            reject(e);
        }
        socket.once('connect', onConnect);
        socket.once('error', onError);
    });
}

function logInfo(...args) {
    console.dir(args)
}