const express = require('express')
const server = require('http').createServer();
const app = express();

app.get('/', function(req, res) {
  res.sendFile('index.html', {root: __dirname});
});

server.on('request', app);
server.listen(3000, function() {console.log('server running on port 3000')});


/** start websocket **/

const WebSocketServer = require('ws').Server;

const wss = new WebSocketServer({ server: server});

wss.on('connection', function connection(ws) {
  const numclients = wss.clients.size;

  console.log(numclients, 'clients connected')

  wss.broadcast('current visitors ', numclients);

  if (ws.readyState == ws.OPEN) {
    ws.send("welcome to my server")
  }

  ws.on('close', function close() {
    console.log('client disconnect');
  })

})
wss.broadcast = function broadcast(data) {
  wss.clients.forEach(client => {
    client.send(data)
  })
}
