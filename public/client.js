// Автоопределение URL для Render
const SERVER_URL = window.location.origin;
const IS_RENDER = SERVER_URL.includes('render.com') || SERVER_URL.includes('onrender.com');

console.log('🌐 Server URL:', SERVER_URL);
console.log('🔍 Is Render:', IS_RENDER);

// Настройки PeerJS
let PEER_HOST, PEER_PORT, PEER_SECURE;

if (IS_RENDER) {
    // Для Render
    const url = new URL(SERVER_URL);
    PEER_HOST = url.hostname;
    PEER_PORT = 443; // Render всегда HTTPS
    PEER_SECURE = true;
} else {
    // Для локальной разработки
    PEER_HOST = window.location.hostname;
    PEER_PORT = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
    PEER_SECURE = window.location.protocol === 'https:';
}

console.log('⚙️ PeerJS Config:', {
    host: PEER_HOST,
    port: PEER_PORT,
    secure: PEER_SECURE,
    path: '/peerjs'
});

// ==========================================

let token = localStorage.getItem('auth_token');
let currentUser = null;
let peer = null;
let currentCall = null;
let localStream = null;
let isInitialized = false;

// UI Elements
const authOverlay = document.getElementById('auth-overlay');
const mainApp = document.getElementById('main-app');
const videoUi = document.getElementById('video-ui');
const idleState = document.getElementById('idle-state');
const errorMsg = document.getElementById('error-msg');
const loadingIndicator = document.createElement('div');

// Создаем индикатор загрузки
loadingIndicator.className = 'fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded hidden z-50';
loadingIndicator.id = 'loading-indicator';
loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Загрузка...';
document.body.appendChild(loadingIndicator);

// Проверка соединения
async function checkServerConnection() {
    showLoading('Проверка соединения с сервером...');
    try {
        const response = await fetch(`${SERVER_URL}/api/health`, {
            method: 'GET',
            timeout: 5000
        });
        if (response.ok) {
            console.log('✅ Сервер доступен');
            hideLoading();
            return true;
        }
    } catch (error) {
        console.warn('⚠️ Сервер не отвечает, возможно спит:', error);
        if (IS_RENDER) {
            showWarning('Сервер просыпается... Подождите 30 секунд');
            // Ждем и пробуем снова
            await new Promise(resolve => setTimeout(resolve, 30000));
            return checkServerConnection();
        }
    }
    hideLoading();
    return false;
}

// Проверка токена при старте
async function initApp() {
    if (!await checkServerConnection()) {
        showError('Не удалось подключиться к серверу');
        return;
    }

    if (token) {
        const savedEmail = localStorage.getItem('user_email');
        const savedId = localStorage.getItem('user_id');
        if (savedEmail && savedId) {
            await showApp({ email: savedEmail, id: savedId });
        }
    }
}

// === АВТОРИЗАЦИЯ ===
async function auth(type) {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const endpoint = type === 'register' ? '/api/register' : '/api/login';

    if (!email || !password) {
        showError("Заполните все поля");
        return;
    }

    showLoading(type === 'register' ? 'Регистрация...' : 'Вход...');

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
            await showApp(data.user);
            showSuccess('Вход выполнен!');
        } else {
            showSuccess('Регистрация успешна! Войдите в систему.');
            // Очищаем поле пароля
            document.getElementById('password').value = '';
        }

    } catch (e) {
        console.error('Auth error:', e);
        showError(e.message || 'Ошибка соединения');
    } finally {
        hideLoading();
    }
}

async function showApp(user) {
    currentUser = user;
    authOverlay.classList.add('hidden');
    mainApp.classList.remove('hidden');
    document.getElementById('my-email-display').textContent = user.email;

    await initPeer(user.id);
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
    showSuccess('Выход выполнен');
    setTimeout(() => location.reload(), 1000);
};

