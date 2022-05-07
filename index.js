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
const channels = new Map();

class Channel {
  constructor(name) {
    this.name = name;
    this.id = crypto.randomUUID();
    this.users = [];
  }

  addUser(id) {
    const index = this.users.indexOf(id);
    if (index != -1) return;

    this.users.push(id);
    channels.set(this.name, this);
  }
  removeUser(id) {
    console.log('removing user from group ' + this.id, id);
    const index = this.users.indexOf(id);
    if (index == -1) {
      console.log("couldn't find user index");
      return;
    }
    this.users.splice(index, 1);
    channels.set(this.name, this);
  }
}

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

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(this.__clientId);
  });
});

function onClientChannelAction(ws, msg) {
  console.log('onClientChannelAction', msg);
  switch (msg.action) {
    case 'add':
      addChannel(ws, msg.data);
      break;
    case 'get':
      sendChannelList(ws);
      break;
    case 'join':
      joinChannel(ws, msg.data);
      break;
    default:
      break;
  }
}

function joinChannel(socket, id) {
  channels.forEach((channel) => {
    channel.removeUser(socket.__clientId);
    console.log('removed from channel ' + channel.name, channel.users.length);

    if (channel.id == id) channel.addUser(socket.__clientId);
    if (!channel.users.length) {
      console.log('removing channel');
      channels.delete(name);
    }
  });

  updateUserChannel(socket, id);
}

function addChannel(ws, name) {
  if (channels.get(name)) return;
  const newChannel = new Channel(name);
  newChannel.addUser(ws.__clientId);
  channels.set(name, newChannel);
  sendChannelList(ws);

  updateUserChannel(ws, newChannel.id);
}

function updateUserChannel(socket, channelId) {
  const userRecord = clients.get(socket.__clientId);
  clients.set(socket.__clientId, {
    name: userRecord.name,
    selectedChannelId: channelId,
    socket,
  });
  socket.send('set-channel', channelId);
}

function sendChannelList(socket) {
  const data = [];
  channels.forEach((channel) => {
    data.push({
      id: channel.id,
      name: channel.name,
    });
  });
  socket.send(
    JSON.stringify({
      type: 'channels',
      data,
    })
  );
}

function onClientMessage(socket, msg) {
  const userRecord = clients.get(socket.__clientId);
  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        type: 'message',
        data: {
          user: {
            id: socket.__clientId,
            name: userRecord.name,
          },
          message: {
            content: msg.content,
            timestamp: new Date(),
          },
        },
      })
    );
  });
}

function addClient(socket, user) {
  let { name, id, selectedChannelId } = user;
  if (!id) id = crypto.randomUUID();

  socket.__clientId = id;
  clients.set(id, {
    name,
    selectedChannelId,
    socket,
  });
  sendAuthMessage(socket, id);
  sendWelcomeMessage(socket);
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

  wss.clients.forEach((client) => {
    if (client.__clientId == socket.__clientId) return;

    client.send(
      JSON.stringify({
        type: 'message',
        data: {
          user: {
            id: 1,
            name: 'Server',
          },
          message: {
            content: `${clientEntry.name} joined!`,
            timestamp: new Date(),
          },
        },
      })
    );
  });

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
