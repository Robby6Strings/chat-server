const crypto = require('crypto');

class Message {
  constructor(user, content, targetUser) {
    this.id = crypto.randomUUID();
    this.user = user;
    this.targetUser = targetUser;
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

  addUser(userId) {
    console.log('adding user to' + this.id, userId, this.users);
    const channelUser = this.users.find((user) => user.id == userId);
    if (channelUser) {
      console.log('user found, not adding');
      return;
    }

    const userRecord = clients.get(userId);
    this.users.push({ id: userId, name: userRecord.name });
    channels.set(this.id, this);
    console.log('added user to' + this.id, userId, this.users);

    this.sendWelcomeMessage(userId, userRecord.name);
  }

  sendWelcomeMessage(userId, userName) {
    const oldServerMessages = this.messages.filter(
      (msg) => msg.targetUser == userId && msg.user.id == 1
    );
    console.log('oldServerMessages', oldServerMessages);
    if (!oldServerMessages.length) {
      console.log('sending channel welcome message', userName);
      this.broadcast(
        new Message(
          { id: 1, name: 'Server' },
          `${userName} has joined the channel 😁`,
          userId
        )
      );
    }
  }

  removeUser(userId) {
    console.log('removing user from group ' + this.id, userId, this.users);
    const channelUser = this.users.find((user) => user.id == userId);
    if (!channelUser) {
      console.log("couldn't find user index");
      return;
    }
    this.users.splice(this.users.indexOf(channelUser), 1);
    channels.set(this.id, this);
    if (!this.users.length) {
      this.beginAutomaticDestruction();
    }
  }

  broadcast(msg) {
    this.messages.push(msg);
    channels.set(this.id, this);
    console.log('broadcasting message to channel ' + this.id, msg);

    this.users.forEach(({ id }) => {
      const userRecord = clients.get(id);
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
            id: msg.id,
          },
        })
      );
    });
  }

  broadcastState() {
    console.log('channel ' + this.id + ' - broadcasting state');
    this.users.forEach(({ id }) => {
      const userRecord = clients.get(id);
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
    });
  }

  beginAutomaticDestruction() {
    console.log('beginning auto destruct of channel ' + this.id);
    this.destructionInterval = setInterval(this.deteriorate.bind(this), 1000);
    channels.set(this.id, this);
  }
  cancelAutomaticDestruction() {
    if (this.destructionInterval) {
      clearInterval(this.destructionInterval);
      this.destructionInterval = null;
    }
    this.life = 10;
    channels.set(this.id, this);
  }

  deteriorate() {
    this.life -= 1;
    clients.forEach((client) => {
      client.socket.send(
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
    clients.forEach((client) => {
      sendChannelList(client.socket);
    });
  }
}

function joinChannel(socket, channelId) {
  const userRecord = clients.get(socket.__clientId);

  if (userRecord.selectedChannelId != channelId) {
    const oldChannel = channels.get(userRecord.selectedChannelId);
    if (oldChannel) {
      oldChannel.removeUser(socket.__clientId);
    }
  }
  const channel = channels.get(channelId);
  if (!channel) {
    clearUserChannel(socket);
  } else {
    channel.addUser(socket.__clientId);
    updateUserChannel(socket, channelId);
    channel.cancelAutomaticDestruction();
    channel.broadcastState();
  }
}

function addChannel(socket, name) {
  const newChannel = new Channel(name, socket.__clientId);
  channels.set(newChannel.id, newChannel);
  joinChannel(socket, newChannel.id);

  clients.forEach((client) => {
    sendChannelList(client.socket);
  });
}

function deleteChannel(socket, id) {
  const channel = channels.get(id);
  if (!channel) return;
  if (channel.ownerId != socket.__clientId) return;

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
}

function clearUserChannel(socket) {
  const userRecord = clients.get(socket.__clientId);
  clients.set(socket.__clientId, {
    name: userRecord.name,
    selectedChannelId: null,
    socket,
  });
  socket.send(
    JSON.stringify({
      type: 'set-channel',
      data: null,
    })
  );
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
  const { content } = msg;
  const userRecord = clients.get(socket.__clientId);
  const { name, selectedChannelId } = userRecord;
  const chn = channels.get(selectedChannelId);
  console.log('onClientMessage', socket.__clientId, name);
  if (chn) {
    chn.broadcast(new Message({ id: socket.__clientId, name }, content));
  } else {
    clearUserChannel(socket);
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
  joinChannel(socket, selectedChannelId);
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
