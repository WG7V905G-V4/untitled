// ==========================================
// НАСТРОЙКИ (АДАПТИРУЕМ ПОД ВАШ IP)
// ==========================================
const SERVER_URL = 'http://89.139.21.203:3030';

// Настройки PeerJS для работы с публичным IP
const PEER_HOST = '89.139.21.203';  // Ваш публичный IP
const PEER_PORT = 3030;              // Тот же порт, что и сервер
const PEER_SECURE = false;          // HTTPS=false для HTTP

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
        } else {
            alert('Регистрация успешна! Теперь войдите.');
            // Очищаем поля и предлагаем войти
            document.getElementById('password').value = '';
            errorMsg.textContent = 'Теперь войдите с вашими данными';
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
    // Убедимся, что предыдущее соединение закрыто
    if (peer) {
        peer.destroy();
    }

    console.log('Initializing Peer with ID:', userId);

    // Подключаемся к нашему серверу PeerJS
    peer = new Peer(userId, {
        host: PEER_HOST,
        port: PEER_PORT,
        path: '/peerjs',
        secure: PEER_SECURE,
        debug: 3, // Увеличиваем уровень отладки
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        console.log('✅ Peer connected with ID:', id);
        document.getElementById('my-id').value = id;
    });

    peer.on('call', async (call) => {
        console.log('📞 Входящий звонок от:', call.peer);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            startVideoSession(stream);
            call.answer(stream);
            handleCall(call);
        } catch (error) {
            console.error('Ошибка при ответе на звонок:', error);
            alert("Не удалось получить доступ к камере/микрофону");
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
                console.error('Неизвестная ошибка PeerJS:', err);
        }
    });

    peer.on('disconnected', () => {
        console.log('⚠️ Peer disconnected, reconnecting...');
        peer.reconnect();
    });

    peer.on('close', () => {
        console.log('🔒 Peer connection closed');
    });
}

window.startCall = async () => {
    const remoteId = document.getElementById('remote-id').value.trim();
    if (!remoteId) {
        alert("Введите ID собеседника");
        return;
    }

    if (remoteId === peer.id) {
        alert("Нельзя позвонить самому себе!");
        return;
    }

    console.log('Начинаем звонок к:', remoteId);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        startVideoSession(stream);

        const call = peer.call(remoteId, stream);
        if (!call) {
            throw new Error("Не удалось создать звонок");
        }
        handleCall(call);
    } catch (error) {
        console.error('Ошибка при начале звонка:', error);
        alert("Ошибка: " + error.message);
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
        console.error('Ошибка в звонке:', err);
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
    console.log('Завершаем звонок...');

    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }

    // Очищаем видео элементы
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;

    videoUi.classList.add('hidden');
    idleState.classList.remove('hidden');

    // Очищаем поле ввода ID
    document.getElementById('remote-id').value = '';
};

window.copyId = () => {
    const myId = document.getElementById('my-id').value;
    if (!myId) {
        alert("ID еще не загружен");
        return;
    }

    navigator.clipboard.writeText(myId).then(() => {
        alert("ID скопирован в буфер обмена!");
    }).catch(err => {
        console.error('Ошибка копирования:', err);
        alert("Не удалось скопировать ID");
    });
};