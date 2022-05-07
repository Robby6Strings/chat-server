'use strict';
const crypto = require('crypto');
const express = require('express');
const { Server } = require('ws');

const {
  onClientChannelAction,
  onClientMessage,
  addClient,
} = require('./sockets');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const wss = new Server({ server });
const clients = new Map();
const channels = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'auth':
        addClient(ws, msg.data);
        break;
      case 'message':
        onClientMessage(ws, msg.data);
        break;
      case 'channels':
        onClientChannelAction(ws, msg.data);
      default:
        break;
    }
  });

  ws.on('close', (socket) => {
    console.log('Client disconnected');
    channels.forEach((chnl) => {
      chnl.removeUser(socket.__clientId);
    });
    clients.delete(this.__clientId);
  });
});

setInterval(() => {
  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        type: 'ping',
        data: new Date().toTimeString(),
      })
    );
  });
}, 3000);
