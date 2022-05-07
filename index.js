'use strict';
const crypto = require('crypto');
const express = require('express');
const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const wss = new Server({ server });
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'auth':
        addClient(ws, msg.data);
        break;
      case 'message':
        onClientMessage();
      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(this.__clientId);
  });
});

function addClient(ws, user) {
  let { name, id } = user;
  if (!id) id = crypto.randomUUID();

  ws.__clientId = id;
  clients.set(id, {
    name,
    socket: ws,
  });
  sendAuthMessage(ws, id);
  sendWelcomeMessage(ws);
}
function sendAuthMessage(socket, userId) {
  socket.send(
    JSON.stringify({
      type: 'auth',
      data: userId,
    })
  );
}
function sendWelcomeMessage(socket) {
  const clientEntry = clients.get(socket.__clientId);

  socket.send(
    JSON.stringify({
      type: 'message',
      data: {
        user: {
          id: 1,
          name: 'Server',
        },
        message: {
          content: `Welcome ${clientEntry.name}!`,
          timestamp: new Date(),
        },
      },
    })
  );
}

setInterval(() => {
  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        type: 'ping',
        data: new Date().toTimeString(),
      })
    );
  });
}, 1000);
