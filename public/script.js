import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';
env.allowLocalModels = false;

const socket = io();

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const roomInput = document.getElementById('room-input');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const hangupBtn = document.getElementById('hangup-btn');
const cameraBtn = document.getElementById('camera-btn');
const micBtn = document.getElementById('mic-btn');
const screenBtn = document.getElementById('screen-btn');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const moderationToggle = document.getElementById('moderation-toggle');
const moderationStatus = document.getElementById('moderation-status');
const translationSelect = document.getElementById('translation-select');
const translationStatus = document.getElementById('translation-status');

// AI State
let toxicityClassifier = null;
let isModerationLoading = false;
let translator = null;
let currentTargetLang = 'none';

if (translationSelect) {
    translationSelect.addEventListener('change', async (e) => {
        const lang = e.target.value;
        currentTargetLang = lang;
        if (lang !== 'none') {
            try {
                translationStatus.textContent = "Cargando...";
                translationSelect.disabled = true;
                const modelName = lang === 'es' ? 'Xenova/opus-mt-en-es' : 'Xenova/opus-mt-es-en';
                translator = await pipeline('translation', modelName);
                translationStatus.textContent = "Listo";
                translationStatus.style.color = "#10b981";
                translationSelect.disabled = false;
            } catch(err) {
                console.error(err);
                translationStatus.textContent = "Error";
                translationStatus.style.color = "#ef4444";
                translationSelect.value = 'none';
                currentTargetLang = 'none';
                translationSelect.disabled = false;
            }
        } else {
            translationStatus.textContent = "";
            translator = null;
        }
    });
}

if (moderationToggle) {
    moderationToggle.disabled = false;
    moderationToggle.addEventListener('change', async (e) => {
        if (e.target.checked && !toxicityClassifier && !isModerationLoading) {
            try {
                isModerationLoading = true;
                moderationStatus.textContent = "Cargando IA...";
                moderationToggle.disabled = true;
                
                toxicityClassifier = await pipeline('text-classification', 'Xenova/toxic-bert');
                
                moderationStatus.textContent = "IA Lista";
                moderationStatus.style.color = "#10b981"; 
                moderationToggle.disabled = false;
                isModerationLoading = false;
            } catch(err) {
                console.error("Error loading toxic-bert:", err);
                moderationStatus.textContent = "Error IA";
                moderationStatus.style.color = "#ef4444";
                e.target.checked = false;
                moderationToggle.disabled = false;
                isModerationLoading = false;
            }
        }
    });
}

// --- MANEJO DE SESIÓN Y PERSISTENCIA (sessionStorage) ---
// 1. Identificador de usuario único de sesión
if (!sessionStorage.getItem('webrtc_user_id')) {
    const randomId = 'user-' + Math.random().toString(36).substring(2, 9);
    sessionStorage.setItem('webrtc_user_id', randomId);
}
const myUserId = sessionStorage.getItem('webrtc_user_id');

// 2. Nombre de usuario
let myName = 'Usuario';
if (sessionStorage.getItem('webrtc_username')) {
    myName = sessionStorage.getItem('webrtc_username');
    usernameInput.value = myName;
}

// 3. Última sala visitada
if (sessionStorage.getItem('webrtc_last_room')) {
    roomInput.value = sessionStorage.getItem('webrtc_last_room');
}

// 4. Color de usuario único por sesión
const colorPalette = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#33FFF0', '#F0FF33', '#FF8C33', '#8C33FF', '#E83E8C', '#33FF8C', '#FF3357', '#5733FF', '#33A1FF', '#FF33A1', '#A1FF33', '#A133FF', '#33FFA1', '#FFC300', '#00C3FF', '#FF00C3'];
if (!sessionStorage.getItem('webrtc_user_color')) {
    const randomColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    sessionStorage.setItem('webrtc_user_color', randomColor);
}
const myColor = sessionStorage.getItem('webrtc_user_color');

// 5. Guardar ID del Socket cuando se conecte
socket.on('connect', () => {
    sessionStorage.setItem('webrtc_socket_id', socket.id);
    console.log('Socket conectado. ID guardada en sessionStorage:', socket.id);
});

let currentRoom = '';

