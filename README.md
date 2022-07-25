标题：用一个httpServer来代理WebSocket通信

引言：即使是即时通迅，也可以用http网关来代理转发，并且采集数据信息……

# 1、简介

## 1.1、通信方式

1. 单工：数据只支持在一个方向传输，即单向，在同一时间内只有一方能够接受&发送信息；
2. 半双工：允许数据能够双向传输，但是，在某一时刻只允许数据在一个方向传输。类似切换方向的单工通信。http就是半双工通信，先有请求，再有响应；
3. 全双工：允许数据同时都能双向传输，类似两个单工通信的结合，要求client & server都有独立接收和发送的能力，在任意时刻都能接收&发送信息，socket就是全双工通信；

## 1.2、websocket

websocket本质是一种网络应用层协议，建立在单个TCP连接上的全双工模式，用来弥补了http协议在持续双向通信能力上的不足，允许服务端与客户端之间可以双向主动推送数据。

特点：

1. 与http协议有着良好的兼容性，默认端口80（协议标识为ws）或者443（加密传输，协议标识为wss）；
2. 建立连接的握手阶段采用的是http协议，根据这个特性，可以在链路中间引入http代理服务器；
3. 数据格式轻量，性能开销小，通信效率高（只要建立连接后，就可以无限收发报文）；
4. 报文内容可以是文本，也可以是二进制数据；
5. 没有同源的约束，不存在跨域一说，客户端可以与任意服务器通信（前提是服务器能应答）；
6. 对外暴露的URL为：`ws://${domain}:80/${path}`，或者`wss://${domain}:443/${path}`

# 2、搭建demo

## 2.1、server

采用ws库快速构建一个websocket server，监听connection事件，收到消息并且打印后，立马发送给客户端

```javascript
const ws = require('ws');

let wsServer = new ws.Server({
    port: 3000,
    host:'127.0.0.1',
    path:'/websocket'
});

wsServer.on('connection', function (server) {

    console.log('client connected');

    server.on('message', function (message) {
        console.dir(message)
        console.log(message.toString());
        server.send(`hello:${message}`)
    });
});
```

## 2.2、client

快速搭建一个websocket client，利用http-server在目录下启动，并且访问该页面

```html
<!DOCTYPE html>
    <html>
    <head>
        <title>websocket demo</title>
    </head>
    <body>
        <h1></h1>
        <br>
        <input type='text' id='sendText'>
        <button onclick='send()'>send</button>
    </body>
</html>
<script>
    const ws = new WebSocket('ws://127.0.0.1:3000/websocket')
    ws.onopen = function () {
        console.log('服务器连接')
    }
    ws.onmessage = (msg) => {
        console.log('来自服务器发来的数据：', msg)
        alert('服务器返回内容：' + msg.data)
    }

    ws.onclose = () => {
        console.log('服务器关闭')
    }

    function send() {
        if (ws) {
            let msg = document.getElementById('sendText').value;
            ws.send(msg)
        } else {
            alert('websocket server error')
        }
    }
</script>
```

## 2.3、建立连接

先启动websocket server，然后浏览器请求websocket client页面，抓包请求如下：

![image-20220722172017601](/Users/wangjinchao/Library/Application Support/typora-user-images/image-20220722172017601.png)

### 2.3.1、tcp的三次握手

前三条为tcp的三次握手信息，既然谈到了，为了文章的完整性，还是简单描述一下；

1. client发送连接请求，设置SYN=1，随机一个初始序列号Seq（数据包SYN = 1，seq = x），然后自己进入SYN_SEND状态（同步已发送），等待server确认；
2. server收到SYN包后，也随机一个Seq为y，并且让ack = x + 1，表示收到了client的连接请求，然后设置SYN = 1,ACK = 1，返回给client（数据包SYN = 1, ACK = 1, seq = y, ack = x + 1），表示SYN握手通过，等待ACK应答，然后自己进入SYN_RCVD状态（同步已接收）；
3. client收到[SYN, ACK]包后，将ACK置1，让ack = y +1, 表示收到了server的确认请求，最后发送确认给server（数据包ACK = 1, ack = y + 1），然后自己进入ESTABLISHED状态（连接已建立），server收到client的确认后也进入ESTABLISHED状态；

三次握手必要性：

1. 同步双方的初始序列号，避免重复连接，必须三次，四次也行，但是开销太大影响效率；
2. 序列号是可靠传输的关键性，可以去除重复数据，根据数据包的序号来接收；

SYN（连接请求）的攻击危害：

> 攻击方发送海量伪造源IP的第一次握手SYN包，将服务器的半连接队列给打满（超过最大值），正常的客户发送SYN数据包请求连接就会被服务器丢弃，导致正常的连接请求无法成功，严重引起网络堵塞甚至系统瘫痪

规避方式：

> 限制ip连接次数（限制同一IP一分钟内新建立的连接数仅为10）；增大半连接状态的连接数容量（会增大内存资源占用，/etc/sysctl.d/sysctl.conf ，字段tcp_max_syn_backlog）

### 2.3.2、TCP window update

server的接收窗口大小发生了变化，可以正常接收数据了，就会出现这一条记录

### 2.3.3、正式连接

抓包分析看出，websocket通信在双方TCP三次握手成功后，还需要发送一次额外的http请求，才能正式建立连接。http请求报文如下：

