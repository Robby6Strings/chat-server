'use strict';
const crypto = require('crypto');
const express = require('express');
const { Server } = require('ws');

const {
  onClientChannelAction,
  onClientMessage,
  addClient,
  clients,
  channels,
} = require('./sockets');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const wss = new Server({ server });

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
    console.log('Client disconnected', socket);
  });
});

setInterval(() => {
  const activeClientIdList = [];
  wss.clients.forEach((client) => {
    activeClientIdList.push(client.__clientId);

    client.send(
      JSON.stringify({
        type: 'ping',
        data: new Date().toTimeString(),
      })
    );
  });

  const deleteList = [];
  clients.forEach((client) => {
    if (activeClientIdList.indexOf(client.__clientId) > -1) return;
    channels.forEach((chnl) => {
      chnl.removeUser(client.__clientId);
    });
    deleteList.push(client.__clientId);
  });

  deleteList.forEach((id) => {
    clients.delete(id);
  });
}, 3000);
