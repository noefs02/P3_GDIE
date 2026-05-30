const express = require('express');

const app = express();
const port = process.env.PORT || 80;

// Servir carpeta public
app.use(express.static('public'));

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servidor de Señalización WebRTC (Malla Multi-usuario)
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('join', (data) => {
    socket.join(data.room);
    console.log(`Usuario ${socket.id} (${data.name}) se unió a la sala: ${data.room}`);
    socket.to(data.room).emit('user-joined', { id: socket.id, name: data.name, color: data.color });
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      name: data.name,
      color: data.color
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('leave-room', (data) => {
    if (data && data.room) {
      // 1. Notificar primero a los demás en la sala
      socket.to(data.room).emit('user-left-room', socket.id);
      // 2. Salir físicamente de la sala
      socket.leave(data.room);
      console.log(`Usuario ${socket.id} abandonó la sala: ${data.room}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    io.emit('user-disconnected', socket.id);
  });
});

server.listen(port, () => {
  console.log(`Servidor HTTP y WebSockets escuchando en el puerto ${port}`);
});