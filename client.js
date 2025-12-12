// ==========================================
// НАСТРОЙКИ (СЮДА ВСТАВИТЬ АДРЕС СЕРВЕРА)
// ==========================================
// Если тестируете локально: 'http://localhost:9000'
// Если залили на Render: 'https://имя-проекта.onrender.com'
const SERVER_URL = 'https://89.139.21.203:9000';

// Для PeerJS нам нужно разделить URL на части
// Если SERVER_URL = https://myapp.onrender.com
// HOST = myapp.onrender.com
// PORT = 443 (для https) или 80 (для http)
// SECURE = true
const PEER_HOST = '89.139.21.203';
const PEER_PORT = 9000;
const PEER_SECURE = false;

// ==========================================

let token = localStorage.getItem('auth_token');
let currentUser = null;
let peer = null;
let currentCall = null;
let localStream = null;

// Элементы UI
const authOverlay = document.getElementById('auth-overlay');
const mainApp = document.getElementById('main-app');
const videoUi = document.getElementById('video-ui');
const idleState = document.getElementById('idle-state');
const errorMsg = document.getElementById('error-msg');

// Проверка токена при старте
if (token) {
    const savedEmail = localStorage.getItem('user_email');
    const savedId = localStorage.getItem('user_id');
    if (savedEmail && savedId) {
        showApp({ email: savedEmail, id: savedId });
    }
}

// === АВТОРИЗАЦИЯ ===

async function auth(type) {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const endpoint = type === 'register' ? '/register' : '/login';

    if (!email || !password) {
        errorMsg.textContent = "Заполните все поля";
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.message || 'Ошибка сервера');

        if (type === 'login') {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('user_email', data.user.email);
            localStorage.setItem('user_id', data.user.id);
            showApp(data.user);
        } else {
            alert('Регистрация успешна! Теперь войдите.');
            auth('login'); // Авто-вход после регистрации можно добавить тут
        }

    } catch (e) {
        errorMsg.textContent = e.message;
    }
}

function showApp(user) {
    currentUser = user;
    authOverlay.classList.add('hidden');
    mainApp.classList.remove('hidden');
    document.getElementById('my-email-display').textContent = user.email;

    initPeer(user.id);
}

window.logout = () => {
    localStorage.clear();
    location.reload();
};

// === WEBRTC ЛОГИКА ===

function initPeer(userId) {
    // Подключаемся к НАШЕМУ Node.js серверу
    peer = new Peer(userId, {
        host: PEER_HOST,
        port: PEER_PORT,
        path: '/peerjs', // Путь, который мы задали в server.js
        secure: PEER_SECURE,
        debug: 2
    });

    peer.on('open', (id) => {
        document.getElementById('my-id').value = id;
    });

    peer.on('call', async (call) => {
        // Входящий звонок
        const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        startVideoSession(stream);
        call.answer(stream);
        handleCall(call);
    });

    peer.on('error', (err) => {
        console.error(err);
        if(err.type === 'peer-unavailable') alert("Пользователь не в сети");
    });
}

window.startCall = async () => {
    const remoteId = document.getElementById('remote-id').value;
    if (!remoteId) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        startVideoSession(stream);
        const call = peer.call(remoteId, stream);
        handleCall(call);
    } catch (e) {
        alert("Ошибка доступа к камере");
    }
};

function handleCall(call) {
    currentCall = call;
    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
    });
    call.on('close', endCall);
}

function startVideoSession(stream) {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
    idleState.classList.add('hidden');
    videoUi.classList.remove('hidden');
}

window.endCall = () => {
    if (currentCall) currentCall.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());

    videoUi.classList.add('hidden');
    idleState.classList.remove('hidden');
};

window.copyId = () => {
    navigator.clipboard.writeText(document.getElementById('my-id').value);
};