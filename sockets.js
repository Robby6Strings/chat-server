const crypto = require('crypto');

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
  constructor(name, ownerId) {
    this.name = name;
    this.id = crypto.randomUUID();
    this.users = [];
    this.messages = [];
    this.ownerId = ownerId;
    this.destructionInterval = null;
    this.life = 10;
  }

  static getInstance(id) {
    return channels.get(id);
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
    console.log('broadcasting message to channel ' + this.id, msg);

    this.users.forEach((id) => {
      const userRecord = clients.get(id);
      if (userRecord) {
        userRecord.socket.send(
          JSON.stringify({
            type: 'new-channel-message',
            data: {
              user: {
                id: msg.user.id,
                name: msg.user.name,
              },
              message: {
                content: msg.message.content,
                timestamp: msg.message.timestamp,
              },
            },
          })
        );
      } else {
        this.removeUser(id);
      }
    });
  }

  broadcastState() {
    console.log('channel ' + this.id + ' - broadcasting state');
    this.users.forEach((id) => {
      const userRecord = clients.get(id);
      if (userRecord) {
        sendChannelList(userRecord.socket);

        userRecord.socket.send(
          JSON.stringify({
            type: 'channel-data',
            data: {
              messages: this.messages,
              users: this.users,
              life: this.life,
            },
          })
        );
      }
    });
  }

  beginAutomaticDestruction() {
    console.log('beginning auto destruct of channel ' + this.id);
    this.destructionInterval = setInterval(this.deteriorate.bind(this), 1000);
  }
  cancelAutomaticDestruction() {
    this.life = 10;
    if (this.destructionInterval) {
      clearInterval(this.destructionInterval);
      this.destructionInterval = null;
    }
  }

  deteriorate() {
    console.log('deteriorating channel ' + this.id, this.life, this.users);
    this.life -= 1;
    this.users.forEach((id) => {
      const userRecord = clients.get(id);
      console.log('sending user update data', userRecord.name);
      userRecord.socket.send(
        JSON.stringify({
          type: 'channel-life-update',
          data: {
            id: this.id,
            life: this.life,
          },
        })
      );
    });
    if (this.life < 1) {
      this.destroy();
      console.log('channel destroyed');
    }
  }

  destroy() {
    clearInterval(this.destructionInterval);
    channels.delete(this.id);
    this.users.forEach((id) => {
      const userRecord = clients.get(id);
      if (userRecord) {
        sendChannelList(userRecord.socket);
      }
    });
  }
}

function joinChannel(socket, id, doUpdate = true) {
  const userRecord = clients.get(socket.__clientId);
  const oldChannel = channels.get(userRecord.selectedChannelId);
  if (oldChannel) {
    oldChannel.removeUser(socket.__clientId);
    if (!oldChannel.users.length) oldChannel.beginAutomaticDestruction();
  }

  const chnl = channels.get(id);
  if (chnl) {
    chnl.cancelAutomaticDestruction();
    chnl.addUser(socket.__clientId);
    chnl.broadcastState();
    chnl.broadcast(
      new Message(
        { id: 1, name: 'Server' },
        `${userRecord.name} joined the channel 😁`
      )
    );
  }

  if (doUpdate) {
    updateUserChannel(socket, id);
  }
}

function sendChannelData(socket, channelId) {
  const { messages, users, life } = channels.get(channelId);
  socket.send(
    JSON.stringify({
      type: 'channel-data',
      data: {
        messages,
        users,
        life,
      },
    })
  );
}

function addChannel(socket, name) {
  const newChannel = new Channel(name, socket.__clientId);
  channels.set(newChannel.id, newChannel);
  joinChannel(socket, newChannel.id, false);
  updateUserChannel(socket, newChannel.id);

  clients.forEach((client) => {
    sendChannelList(client.socket);
  });
}

function deleteChannel(socket, id) {
  const channel = channels.get(id);
  if (!channel) return;
  if (!channel.ownerId == socket.__clientId) return;

  channel.destroy();
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
    const { id, name, life } = channel;
    data.push({
      id,
      name,
      life,
    });
  });
  socket.send(
    JSON.stringify({
      type: 'channels',
      data,
    })
  );
}

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
    case 'delete':
      deleteChannel(ws, msg.data);
      break;
    default:
      break;
  }
}
function onClientMessage(socket, msg) {
  const { content, channel } = msg;
  const userRecord = clients.get(socket.__clientId);
  const { name } = userRecord;
  const chn = channels.get(channel);
  console.log('onClientMessage', socket.__clientId, name);
  if (chn) {
    chn.broadcast(new Message({ id: socket.__clientId, name }, content));
  }
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

  const channel = channels.get(selectedChannelId);
  if (channel) {
    socket.send(
      JSON.stringify({
        type: 'set-channel',
        data: selectedChannelId,
      })
    );
    joinChannel(socket, selectedChannelId);
  }
}
function sendAuthMessage(socket, userId) {
  socket.send(
    JSON.stringify({
      type: 'auth',
      data: userId,
    })
  );
}

const clients = new Map();
const channels = new Map();

module.exports = {
  onClientChannelAction,
  onClientMessage,
  addClient,
  clients,
  channels,
};
