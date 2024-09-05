const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: 'https://sl-health.vercel.app',
        methods: ['GET', 'POST']
    }
});

app.use(cors({
    origin: 'https://sl-health.vercel.app', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

let users = {};

io.on('connection', (socket) => {
    socket.emit('me', socket.id);

    socket.on('disconnect', () => {
        delete users[socket.id];  // Clean up on disconnect
        socket.broadcast.emit('callEnded');
    });

    socket.on('callUser', ({ userToCall, signalData, from, name }) => {
        users[userToCall] = socket.id;
        io.to(userToCall).emit('callUser', { signal: signalData, from, name });
    });

    socket.on('answerCall', (data) => {
        io.to(data.to).emit('callAccepted', data.signal);
    });

    socket.on('handMovement', ({ to, prediction }) => {
        io.to(to).emit('handMovement', prediction);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