let localStream = new MediaStream();
let myVideoElement = null;
let cameraActive = false;
let screenActive = false;
let micActive = false;
let screenAudioTrack = null;
let pinnedBoxId = null; // ID de la caja fijada (grande)
let isLeavingRoom = false;

const peers = {}; // socket.id -> RTCPeerConnection
const dataChannels = {}; // socket.id -> RTCDataChannel
const peerNames = {}; // socket.id -> String
const peerColors = {}; // socket.id -> String
peerColors['local'] = myColor;

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- LOGICA DE LAYOUT FLEX ---
function updateGridLayout() {
    const boxes = Array.from(videoGrid.children);
    const count = boxes.length;
    if (count === 0) return;

    boxes.forEach(box => {
        box.classList.remove('pinned', 'unpinned');
        box.style.width = '';
    });

    if (pinnedBoxId && document.getElementById('box-' + pinnedBoxId)) {
        boxes.forEach(box => {
            if (box.id === 'box-' + pinnedBoxId) {
                box.classList.add('pinned');
            } else {
                box.classList.add('unpinned');
            }
        });
    } else {
        // Cálculo dinámico para la cuadrícula según cantidad de cajas
        let width = '100%';
        if (count > 1 && count <= 4) width = 'calc(50% - 16px)';
        else if (count > 4 && count <= 9) width = 'calc(33.33% - 16px)';
        else if (count > 9) width = 'calc(25% - 16px)';
        
        boxes.forEach(box => {
            box.style.width = width;
        });
    }
}

// --- CONTROL DE VISIBILIDAD DE REPRODUCTORES (EVITAR REPRODUCTOR EN NEGRO) ---
function updateVideoVisibility(id) {
    const video = document.getElementById('video-' + id);
    const box = document.getElementById('box-' + id);
    if (!video || !box) return;
    
    const placeholder = box.querySelector('.video-placeholder');
    if (!placeholder) return;
    
    const stream = video.srcObject;
    const hasVideoTracks = stream && stream.getVideoTracks().length > 0;
    // Un stream se considera con video activo si tiene tracks de video habilitados y no silenciados
    const hasActiveVideo = hasVideoTracks && stream.getVideoTracks().some(track => track.enabled && !track.muted);
    
    if (hasActiveVideo) {
        video.classList.remove('hidden');
        placeholder.style.display = 'none';
    } else {
        video.classList.add('hidden');
        placeholder.style.display = 'flex';
    }
}

// --- EFECTOS DE SONIDO SINTETIZADOS (Web Audio API) ---
function playNotificationSound(type) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        
        if (type === 'join') {
            // Ascending chime: C5 (523.25) -> E5 (659.25) -> G5 (783.99)
            const notes = [523.25, 659.25, 783.99];
            notes.forEach((freq, index) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + index * 0.08);
                gain.gain.setValueAtTime(0, now + index * 0.08);
                gain.gain.linearRampToValueAtTime(0.12, now + index * 0.08 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + index * 0.08);
                osc.stop(now + index * 0.08 + 0.35);
            });
        } else if (type === 'leave') {
            // Descending chime: G5 (783.99) -> E5 (659.25) -> C5 (523.25)
            const notes = [783.99, 659.25, 523.25];
            notes.forEach((freq, index) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + index * 0.08);
                gain.gain.setValueAtTime(0, now + index * 0.08);
                gain.gain.linearRampToValueAtTime(0.1, now + index * 0.08 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.28);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + index * 0.08);
                osc.stop(now + index * 0.08 + 0.3);
            });
        } else if (type === 'camera') {
            // High-tech ascending sweep (camera toggle)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(1000, now + 0.15);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.08, now + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.22);
        } else if (type === 'mic') {
            // Elegant quick double beep (microphone toggle)
            [550, 750].forEach((freq, index) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + index * 0.05);
                gain.gain.setValueAtTime(0, now + index * 0.05);
                gain.gain.linearRampToValueAtTime(0.06, now + index * 0.05 + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.05 + 0.04);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + index * 0.05);
                osc.stop(now + index * 0.05 + 0.06);
            });
        }
    } catch (error) {
        console.warn("Could not play synthesized sound (interaction requires user gesture first):", error);
    }
}

