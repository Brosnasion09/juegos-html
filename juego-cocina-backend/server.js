const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    path: '/socket.io' // Ruta explícita para WebSocket
});

const PORT = process.env.PORT || 3000;

// Mapa para almacenar salas
const rooms = new Map();

// Generar código aleatorio de 6 caracteres
function generateRoomCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

// Generar orden aleatorio de ingredientes
function generateRandomOrder() {
    const ingredients = ['queso', 'tomate', 'pepperoni'];
    for (let i = ingredients.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ingredients[i], ingredients[j]] = [ingredients[j], ingredients[i]];
    }
    return ingredients;
}

io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado:', socket.id);

    socket.on('createRoom', () => {
        let roomCode;
        let attempts = 0;
        const maxAttempts = 10;
        do {
            roomCode = generateRoomCode();
            attempts++;
            if (attempts >= maxAttempts) {
                console.error('No se pudo generar un código único');
                socket.emit('error', { message: 'No se pudo generar un código único' });
                return;
            }
        } while (rooms.has(roomCode));

        const gameState = {
            teamScore: 0,
            level: 1,
            teamIngredients: [],
            ingredientOrder: [],
            isCooking: false,
            cookingStartTime: null,
            tables: [
                {
                    x: 80, y: 280, width: 80, height: 80,
                    hasCustomer: true, customerTimer: Date.now(),
                    order: generateRandomOrder()
                },
                {
                    x: 280, y: 280, width: 80, height: 80,
                    hasCustomer: true, customerTimer: Date.now(),
                    order: generateRandomOrder()
                }
            ]
        };

        rooms.set(roomCode, {
            players: [{ id: socket.id, playerId: 0 }],
            gameState
        });

        socket.join(roomCode);
        console.log('Código generado y enviado:', roomCode);
        socket.emit('roomCreated', { roomCode });
        socket.emit('assignPlayer', {
            playerId: 0,
            players: [
                { x: 150, y: 150, speed: 4, carryingPizza: false, pizzaOrder: null },
                { x: 200, y: 150, speed: 4, carryingPizza: false, pizzaOrder: null }
            ],
            gameState
        });
    });

    socket.on('joinRoom', (data) => {
        const { roomCode } = data;
        console.log('Intento de unirse a sala:', roomCode);
        if (!rooms.has(roomCode)) {
            console.log('Código inválido:', roomCode);
            socket.emit('invalidCode');
            return;
        }
        const room = rooms.get(roomCode);
        if (room.players.length >= 2) {
            console.log('Sala llena:', roomCode);
            socket.emit('roomFull');
            return;
        }
        room.players.push({ id: socket.id, playerId: 1 });
        socket.join(roomCode);
        socket.emit('assignPlayer', {
            playerId: 1,
            players: [
                { x: 150, y: 150, speed: 4, carryingPizza: false, pizzaOrder: null },
                { x: 200, y: 150, speed: 4, carryingPizza: false, pizzaOrder: null }
            ],
            gameState: room.gameState
        });
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('startGame');
    });

    socket.on('cancelRoom', () => {
        for (const [roomCode, room] of rooms) {
            if (room.players.some(p => p.id === socket.id)) {
                console.log('Sala cancelada:', roomCode);
                rooms.delete(roomCode);
                io.to(roomCode).emit('roomClosed');
                break;
            }
        }
    });

    socket.on('keyPress', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            io.to(roomCode).emit('keyPress', data);
        }
    });

    socket.on('updatePosition', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            io.to(roomCode).emit('updatePosition', data);
        }
    });

    socket.on('ingredientPicked', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.teamIngredients.push(data.ingredient);
            room.gameState.ingredientOrder = data.order;
            io.to(roomCode).emit('ingredientPicked', {
                ingredient: data.ingredient,
                teamIngredients: room.gameState.teamIngredients,
                ingredientOrder: room.gameState.ingredientOrder
            });
        }
    });

    socket.on('startCooking', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.isCooking = true;
            room.gameState.cookingStartTime = data.startTime;
            io.to(roomCode).emit('startCooking', { startTime: data.startTime });
        }
    });

    socket.on('pizzaCompleted', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.isCooking = false;
            room.gameState.cookingStartTime = null;
            room.gameState.teamIngredients = [];
            room.gameState.ingredientOrder = [];
            io.to(roomCode).emit('pizzaCompleted', data);
        }
    });

    socket.on('pizzaDiscarded', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            io.to(roomCode).emit('pizzaDiscarded', data);
        }
    });

    socket.on('pizzaDelivered', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.teamScore = data.score;
            room.gameState.tables[data.tableIndex].hasCustomer = false;
            io.to(roomCode).emit('pizzaDelivered', data);
        }
    });

    socket.on('newCustomer', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.tables[data.tableIndex].hasCustomer = true;
            room.gameState.tables[data.tableIndex].customerTimer = data.customerTimer;
            room.gameState.tables[data.tableIndex].order = data.order;
            io.to(roomCode).emit('newCustomer', data);
        }
    });

    socket.on('levelUp', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState.level = data.level;
            if (data.newTable) {
                room.gameState.tables.push(data.newTable);
            }
            io.to(roomCode).emit('levelUp', data);
        }
    });

    socket.on('gameWon', (data) => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            io.to(roomCode).emit('gameWon', data);
        }
    });

    socket.on('resetGame', () => {
        const roomCode = getRoomCode(socket.id);
        if (roomCode) {
            const room = rooms.get(roomCode);
            room.gameState = {
                teamScore: 0,
                level: 1,
                teamIngredients: [],
                ingredientOrder: [],
                isCooking: false,
                cookingStartTime: null,
                tables: [
                    {
                        x: 80, y: 280, width: 80, height: 80,
                        hasCustomer: true, customerTimer: Date.now(),
                        order: generateRandomOrder()
                    },
                    {
                        x: 280, y: 280, width: 80, height: 80,
                        hasCustomer: true, customerTimer: Date.now(),
                        order: generateRandomOrder()
                    }
                ]
            };
            io.to(roomCode).emit('resetGame');
        }
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
        for (const [roomCode, room] of rooms) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                if (room.players.length === 0) {
                    rooms.delete(roomCode);
                } else {
                    io.to(roomCode).emit('updatePlayers', room.players);
                    io.to(roomCode).emit('playerLeft');
                }
                break;
            }
        }
    });

    function getRoomCode(socketId) {
        for (const [roomCode, room] of rooms) {
            if (room.players.some(p => p.id === socketId)) {
                return roomCode;
            }
        }
        return null;
    }
});

