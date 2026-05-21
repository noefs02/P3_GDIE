const socket = io();

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const roomInput = document.getElementById('room-input');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const hangupBtn = document.getElementById('hangup-btn');
const cameraBtn = document.getElementById('camera-btn');
const screenBtn = document.getElementById('screen-btn');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

let currentRoom = '';
let myName = 'Usuario';
// Restaurar nombre guardado
if (sessionStorage.getItem('webrtc_username')) {
    usernameInput.value = sessionStorage.getItem('webrtc_username');
}

// Generar color aleatorio de paleta al inicio
const colorPalette = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#33FFF0', '#F0FF33', '#FF8C33', '#8C33FF', '#E83E8C', '#33FF8C', '#FF3357', '#5733FF', '#33A1FF', '#FF33A1', '#A1FF33', '#A133FF', '#33FFA1', '#FFC300', '#00C3FF', '#FF00C3'];
const myColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];

let localStream = new MediaStream();
let myVideoElement = null;
let cameraActive = false;
let screenActive = false;
let pinnedBoxId = null; // ID de la caja fijada (grande)

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

// 1. Interfaz del Chat Helpers
function appendMessage(senderClass, text, senderName, colorColor) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message ' + senderClass;
    
    if (senderName) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sender-name';
        nameSpan.textContent = senderName;
        if (colorColor) nameSpan.style.color = colorColor;
        msgDiv.appendChild(nameSpan);
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
        video.classList.remove('hidden');
        placeholder.style.display = 'none';
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
    if (!cameraActive) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            
            localStream.getTracks().forEach(track => {
                 track.stop();
                 localStream.removeTrack(track);
            });

            stream.getTracks().forEach(track => localStream.addTrack(track));
            
            myVideoElement.srcObject = null;
            myVideoElement.srcObject = localStream;

            myVideoElement.classList.remove('hidden');
            document.querySelector('#box-local .video-placeholder').style.display = 'none';
            
            for (let peerId in peers) {
                const pc = peers[peerId];
                localStream.getTracks().forEach(track => {
                    const senders = pc.getSenders();
                    const sender = senders.find(s => s.track && s.track.kind === track.kind);
                    if (!sender) {
                        pc.addTrack(track, localStream);
                    } else {
                        sender.replaceTrack(track);
                    }
                });
            }
            cameraActive = true;
            cameraBtn.textContent = "Apagar Cámara";
        } catch (e) {
            console.error("Camera error:", e);
            alert("Error accediendo a dispositivos físicos");
        }
    } else {
        for (let peerId in peers) {
            const pc = peers[peerId];
            pc.getSenders().forEach(sender => {
                if (sender.track) pc.removeTrack(sender);
            });
        }
        
        localStream.getTracks().forEach(track => {
            track.stop();
            localStream.removeTrack(track);
        });
        
        myVideoElement.srcObject = null;
        document.getElementById('video-local').classList.add('hidden');
        document.querySelector('#box-local .video-placeholder').style.display = 'flex';
        cameraActive = false;
        cameraBtn.textContent = "Activar Cámara";
    }
}

async function toggleScreen() {
    if (!screenActive) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            screenTrack.onended = () => { toggleScreen(); };
            
            myVideoElement.srcObject = screenStream; 
            myVideoElement.classList.remove('hidden');
            document.querySelector('#box-local .video-placeholder').style.display = 'none';
            
            for (let peerId in peers) {
                const pc = peers[peerId];
                const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    videoSender.replaceTrack(screenTrack);
                } else {
                    pc.addTrack(screenTrack, localStream);
                }
            }
            screenActive = true;
            screenBtn.textContent = "Dejar Compartir";
            cameraBtn.disabled = true; 
        } catch (e) {
            console.error("Screen share error:", e);
        }
    } else {
        for (let peerId in peers) {
            const pc = peers[peerId];
            const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                const camTrack = localStream.getVideoTracks()[0];
                if (camTrack) videoSender.replaceTrack(camTrack);
                else {
                    pc.removeTrack(videoSender); 
                }
            }
        }
        myVideoElement.srcObject = localStream.active ? localStream : null;
        
        if (!localStream.active || localStream.getVideoTracks().length === 0) {
            myVideoElement.classList.add('hidden');
            document.querySelector('#box-local .video-placeholder').style.display = 'flex';
        }
        
        screenActive = false;
        screenBtn.textContent = "Compartir Pantalla";
        cameraBtn.disabled = false;
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
            remoteVideo.srcObject = event.streams[0];
            
            event.track.onmute = () => {
                remoteVideo.classList.add('hidden');
                const p = document.querySelector('#box-' + targetId + ' .video-placeholder');
                if(p) p.style.display = 'flex';
            };
            
            event.track.onunmute = () => {
                remoteVideo.classList.remove('hidden');
                const p = document.querySelector('#box-' + targetId + ' .video-placeholder');
                if(p) p.style.display = 'none';
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
    channel.onmessage = (event) => {
        appendMessage('remote', event.data, peerNames[targetId], peerColors[targetId]);
    };
}

sendBtn.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (text) {
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
    myName = usernameInput.value.trim() || 'Anónimo';
    currentRoom = roomInput.value.trim();
    
    if (!currentRoom) return alert("Escribe un nombre de sala");
    
    // Guardar sesion
    sessionStorage.setItem('webrtc_username', myName);

    joinBtn.style.display = 'none';
    roomInput.disabled = true;
    usernameInput.disabled = true;
    hangupBtn.style.display = 'inline-block';
    cameraBtn.style.display = 'inline-block';
    screenBtn.style.display = 'inline-block';
    cameraBtn.disabled = false;
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
    } catch (e) {
        console.error("Handle offer error:", e);
    }
});

socket.on('answer', async (data) => {
    const pc = peers[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
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

socket.on('user-left', (id) => {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
    }
    removeVideoBox(id);
});

cameraBtn.addEventListener('click', toggleCamera);
screenBtn.addEventListener('click', toggleScreen);

hangupBtn.addEventListener('click', () => {
    // Almacenamos valores antes de setearlo de cero
    sessionStorage.setItem('webrtc_username', myName);
    
    Object.keys(peers).forEach(id => {
        peers[id].close();
        delete peers[id];
        removeVideoBox(id);
    });
    
    if (cameraActive) toggleCamera(); 
    
    socket.emit('logout'); 
    window.location.reload(); 
});