// 1. Interfaz del Chat Helpers
function appendMessage(senderClass, text, senderName, colorColor, isTranslated = false, lang = '') {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message ' + senderClass;
    
    if (senderName) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sender-name';
        nameSpan.textContent = senderName;
        if (colorColor) nameSpan.style.color = colorColor;
        msgDiv.appendChild(nameSpan);
    }
    
    if (isTranslated) {
        const mark = document.createElement('span');
        mark.className = 'translated-mark';
        mark.textContent = `[A->${lang.toUpperCase()}] `;
        msgDiv.appendChild(mark);
    }
    
    const textNode = document.createTextNode(text);
    msgDiv.appendChild(textNode);
    
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message system';
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Interfaz para agregar bloques de video dinámicamente
function createVideoBox(id, labelName, color) {
    const box = document.createElement('div');
    box.className = 'video-box';
    box.id = 'box-' + id;
    
    // Si la caja hace click, se fija o desfija
    box.addEventListener('click', () => {
        if (pinnedBoxId === id) {
            pinnedBoxId = null; // Desfijar
        } else {
            pinnedBoxId = id; // Fijar
        }
        updateGridLayout();
    });
    
    const label = document.createElement('h3');
    label.className = 'video-label';
    label.textContent = labelName;
    
    const placeholder = document.createElement('div');
    placeholder.className = 'video-placeholder';
    placeholder.textContent = labelName;
    if (color) placeholder.style.backgroundColor = color;
    
    const video = document.createElement('video');
    video.id = 'video-' + id;
    video.autoplay = true;
    video.playsInline = true;
    if (id === 'local') video.muted = true;
    video.className = 'hidden'; 
    
    video.addEventListener('playing', () => {
        updateVideoVisibility(id);
    });
    
    box.appendChild(label);
    box.appendChild(placeholder);
    box.appendChild(video);
    videoGrid.appendChild(box);
    
    updateGridLayout();
    return video;
}

function removeVideoBox(id) {
    const box = document.getElementById('box-' + id);
    if (box) {
        box.remove();
        if (pinnedBoxId === id) pinnedBoxId = null;
        updateGridLayout();
    }
}

// 2. Control de Media Local
async function toggleCamera() {
    if (!isLeavingRoom) playNotificationSound('camera');
    if (!cameraActive) {
        // Exclusividad: apagar pantalla compartida primero si estuviera activa
        if (screenActive) {
            await toggleScreen();
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];
            
            // Añadir el track de video al localStream
            localStream.addTrack(videoTrack);
            
            myVideoElement.srcObject = null;
            myVideoElement.srcObject = localStream;
            updateVideoVisibility('local');
            
            for (let peerId in peers) {
                const pc = peers[peerId];
                const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (!videoSender) {
                    pc.addTrack(videoTrack, localStream);
                } else {
                    videoSender.replaceTrack(videoTrack);
                }
            }
            cameraActive = true;
            cameraBtn.innerHTML = '<i class="fa-solid fa-video"></i> Apagar Cámara';
            cameraBtn.classList.add('active-camera');
        } catch (e) {
            console.error("Camera error:", e);
            alert("Error accediendo a la cámara");
        }
    } else {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);
        }
        
        for (let peerId in peers) {
            const pc = peers[peerId];
            const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                pc.removeTrack(videoSender);
            }
        }
        
        if (localStream.getVideoTracks().length === 0) {
            myVideoElement.srcObject = null;
            if (localStream.getTracks().length > 0) {
                myVideoElement.srcObject = localStream; // Mantener localStream si tiene audio
            }
        }
        updateVideoVisibility('local');
        
        cameraActive = false;
        cameraBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Activar Cámara';
        cameraBtn.classList.remove('active-camera');
    }
}