// Manejo de tiempos por sala
setInterval(() => {
    for (const [roomCode, room] of rooms) {
        if (room.gameState.isCooking && room.gameState.cookingStartTime) {
            const elapsed = Date.now() - room.gameState.cookingStartTime;
            if (elapsed >= 10000) {
                room.gameState.isCooking = false;
                room.gameState.cookingStartTime = null;
                room.gameState.teamIngredients = [];
                room.gameState.ingredientOrder = [];
                room.gameState.teamScore -= 5;
                io.to(roomCode).emit('pizzaBurned', { score: room.gameState.teamScore });
            }
        }
        room.gameState.tables.forEach((table, index) => {
            if (table.hasCustomer && Date.now() - table.customerTimer > 60000) {
                table.hasCustomer = false;
                room.gameState.teamScore -= 5;
                io.to(roomCode).emit('customerLeft', { tableIndex: index, score: room.gameState.teamScore });
                setTimeout(() => {
                    table.hasCustomer = true;
                    table.customerTimer = Date.now();
                    table.order = generateRandomOrder();
                    io.to(roomCode).emit('newCustomer', { tableIndex: index, customerTimer: table.customerTimer, order: table.order });
                }, 2000);
            }
        });
    }
}, 1000);

// Ruta para Vercel
app.get('/', (req, res) => {
    res.send('Servidor de Juego Cocina corriendo');
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});