const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Increase JSON / payload limits for image avatar transfers
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB payload limit for photo uploads
});

// Active online directory: socketId -> { id, name, avatar, locationTag, distance }
let onlineUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 1. User registers or updates profile (Photo / Name)
  socket.on('register_user', (data) => {
    onlineUsers[socket.id] = {
      id: socket.id,
      name: data.name || `User_${socket.id.substring(0, 4)}`,
      avatar: data.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`,
      distance: (Math.random() * 500 + 1).toFixed(1), // Supports 1 km to 500+ km
      locationTag: data.locationTag || 'Online'
    };
    // Broadcast active radar members to everyone
    io.emit('radar_sync', Object.values(onlineUsers));
  });

  // 2. Chat Request: Strictly private from sender to recipient
  socket.on('send_request', ({ targetId }) => {
    const sender = onlineUsers[socket.id];
    if (sender && targetId && onlineUsers[targetId]) {
      io.to(targetId).emit('incoming_request', {
        fromId: socket.id,
        fromName: sender.name,
        fromAvatar: sender.avatar,
        distance: sender.distance
      });
    }
  });

  // 3. Accept Request: Creates an isolated 1-to-1 private session
  socket.on('accept_request', ({ requesterId }) => {
    const acceptor = onlineUsers[socket.id];
    const requester = onlineUsers[requesterId];

    if (acceptor && requester) {
      // Room name unique to these 2 specific users
      const roomId = [socket.id, requesterId].sort().join('_');
      socket.join(roomId);
      const requesterSocket = io.sockets.sockets.get(requesterId);
      if (requesterSocket) requesterSocket.join(roomId);

      // Notify both participants privately
      io.to(requesterId).emit('session_established', {
        roomId: roomId,
        peerId: socket.id,
        peerName: acceptor.name,
        peerAvatar: acceptor.avatar
      });

      socket.emit('session_established', {
        roomId: roomId,
        peerId: requesterId,
        peerName: requester.name,
        peerAvatar: requester.avatar
      });
    }
  });

  // 4. Reject Request
  socket.on('reject_request', ({ requesterId }) => {
    const rejector = onlineUsers[socket.id];
    if (rejector) {
      io.to(requesterId).emit('request_declined', {
        peerName: rejector.name
      });
    }
  });

  // 5. Send message or sticker (Delivered strictly inside this private room)
  socket.on('send_chat_message', ({ roomId, targetId, type, content }) => {
    const sender = onlineUsers[socket.id];
    if (sender && targetId) {
      io.to(targetId).emit('receive_chat_message', {
        roomId: roomId,
        senderId: socket.id,
        senderName: sender.name,
        type: type,
        content: content,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 6. Live Typing Indicator
  socket.on('typing_status', ({ targetId, isTyping }) => {
    if (targetId) {
      io.to(targetId).emit('peer_typing', { isTyping: isTyping });
    }
  });

  // 7. Cleanup on Disconnect
  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('radar_sync', Object.values(onlineUsers));
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Stranger app listening at http://localhost:${PORT}`);
});