async function toggleMic() {
    if (!isLeavingRoom) playNotificationSound('mic');
    if (!micActive) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioTrack = stream.getAudioTracks()[0];
            
            localStream.addTrack(audioTrack);
            
            if (myVideoElement && !myVideoElement.srcObject) {
                myVideoElement.srcObject = localStream;
            }
            updateVideoVisibility('local');
            
            for (let peerId in peers) {
                const pc = peers[peerId];
                const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (!audioSender) {
                    pc.addTrack(audioTrack, localStream);
                } else {
                    audioSender.replaceTrack(audioTrack);
                }
            }
            micActive = true;
            micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> Apagar Micrófono';
            micBtn.classList.add('active-mic');
        } catch (e) {
            console.error("Microphone error:", e);
            alert("Error accediendo al micrófono");
        }
    } else {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.stop();
            localStream.removeTrack(audioTrack);
        }
        
        for (let peerId in peers) {
            const pc = peers[peerId];
            const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
                pc.removeTrack(audioSender);
            }
        }
        
        micActive = false;
        micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Activar Micrófono';
        micBtn.classList.remove('active-mic');
        
        if (myVideoElement && localStream.getTracks().length === 0) {
            myVideoElement.srcObject = null;
        }
        updateVideoVisibility('local');
    }
}

async function toggleScreen() {
    if (!isLeavingRoom) playNotificationSound('camera');
    if (!screenActive) {
        // Exclusividad: apagar cámara primero si estuviera activa
        if (cameraActive) {
            await toggleCamera();
        }

        try {
            let screenStream;
            // Intentar primero con audio del sistema/pestaña
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            } catch (err) {
                console.warn("Fallo al capturar pantalla con audio, intentando solo vídeo...", err);
                // Fallback a solo vídeo si falla
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            }
            
            const screenTrack = screenStream.getVideoTracks()[0];
            screenTrack.onended = () => { toggleScreen(); };
            
            localStream.addTrack(screenTrack);
            
            // Si el stream de pantalla incluye audio, capturamos su track y lo guardamos
            screenAudioTrack = screenStream.getAudioTracks()[0];
            if (screenAudioTrack) {
                localStream.addTrack(screenAudioTrack);
            }
            
            myVideoElement.srcObject = null;
            myVideoElement.srcObject = localStream;
            updateVideoVisibility('local');
            
            for (let peerId in peers) {
                const pc = peers[peerId];
                // Retransmitir vídeo de pantalla de forma segura
                try {
                    const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender) {
                        videoSender.replaceTrack(screenTrack);
                    } else {
                        pc.addTrack(screenTrack, localStream);
                    }
                } catch (videoErr) {
                    console.error("No se pudo transmitir el vídeo de la pantalla al peer " + peerId, videoErr);
                }
                
                // Retransmitir audio de pantalla si existe de forma segura
                if (screenAudioTrack) {
                    try {
                        pc.addTrack(screenAudioTrack, localStream);
                    } catch (audioErr) {
                        console.error("No se pudo transmitir el audio de la pantalla al peer " + peerId, audioErr);
                    }
                }
            }
            screenActive = true;
            screenBtn.innerHTML = '<i class="fa-solid fa-rectangle-xmark"></i> Dejar Compartir';
            screenBtn.classList.add('active-screen');
        } catch (e) {
            console.error("Screen share error:", e);
            alert("No se pudo iniciar la compartición de pantalla.");
        }
    } else {
        // Detener track de vídeo de la pantalla
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);
        }
        
        // Detener y remover el track de audio de la pantalla (si existiera)
        if (screenAudioTrack) {
            screenAudioTrack.stop();
            localStream.removeTrack(screenAudioTrack);
        }
        
        for (let peerId in peers) {
            const pc = peers[peerId];
            
            // Eliminar vídeo de pantalla del peer
            const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                pc.removeTrack(videoSender);
            }
            
            // Eliminar track de audio de pantalla del peer
            if (screenAudioTrack) {
                const audioSender = pc.getSenders().find(s => s.track === screenAudioTrack);
                if (audioSender) {
                    pc.removeTrack(audioSender);
                }
            }
        }
        
        screenAudioTrack = null;
        
        if (localStream.getVideoTracks().length === 0) {
            myVideoElement.srcObject = null;
            if (localStream.getTracks().length > 0) {
                myVideoElement.srcObject = localStream; // Mantener localStream si tiene audio
            }
        }
        updateVideoVisibility('local');
        
        screenActive = false;
        screenBtn.innerHTML = '<i class="fa-solid fa-desktop"></i> Compartir Pantalla';
        screenBtn.classList.remove('active-screen');
    }
}

