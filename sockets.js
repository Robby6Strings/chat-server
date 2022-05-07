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
            },
          })
        );
      }
    });
  }
}

function joinChannel(socket, id, doUpdate = true) {
  const userRecord = clients.get(socket.__clientId);
  if (userRecord.selectedChannelId == id) return;

  const chnl = channels.get(userRecord.selectedChannelId);
  if (chnl) {
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
  updateUserChannel(ws, newChannel.id);

  clients.forEach((client) => {
    sendChannelList(client.socket);
  });
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
    const { id, name } = channel;
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

module.exports = {
  onClientChannelAction,
  onClientMessage,
  addClient,
};
