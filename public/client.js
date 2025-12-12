// Автоопределение URL для Render
const SERVER_URL = window.location.origin;
const IS_RENDER = SERVER_URL.includes('render.com') || SERVER_URL.includes('onrender.com');

console.log('🌐 Server URL:', SERVER_URL);
console.log('🔍 Is Render:', IS_RENDER);

// Проверяем, что мы на правильном URL
console.log('📄 Current path:', window.location.pathname);

// Дебаг информация
console.log('🔄 Full URL:', window.location.href);

// Настройки PeerJS для ExpressPeerServer
const PEER_CONFIG = {
    host: window.location.hostname,
    port: window.location.port || (window.location.protocol === 'https:' ? 443 : 80),
    path: '/peerjs',
    secure: window.location.protocol === 'https:',
    debug: 2,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    }
};

console.log('⚙️ PeerJS Config:', PEER_CONFIG);

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
    const endpoint = type === 'register' ? '/api/register' : '/api/login';

    if (!email || !password) {
        errorMsg.textContent = "Заполните все поля";
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Ошибка сервера');
        }

        if (type === 'login') {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('user_email', data.user.email);
            localStorage.setItem('user_id', data.user.id);
            showApp(data.user);
            showSuccess('Вход выполнен!');
        } else {
            alert('Регистрация успешна! Теперь войдите.');
        }

    } catch (e) {
        console.error('Auth error:', e);
        errorMsg.textContent = e.message || 'Ошибка соединения';
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
    if (currentCall) {
        currentCall.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peer) {
        peer.destroy();
    }

    localStorage.clear();
    location.reload();
};

// === WEBRTC ЛОГИКА ===
function initPeer(userId) {
    console.log('Initializing Peer with ID:', userId);

    if (peer) {
        peer.destroy();
    }

    // Используем тот же сервер для PeerJS (ExpressPeerServer)
    peer = new Peer(userId, PEER_CONFIG);

    peer.on('open', (id) => {
        console.log('✅ Peer connected with ID:', id);
        document.getElementById('my-id').value = id;
        showSuccess('Подключено к серверу WebRTC!');
    });

    peer.on('call', async (call) => {
        console.log('📞 Входящий звонок от:', call.peer);

        if (confirm(`Принять звонок от ${call.peer}?`)) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                startVideoSession(stream);
                call.answer(stream);
                handleCall(call);
            } catch (e) {
                console.error('Error answering call:', e);
                alert("Не удалось получить доступ к камере");
            }
        }
    });

    peer.on('error', (err) => {
        console.error('❌ PeerJS error:', err);

        switch(err.type) {
            case 'peer-unavailable':
                alert("Пользователь не в сети");
                break;
            case 'network':
                alert("Проблемы с сетью");
                break;
            default:
                console.error('PeerJS error:', err);
        }
    });
}

window.startCall = async () => {
    const remoteId = document.getElementById('remote-id').value;
    if (!remoteId) {
        alert("Введите ID собеседника");
        return;
    }

    if (remoteId === (peer ? peer.id : '')) {
        alert("Нельзя позвонить самому себе!");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        startVideoSession(stream);
        const call = peer.call(remoteId, stream);
        handleCall(call);
    } catch (e) {
        console.error('Start call error:', e);
        alert("Ошибка доступа к камере");
    }
};

function handleCall(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        console.log('✅ Получен удаленный поток');
        document.getElementById('remote-video').srcObject = remoteStream;
    });

    call.on('close', () => {
        console.log('📞 Звонок завершен');
        endCall();
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        alert("Ошибка соединения");
        endCall();
    });
}

function startVideoSession(stream) {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
    idleState.classList.add('hidden');
    videoUi.classList.remove('hidden');
}

window.endCall = () => {
    if (currentCall) {
        currentCall.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;

    videoUi.classList.add('hidden');
    idleState.classList.remove('hidden');
};

window.copyId = () => {
    navigator.clipboard.writeText(document.getElementById('my-id').value)
        .then(() => alert("ID скопирован!"))
        .catch(err => console.error('Copy error:', err));
};

// Вспомогательные функции
function showSuccess(message) {
    const el = document.createElement('div');
    el.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded z-50';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// Проверка сервера при загрузке
fetch(`${SERVER_URL}/api/health`)
    .then(res => res.json())
    .then(data => console.log('Server health:', data))
    .catch(err => console.warn('Server check failed:', err));