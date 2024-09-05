const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: 'http://localhost:5000/',
        methods: ['GET', 'POST']
    }
});


app.use(cors({
    origin: 'http://localhost:5000/', // Your frontend domain
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

let users = {};

io.on('connection', (socket) => {
    socket.emit('me', socket.id);

    socket.on('disconnect', () => {
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

server.listen(5000, () => console.log('Server is running on port 5000'));
