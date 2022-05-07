'use strict';

const express = require('express');
const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const wss = new Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(
    JSON.stringify({
      type: 'message',
      data: {
        user: {
          id: 1,
          name: 'Server',
        },
        message: {
          content: 'Welcome!',
          timestamp: new Date(),
        },
      },
    })
  );
  ws.on('close', () => console.log('Client disconnected'));
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
}, 1000);