```
GET /websocket HTTP/1.1
Host: 127.0.0.1:3000
Connection: Upgrade
Pragma: no-cache
Cache-Control: no-cache
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36
Upgrade: websocket
Origin: http://127.0.0.1:8080
Sec-WebSocket-Version: 13
Accept-Encoding: gzip, deflate, br
Accept-Language: en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7
Sec-WebSocket-Key: Ap4ZCLgwbnDQ2ump+7ea3g==
Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: Ih1TB0gxAY3zGzvQCYrIeM5bEdw=
```

**请求headers的限定：**

1. 请求方式必须是GET，且http版本必须为1.1（keep-alive。因为1.0开启长连接需要Connection字段设置，然而websocket握手时，Connection已经被占用了）；
2. Host，Origin字段必填：决定访问哪个虚拟主机，请求来源站点（仅仅协议域名端口，没有任何path）（默认会带上它俩）；
3. Connection字段必填，且字段为Upgrade（触发http协议升级）；
4. Upgrade字段必填，表明协议升级为web socket；
5. Sec-WebSocket-Key字段必填，内容为客户端标识的base64编码格式；
6. Sec-WebSocket-Version字段必填，表明websocket协议版本， [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455) 的协议版本为 13；
7. Sec-WebSocket-Extensions字段可选，做客户端握手时的拓展项使用；

**响应header分析：**

- 只有状态码为101，才表示服务端同意了协议升级，对于其他状态码，client会根据语义相应处理；

- client会检测响应headers中是否包含Upgrade字段，且检测值是否为websokcet（不区分大小写），若缺失或不匹配，会自动终止连接；

- client会检测响应headers中是否包含Sec-WebSocket-Protocol字段，并校验它的合理性，若缺失或校验失败，会在自动终止连接；

- > Sec-WebSocket-Protocol校验算法（client & server的约定）：server收到Sec-WebSocket-Key后，会将其与websocket魔数258EAFA5-E914-47DA- 95CA-C5AB0DC85B11进行字符串拼接，即${Sec-WebSocket-Key}258EAFA5-E914-47DA- 95CA-C5AB0DC85B11，然后对它做SHA1哈希运算后再做一次base64编码，就为Sec-WebSocket-Protocol。

握手通过后，双方就是长连接了，可以随时进行双向数据的传输。

# 3、http代理

由上文可知，除去tcp三次握手外，websocket真实的建立连接是那次关键的http请求，那其实可以针对它来做一层http网关来代理后续的数据传输了。

## 3.1、创建http Server

先描述config.json文件：

json格式，`websocketTestOne` key代表一个webSocket，根下文协议升级请求的path相呼应，即一个该配置对应的代理请求地址应该为：`http://{domain}/websocketTestOne`，添加多个配置，依次类推

```json
{
  "websocketTestOne": {
    "host": "127.0.0.1",
    "port": "3000"
  }
}
```

httpServer.js，如下所示，代码量不多，简单介绍一下流程：

1. 加载配置文件，开启一个http server，并监听upgrade事件；
2. 如果有协议升级的请求过来后，会触发`upgrade`，而不是`request`，upgrade事件中，针对clientSocket一系列监听的预处理；
3. 如果config.json没有值，结束clientSocket，如果`request.url`解析出来的path在config中找不到，结束clientSocket；
4. 找到对应的config，建立socket连接（连接真实的webSocket服务），创建出serverSocket，并进行一系列预处理设置；
5. clientSocket监听`data`事件，将报文写入serverSocket，serverSocket监听`data`事件，将报文写入clientSocket，交替进行；
6. 组装握手连接的http报文，serverSocket开始正式向webSocket服务握手连接，并触发前面的双向`data`监听事件；
7. 握手成功，传递的clientSocket，表示也握手成功，连接建立，可以双向收发报文了……

```js
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
```

## 3.2、创建webSocket Server

webSocketServer.js，比较简单，使用ws模块快速构建；

连接建立，输出信息，收到报文，输出报文，并添加前缀原路发出去；

```js
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
```

## 3.3、创建webSocket Client

websocketClient.html

```html
<!DOCTYPE html>
<html>
<head>
    <title>websocket demo</title>
</head>
<body>
<h1></h1>
<br>
<input type='text' id='sendText'>
<button onclick='send()'>send</button>
</body>
</html>
<script>
    const ws = new WebSocket('ws://127.0.0.1:8000/websocketTestOne') // httpServer代理的地址
    ws.onopen = function () {
        console.log('服务器连接')
    }
    ws.onmessage = (msg) => {
        console.log('来自服务器发来的数据：', msg)
        alert('服务器返回内容：' + msg.data)
    }
    ws.onerror = (err) =>{
        console.log(err)
    }

    ws.onclose = () => {
        console.log('服务器关闭')
    }

    function send() {
        if (ws) {
            let msg = document.getElementById('sendText').value;
            console.dir(ws)
            ws.send(msg)
        } else {
            alert('websocket server error')
        }
    }
</script>
```

## 3.4、测试

1、当前目录启动http-server，然后访问 http://127.0.0.1:8080/websocketClient.html；

2、会看到握手信息成功，然后输入框随机输入内容，会看到发送成功，也会收到服务端发来的报文；

# 4、总结

该http代理，可以通过url，path统一管理所有的webSocket服务，且可以在http server上的`upgrade`事件中做很多操作，类似黑白名单，添加鉴权，中途编辑报文信息……
