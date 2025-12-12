const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000; // Render сам назначает порт
const SECRET_KEY = process.env.SECRET_KEY || "render-video-chat-secret-2024";
const DB_FILE = './users.json';

// Middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(bodyParser.json());

// Serve static files from public directory
app.use(express.static('public'));

// Простая база данных
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

const getUsers = () => {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.log('Creating new users database');
        return [];
    }
};

const saveUser = (users) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
};

// === PEERJS SERVER SETUP (ПЕРВЫМ ДЕЛОМ!) ===
console.log('🔧 Initializing PeerJS server...');

// Создаем PeerServer на том же HTTP сервере
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/peerjs',
    allow_discovery: true,
    proxied: true
});

// Подключаем PeerServer к Express
app.use('/peerjs', peerServer);

// Обработчики событий PeerJS
peerServer.on('connection', (client) => {
    console.log(`🔗 Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`🔌 Peer disconnected: ${client.getId()}`);
});

peerServer.on('error', (error) => {
    console.error('❌ PeerJS error:', error);
});

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email и пароль обязательны" });
        }

        const users = getUsers();

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ message: "Пользователь уже существует" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const peerId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        const newUser = {
            id: peerId,
            email,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUser(users);

        console.log(`✅ New user registered: ${email}`);
        res.json({
            success: true,
            message: "Пользователь создан",
            userId: peerId
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email и пароль обязательны" });
        }

        const users = getUsers();
        const user = users.find(u => u.email === email);

        if (!user) {
            console.log(`❌ Login failed: User ${email} not found`);
            return res.status(400).json({ message: "Неверный email или пароль" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log(`❌ Login failed: Wrong password for ${email}`);
            return res.status(400).json({ message: "Неверный email или пароль" });
        }

        const token = jwt.sign({
            id: user.id,
            email: user.email
        }, SECRET_KEY, { expiresIn: '24h' });

        console.log(`✅ User logged in: ${email}`);
        res.json({
            success: true,
            token,
            user: {
                email: user.email,
                id: user.id,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'video-chat-render',
        port: PORT,
        peerjs: 'active',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Get server info
app.get('/api/info', (req, res) => {
    const users = getUsers();
    res.json({
        usersCount: users.length,
        uptime: process.uptime(),
        peerjs: {
            enabled: true,
            path: '/peerjs'
        },
        api: {
            register: '/api/register',
            login: '/api/login',
            health: '/api/health'
        }
    });
});

// Test PeerJS endpoint
app.get('/api/test-peer', (req, res) => {
    res.json({
        peerjs: 'running',
        path: '/peerjs',
        note: 'Use WebSocket for real-time connections'
    });
});

// Serve index.html for all routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(PORT, () => {
    console.log('=================================');
    console.log('🚀 SERVER STARTED SUCCESSFULLY!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📡 PeerJS WebSocket: /peerjs`);
    console.log(`🔐 API: /api/*`);
    console.log(`🌐 Web: http://localhost:${PORT}`);
    console.log('=================================');
    console.log('✅ PeerJS integrated with Express');
    console.log('✅ No port conflicts');
    console.log('✅ Ready for WebRTC connections');
    console.log('=================================');
});

// Обработка ошибок сервера
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('Trying alternative port...');
        // Можно попробовать другой порт, но на Render это не нужно
    } else {
        console.error('❌ Server error:', error);
    }
});