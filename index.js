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

class Message {
  constructor(user, content) {
    this.id = crypto.randomUUID();
    this.user = user;
    this.message = {
      content,
      timestamp: new Date(),
    };
  }
}

class Channel {
  constructor(name) {
    this.name = name;
    this.id = crypto.randomUUID();
    this.users = [];
    this.messages = [];
  }

  addUser(id) {
    const index = this.users.indexOf(id);
    if (index != -1) return;

    this.users.push(id);
    channels.set(this.id, this);
  }
  removeUser(id) {
    console.log('removing user from group ' + this.id, id);
    const index = this.users.indexOf(id);
    if (index == -1) {
      console.log("couldn't find user index");
      return;
    }
    this.users.splice(index, 1);
    channels.set(this.id, this);
  }

  broadcast(msg) {
    this.messages.push(msg);
    channels.set(this.id, this);

    clients.forEach((client) => {
      if (!this.users.find((x) => x == client.__clientId)) return;
      client.send(
        JSON.stringify({
          type: 'new-channel-message',
          data: {
            user: {
              id: client.__clientId,
              name: client.name,
            },
            message: {
              content,
              timestamp: msg.timestamp,
            },
          },
        })
      );
    });
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

function joinChannel(socket, id, doUpdate = true) {
  channels.forEach((channel) => {
    channel.removeUser(socket.__clientId);

    if (channel.id == id) {
      channel.addUser(socket.__clientId);
      channels.set(id, channel);
    } else if (channel.users.length) {
      const userRecord = clients.get(socket.__clientId);
      channel.broadcast(
        new Message(
          { id: 1, name: 'Server' },
          `${userRecord.name} left the channel 😢`
        )
      );
    } else {
      channels.delete(channel.id);
    }
  });

  if (doUpdate) {
    updateUserChannel(socket, id);
  }
}

function sendChannelData(socket, channelId) {
  const { messages, users } = channels.get(channelId);
  socket.send(
    JSON.stringify({
      type: 'channel-data',
      data: {
        messages,
        users,
      },
    })
  );
}

function addChannel(ws, name) {
  let channelExists = false;
  channels.forEach((chnl) => {
    if (chnl.name == name) {
      channelExists = true;
    }
  });
  if (channelExists) return;

  const newChannel = new Channel(name);
  channels.set(newChannel.id, newChannel);
  joinChannel(ws, newChannel.id, false);
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

  socket.send(
    JSON.stringify({
      type: 'set-channel',
      data: channelId,
    })
  );
  sendChannelData(socket, channelId);
}

function sendChannelList(socket) {
  const data = [];
  channels.forEach((channel) => {
    const { id, name, messages } = channel;
    data.push({
      id,
      name,
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
  const { content, channel } = msg;
  const userRecord = clients.get(socket.__clientId);
  const { id, name } = userRecord;
  const chn = channels.get(channel);

  chn.broadcast(new Message({ id, name }, content));
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

  const channel = channels.get(selectedChannelId);
  if (channel) {
    socket.send(
      JSON.stringify({
        type: 'set-channel',
        data: selectedChannelId,
      })
    );

    channel.broadcast(
      new Message({ id: 1, name: 'Server' }, `${name} joined the channel 😁`)
    );
  }

  sendAuthMessage(socket, id);
}
function sendAuthMessage(socket, userId) {
  socket.send(
    JSON.stringify({
      type: 'auth',
      data: userId,
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
