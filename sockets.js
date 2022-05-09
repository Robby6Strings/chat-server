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
    this.password = '';
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

  onUserNameUpdate(id, name) {
    let changeApplied = false;
    // user meta
    const userMatch = this.users.find((user) => user.id == id);
    if (userMatch) {
      userMatch.name = name;
      changeApplied = true;
    }

    // user messages
    const userMessages = this.messages.filter((msg) => {
      return msg.user.id == id;
    });
    if (userMessages.length) {
      userMessages.forEach((msg) => {
        msg.user.name = name;
      });
      changeApplied = true;
    }

    //user-referenced servcer messages
    const userServerMessages = this.messages.filter((msg) => {
      return msg.user.id == 1 && msg.targetUser == id;
    });
    if (userServerMessages.length) {
      const userRecord = clients.get(id);
      userServerMessages.forEach((msg) => {
        msg.message.content = msg.message.content.replaceAll(
          userRecord.name,
          name
        );
      });
      changeApplied = true;
    }

    if (changeApplied) {
      channels.set(this.id, this);
      this.broadcastState();
    }
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

    clients.forEach((client) => {
      sendChannelList(client.socket);
    });
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
    this.users.forEach(({ id }) => {
      const userRecord = clients.get(id);
      clearUserChannel(userRecord.socket);
    });

    clearInterval(this.destructionInterval);
    channels.delete(this.id);
    clients.forEach((client) => {
      sendChannelList(client.socket);
    });
  }
  update(name, password) {
    this.name = name;
    this.password = password;
    channels.set(this.id, this);
    clients.forEach((client) => {
      sendChannelList(client.socket);
    });
  }
  confirmPassword(socket) {
    socket.send(
      JSON.stringify({
        type: 'channel-password-prompt',
        data: this.id,
        error: null,
      })
    );
  }
  validatePassword(password) {
    return this.password == password;
  }
  badPassword(socket) {
    socket.send(
      JSON.stringify({
        type: 'channel-password-prompt',
        data: this.name,
        error: 'incorrect password',
      })
    );
  }
}

function joinChannel(socket, channelId, password) {
  const userRecord = clients.get(socket.__clientId);
  const oldChannelId = userRecord.selectedChannelId;
  const channel = channels.get(channelId);

  if (!channel) {
    return clearUserChannel(socket);
  } else {
    console.log(
      'joining channel',
      channel.password,
      password,
      channel.ownerId,
      socket.__clientId
    );
    if (channel.password && channel.ownerId != socket.__clientId) {
      if (!password) {
        console.log(
          'tried to join password-protected channel without password'
        );
        return channel.confirmPassword(socket);
      }
      if (!channel.validatePassword(password)) {
        console.log(
          'tried to join password-protected channel with incorrect password'
        );
        return channel.badPassword(socket);
      }
    }

    channel.addUser(socket.__clientId);
    updateUserChannel(socket, channelId);
    channel.cancelAutomaticDestruction();
    channel.broadcastState();
  }

  if (oldChannelId != channelId) {
    const oldChannel = channels.get(oldChannelId);
    if (oldChannel) {
      oldChannel.removeUser(socket.__clientId);
      oldChannel.broadcastState();
    }
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

function updateChannel(socket, data) {
  const { id, name, password, expirey } = data;
  const channel = channels.get(id);
  if (!channel) return;
  if (channel.ownerId != socket.__clientId) return;

  channel.update(name, password);
  socket.send(
    JSON.stringify({
      type: 'channel-saved',
      data: 200,
    })
  );
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
    const { id, name, life, ownerId } = channel;
    data.push({
      id,
      name,
      life,
      ownerId,
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
      joinChannel(ws, msg.data, msg.password);
      break;
    case 'delete':
      deleteChannel(ws, msg.data);
      break;
    case 'update':
      updateChannel(ws, msg.data);
      break;
    default:
      break;
  }
}

function onClientUserAction(ws, msg) {
  switch (msg.action) {
    case 'update':
      updateUser(ws, msg.data);
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

function updateUser(socket, name) {
  const userRecord = clients.get(socket.__clientId);
  console.log('updateUser', socket.__clientId);
  userRecord.name = name;
  clients.set(socket.__clientId, userRecord);

  socket.send(
    JSON.stringify({
      type: 'user',
      action: 'update',
      data: name,
    })
  );

  channels.forEach((channel) => {
    channel.onUserNameUpdate(socket.__clientId, name);
  });
}

function addClient(socket, user) {
  let { name, id } = user;

  socket.__clientId = id || crypto.randomUUID();
  clients.set(socket.__clientId, {
    name,
    selectedChannelId: null,
    socket,
  });

  sendAuthMessage(socket, socket.__clientId);
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
  onClientUserAction,
  onClientMessage,
  addClient,
  clients,
  channels,
};