// 3. WebRTC Mesh Management
function createPeerConnection(targetId, targetName, targetColor) {
    const pc = new RTCPeerConnection(configuration);
    peers[targetId] = pc;
    peerNames[targetId] = targetName;
    peerColors[targetId] = targetColor;
    
    if (!document.getElementById('box-' + targetId)) {
        createVideoBox(targetId, targetName, targetColor);
    }
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        const remoteVideo = document.getElementById('video-' + targetId);
        if (remoteVideo) {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
            
            updateVideoVisibility(targetId);
            
            event.track.onmute = () => {
                if (event.track.kind === 'video') {
                    updateVideoVisibility(targetId);
                }
            };
            
            event.track.onunmute = () => {
                if (event.track.kind === 'video') {
                    updateVideoVisibility(targetId);
                }
            };
        }
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };
    
    pc.ondatachannel = (event) => {
        setupDataChannel(targetId, event.channel);
    };
    
    pc.onnegotiationneeded = async () => {
        try {
            await pc.setLocalDescription();
            socket.emit('offer', { target: targetId, offer: pc.localDescription, name: myName, color: myColor });
        } catch (e) {
            console.error("Negotiation error:", e);
        }
    };
    
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            removeVideoBox(targetId);
            delete peers[targetId];
            appendSystemMessage("Conexión con " + targetName + " perdida.");
        }
    };
    
    return pc;
}



function setupDataChannel(targetId, channel) {
    dataChannels[targetId] = channel;
    channel.onopen = () => {
        chatInput.disabled = false;
        sendBtn.disabled = false;
    };
    channel.onmessage = async (event) => {
        let originalText = event.data;
        let textToDisplay = originalText;
        let isTranslated = false;
        
        if (translator && currentTargetLang !== 'none') {
            try {
                const res = await translator(originalText);
                textToDisplay = res[0].translation_text;
                isTranslated = true;
            } catch(e) { console.error(e); }
        }

        if (moderationToggle && moderationToggle.checked && toxicityClassifier) {
            try {
                const results = await toxicityClassifier(originalText);
                const isToxic = results.some(r => r.label === 'toxic' && r.score > 0.85);
                if (isToxic) {
                    textToDisplay = textToDisplay.replace(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '*');
                }
            } catch (err) {
                console.error("Error in moderation:", err);
            }
        }
        
        appendMessage('remote', textToDisplay, peerNames[targetId], peerColors[targetId], isTranslated, currentTargetLang);
    };
}