// === WEBRTC ЛОГИКА ===
async function initPeer(userId) {
    if (isInitialized) return;

    showLoading('Подключение к серверу WebRTC...');

    // Уничтожаем старый peer если есть
    if (peer) {
        peer.destroy();
    }

    const options = {
        host: PEER_HOST,
        port: PEER_PORT,
        path: '/peerjs',
        secure: PEER_SECURE,
        debug: 2,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ]
        }
    };

    console.log('PeerJS Options:', options);

    peer = new Peer(userId, options);

    peer.on('open', (id) => {
        console.log('✅ Peer connected with ID:', id);
        document.getElementById('my-id').value = id;
        hideLoading();
        isInitialized = true;
        showSuccess('Подключено! Ваш ID: ' + id.substring(0, 10) + '...');
    });

    peer.on('call', async (call) => {
        console.log('📞 Входящий звонок от:', call.peer);
        showNotification(`Входящий звонок от ${call.peer.substring(0, 10)}...`);

        if (confirm(`Принять звонок от ${call.peer}?`)) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 1280, height: 720 },
                    audio: true
                });
                startVideoSession(stream);
                call.answer(stream);
                handleCall(call);
                showSuccess('Звонок начат!');
            } catch (error) {
                console.error('Error answering call:', error);
                showError('Не удалось получить доступ к камере');
            }
        }
    });

    peer.on('error', (err) => {
        console.error('❌ PeerJS error:', err);

        switch(err.type) {
            case 'peer-unavailable':
                showError("Пользователь не в сети");
                break;
            case 'network':
                showError("Проблемы с сетью. Переподключаемся...");
                setTimeout(() => initPeer(userId), 3000);
                break;
            case 'server-error':
                if (IS_RENDER) {
                    showWarning('Сервер спит. Просыпаем...');
                    setTimeout(() => initPeer(userId), 10000);
                }
                break;
            default:
                showError('Ошибка подключения: ' + err.message);
        }
    });

    peer.on('disconnected', () => {
        console.log('⚠️ Peer disconnected');
        showWarning('Потеряно соединение. Переподключаемся...');
        setTimeout(() => {
            if (peer && !peer.disconnected) {
                peer.reconnect();
            }
        }, 2000);
    });

    // Таймаут подключения
    setTimeout(() => {
        if (!isInitialized) {
            showError('Таймаут подключения к WebRTC серверу');
            if (IS_RENDER) {
                showInfo('На Render сервер может спать. Попробуйте через 30 секунд.');
            }
        }
    }, 15000);
}

window.startCall = async () => {
    const remoteId = document.getElementById('remote-id').value.trim();
    if (!remoteId) {
        showError("Введите ID собеседника");
        return;
    }

    if (remoteId === (peer ? peer.id : '')) {
        showError("Нельзя позвонить самому себе!");
        return;
    }

    showLoading('Установка соединения...');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: true
        });

        startVideoSession(stream);
        const call = peer.call(remoteId, stream);

        if (!call) {
            throw new Error("Не удалось создать звонок");
        }

        handleCall(call);
        showSuccess('Звонок начат! Ожидание ответа...');
    } catch (error) {
        console.error('Call error:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
};

function handleCall(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        console.log('✅ Получен удаленный поток');
        document.getElementById('remote-video').srcObject = remoteStream;
        showSuccess('Соединение установлено!');
    });

    call.on('close', () => {
        console.log('📞 Звонок завершен');
        showInfo('Звонок завершен');
        endCall();
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        showError('Ошибка соединения: ' + err.message);
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
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Очищаем видео элементы
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;

    videoUi.classList.add('hidden');
    idleState.classList.remove('hidden');

    document.getElementById('remote-id').value = '';
};

window.copyId = () => {
    const myId = document.getElementById('my-id').value;
    if (!myId) {
        showError("ID еще не загружен");
        return;
    }

    navigator.clipboard.writeText(myId).then(() => {
        showSuccess("ID скопирован!");
    }).catch(err => {
        console.error('Copy error:', err);
        showError("Не удалось скопировать ID");
    });
};

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
function showLoading(message) {
    loadingIndicator.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${message}`;
    loadingIndicator.classList.remove('hidden');
}

function hideLoading() {
    loadingIndicator.classList.add('hidden');
}

function showError(message) {
    errorMsg.textContent = message;
    errorMsg.className = 'text-red-500 text-xs text-center h-4';
    setTimeout(() => errorMsg.textContent = '', 5000);
}

function showSuccess(message) {
    const successMsg = document.createElement('div');
    successMsg.className = 'fixed top-4 left-4 bg-green-600 text-white px-4 py-2 rounded z-50';
    successMsg.innerHTML = `<i class="fas fa-check mr-2"></i>${message}`;
    document.body.appendChild(successMsg);
    setTimeout(() => successMsg.remove(), 3000);
}

function showWarning(message) {
    const warningMsg = document.createElement('div');
    warningMsg.className = 'fixed top-4 left-4 bg-yellow-600 text-white px-4 py-2 rounded z-50';
    warningMsg.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${message}`;
    document.body.appendChild(warningMsg);
    setTimeout(() => warningMsg.remove(), 5000);
}

function showInfo(message) {
    const infoMsg = document.createElement('div');
    infoMsg.className = 'fixed top-4 left-4 bg-blue-600 text-white px-4 py-2 rounded z-50';
    infoMsg.innerHTML = `<i class="fas fa-info-circle mr-2"></i>${message}`;
    document.body.appendChild(infoMsg);
    setTimeout(() => infoMsg.remove(), 3000);
}

function showNotification(message) {
    if (Notification.permission === 'granted') {
        new Notification('Видеозвонок', { body: message });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification('Видеозвонок', { body: message });
            }
        });
    }
}

// Запрашиваем разрешение на уведомления при загрузке
if ('Notification' in window) {
    Notification.requestPermission();
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initApp);

// Периодическая проверка соединения
if (IS_RENDER) {
    setInterval(() => {
        if (peer && peer.disconnected) {
            console.log('Периодическая проверка: переподключаемся...');
            peer.reconnect();
        }
    }, 30000);
}