sendBtn.addEventListener('click', async () => {
    let text = chatInput.value.trim();
    if (text) {
        if (moderationToggle && moderationToggle.checked && toxicityClassifier) {
            try {
                const results = await toxicityClassifier(text);
                const isToxic = results.some(r => r.label === 'toxic' && r.score > 0.85);
                if (isToxic) {
                    text = text.replace(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '*');
                }
            } catch (err) {
                console.error("Error in moderation:", err);
            }
        }

        appendMessage('me', text, myName, myColor);
        for (let targetId in dataChannels) {
            const channel = dataChannels[targetId];
            if (channel.readyState === 'open') {
                channel.send(text);
            }
        }
        chatInput.value = '';
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// 4. Integracion Signaling Socket
joinBtn.addEventListener('click', () => {
    if (usernameInput.value.trim() === '') {
        return alert("Escribe un nombre de usuario");
    }
    
    // Reproducir sonido al entrar a la sala
    playNotificationSound('join');

    myName = usernameInput.value.trim() || 'Anónimo';
    currentRoom = roomInput.value.trim();
    
    if (!currentRoom) return alert("Escribe un nombre de sala");
    
    // Guardar sesion
    sessionStorage.setItem('webrtc_username', myName);
    sessionStorage.setItem('webrtc_last_room', currentRoom);

    joinBtn.style.display = 'none';
    roomInput.disabled = true;
    usernameInput.disabled = true;
    hangupBtn.style.display = 'inline-block';
    cameraBtn.style.display = 'inline-block';
    micBtn.style.display = 'inline-block';
    screenBtn.style.display = 'inline-block';
    cameraBtn.disabled = false;
    micBtn.disabled = false;
    screenBtn.disabled = false;
    
    myVideoElement = createVideoBox('local', myName + " (Tú)", myColor);
    appendSystemMessage("Unido a " + currentRoom);
    
    socket.emit('join', { room: currentRoom, name: myName, color: myColor });
});

socket.on('user-joined', async (data) => {
    appendSystemMessage(data.name + " ingresó a la sala.");
    const pc = createPeerConnection(data.id, data.name, data.color);
    const dc = pc.createDataChannel('chat');
    setupDataChannel(data.id, dc);
});

socket.on('offer', async (data) => {
    let pc = peers[data.sender];
    const isNew = !pc;
    if (isNew) {
        pc = createPeerConnection(data.sender, data.name, data.color);
    }
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        if (isNew && localStream && localStream.active) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        
        await pc.setLocalDescription();
        socket.emit('answer', { target: data.sender, answer: pc.localDescription });
        
        updateVideoVisibility(data.sender);
    } catch (e) {
        console.error("Handle offer error:", e);
    }
});

socket.on('answer', async (data) => {
    const pc = peers[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        updateVideoVisibility(data.sender);
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peers[data.sender];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch(e) {}
    }
});

function cleanupUser(id) {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
    }
    removeVideoBox(id);
    
    // Limpieza de datos
    delete dataChannels[id];
    delete peerNames[id];
    delete peerColors[id];
}

socket.on('user-left-room', (id) => {
    if (peerNames[id]) {
        const name = peerNames[id];
        appendSystemMessage(name + " abandonó la sala.");
    }
    cleanupUser(id);
});

socket.on('user-disconnected', (id) => {
    if (peerNames[id]) {
        const name = peerNames[id];
        appendSystemMessage(name + " se ha desconectado.");
    }
    cleanupUser(id);
});

async function leaveRoom() {
    isLeavingRoom = true;
    playNotificationSound('leave');
    
    if (currentRoom) {
        socket.emit('leave-room', { room: currentRoom });
    }

    if (screenActive) {
        await toggleScreen();
    }
    if (cameraActive) {
        await toggleCamera();
    }
    if (micActive) {
        await toggleMic();
    }
    
    localStream.getTracks().forEach(track => {
        track.stop();
        localStream.removeTrack(track);
    });

    Object.keys(peers).forEach(id => {
        if (peers[id]) {
            peers[id].close();
            delete peers[id];
        }
        removeVideoBox(id);
    });

    removeVideoBox('local');

    pinnedBoxId = null;
    
    Object.keys(dataChannels).forEach(id => delete dataChannels[id]);
    Object.keys(peerNames).forEach(id => delete peerNames[id]);
    Object.keys(peerColors).forEach(id => {
        if (id !== 'local') delete peerColors[id];
    });

    joinBtn.style.display = 'inline-block';
    roomInput.disabled = false;
    usernameInput.disabled = false;
    
    hangupBtn.style.display = 'none';
    cameraBtn.style.display = 'none';
    micBtn.style.display = 'none';
    screenBtn.style.display = 'none';
    cameraBtn.disabled = false;
    micBtn.disabled = false;
    screenBtn.disabled = false;
    
    // Resetear textos con sus respectivos iconos de FontAwesome
    micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Activar Micrófono';
    cameraBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Activar Cámara';
    screenBtn.innerHTML = '<i class="fa-solid fa-desktop"></i> Compartir Pantalla';
    
    cameraBtn.classList.remove('active-camera');
    micBtn.classList.remove('active-mic');
    screenBtn.classList.remove('active-screen');

    chatInput.disabled = true;
    sendBtn.disabled = true;
    chatInput.value = '';

    appendSystemMessage("Has abandonado la sala " + currentRoom + ".");
    currentRoom = '';
    isLeavingRoom = false;
}

cameraBtn.addEventListener('click', toggleCamera);
micBtn.addEventListener('click', toggleMic);
screenBtn.addEventListener('click', toggleScreen);
hangupBtn.addEventListener('click', leaveRoom);