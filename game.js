import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

// --- CONFIGURATION & GLOBALS ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game states
const STATE_START = 'start';
const STATE_PLAYING = 'playing';
const STATE_PAUSED = 'paused';
const STATE_GAMEOVER = 'gameover';
let gameState = STATE_START;

// Webcam & Gesture tracking globals
let handLandmarker = null;
let webcamRunning = false;
let controlMethod = 'keyboard'; // 'keyboard' or 'motion'
let handY = 0.5; // Normalized y position [0, 1] of hand center (landmark 9)
let lastVideoTime = -1;

const video = document.getElementById('webcam');
const pipCanvas = document.getElementById('cameraCanvas');
const pipCtx = pipCanvas.getContext('2d');
const pipContainer = document.getElementById('cameraPreviewContainer');
const cameraStatus = document.getElementById('cameraStatus');

// Seasons Configuration Palettes
const seasons = [
    {
        name: 'SPRING',
        skyTop: '#aed9e0',     // soft daylight blue
        skyBottom: '#faf3dd',  // soft sunrise peach
        hillFar: '#84a59d',    // distant green hills
        hillFarBottom: '#faf3dd',
        hillNear: '#627c73',   // midground forest trees
        hillNearBottom: '#faf3dd',
        borderHighlight: '#f28482', // cherry blossom coral highlight
        gridColor: 'rgba(98, 124, 115, 0.1)',
        obstacleColor: '#8d99ae',  // slate grey stone pillars
        obstacleHighlight: '#b3c5d7',
        themeClass: 'spring',
        cloudColor: 'rgba(255, 255, 255, 0.55)',
        groundTop: '#95d5b2',      // lush green grass
        groundBottom: '#52b788'
    },
    {
        name: 'SUMMER',
        skyTop: '#caf0f8',     // bright midday blue
        skyBottom: '#ffddd2',  // warm haze
        hillFar: '#e29578',    // distant sand dunes / warm hills
        hillFarBottom: '#ffddd2',
        hillNear: '#e76f51',   // warm midground shrubbery
        hillNearBottom: '#ffddd2',
        borderHighlight: '#f4a261', // sun-baked orange highlight
        gridColor: 'rgba(230, 111, 81, 0.1)',
        obstacleColor: '#e09f67',  // terracotta clay columns
        obstacleHighlight: '#f6bd60',
        themeClass: 'summer',
        cloudColor: 'rgba(255, 255, 255, 0.6)',
        groundTop: '#e9c46a',      // warm sand
        groundBottom: '#ddb892'
    },
    {
        name: 'AUTUMN',
        skyTop: '#f4a261',     // golden sunset orange
        skyBottom: '#264653',  // deep autumn twilight blue
        hillFar: '#e76f51',    // red/orange autumn hills
        hillFarBottom: '#264653',
        hillNear: '#9a031e',   // deep crimson maples
        hillNearBottom: '#264653',
        borderHighlight: '#e76f51',
        gridColor: 'rgba(154, 3, 30, 0.15)',
        obstacleColor: '#5c677d',  // weathered dark granite pillars
        obstacleHighlight: '#7f8c8d',
        themeClass: 'autumn',
        cloudColor: 'rgba(255, 243, 224, 0.4)',
        groundTop: '#b56576',      // rich fallen leaves/soil
        groundBottom: '#6d597a'
    },
    {
        name: 'WINTER',
        skyTop: '#1d3557',     // frozen twilight indigo
        skyBottom: '#f1faee',  // snowy ice-white horizon
        hillFar: '#457b9d',    // distant icy peaks
        hillFarBottom: '#f1faee',
        hillNear: '#2a6f97',   // frozen snow pines
        hillNearBottom: '#f1faee',
        borderHighlight: '#e2ece9',
        gridColor: 'rgba(69, 123, 157, 0.15)',
        obstacleColor: '#a8dadc',  // frosted ice column pillars
        obstacleHighlight: '#ffffff',
        themeClass: 'winter',
        cloudColor: 'rgba(255, 255, 255, 0.3)',
        groundTop: '#ffffff',      // fresh white snow
        groundBottom: '#d8f3dc'
    }
];

let currentSeasonIndex = 0;
let seasonTextTimer = 0;   // ms remaining to display overlay banner
let seasonText = '';       // text to show e.g. "SUMMER SYSTEM ACTIVE"
let weatherParticles = []; // list for seasonal weather particles (leaves, snow, petals)



// DPI High-DPI Display Scaling — full viewport
let logicalWidth = window.innerWidth;
let logicalHeight = window.innerHeight;
let dpr = window.devicePixelRatio || 1;
canvas.width = logicalWidth * dpr;
canvas.height = logicalHeight * dpr;
ctx.scale(dpr, dpr);

function resizeCanvas() {
    logicalWidth = window.innerWidth;
    logicalHeight = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform before re-scaling
    ctx.scale(dpr, dpr);
    initBackgrounds();
    if (gameState !== STATE_PLAYING) draw();
}
window.addEventListener('resize', resizeCanvas);

// System Settings
let difficulty = 'medium';
let selectedSkin = 'classic';
let soundOn = true;
let score = 0;
let bestScore = 0;
let isShieldActive = false;
let activeShieldHits = 0;
let invulnerableTime = 0; // ms remaining of invulnerability
let scorePopups = []; // list of floating "+5" popups

// Physics parameters (configured by difficulty)
const physicsPresets = {
    easy: {
        gravity: 0.35,
        jumpStrength: -6.5,
        pipeSpeed: 2.5,
        pipeGap: 160,
        spawnInterval: 120 // Spacing = 2.5 * 120 = 300px
    },
    medium: {
        gravity: 0.45,
        jumpStrength: -7.5,
        pipeSpeed: 3.5,
        pipeGap: 140,
        spawnInterval: 90  // Spacing = 3.5 * 90 = 315px
    },
    hard: {
        gravity: 0.55,
        jumpStrength: -8.5,
        pipeSpeed: 4.5,
        pipeGap: 120,
        spawnInterval: 70  // Spacing = 4.5 * 70 = 315px
    }
};

let currentPhysics = physicsPresets.medium;

// Skin configurations
const skins = {
    classic: { // Bluebird
        color: '#3a86c8',       // beautiful blue back
        darkColor: '#1d4875',
        wingColor: '#2a6f97',
        wingDarkColor: '#1a4360',
        chestColor: '#e76f51',   // warm orange chest
        beakColor: '#f4a261',
        eyeColor: '#ffffff',
        trailColor: 'rgba(58, 134, 200, 0.25)',
        particleColor: '#3a86c8'
    },
    cyber: { // Cardinal (replacing cyber neon with cardinal red!)
        color: '#d62828',       // cardinal red
        darkColor: '#7a0f12',
        wingColor: '#9e1b1b',
        wingDarkColor: '#5c0d0f',
        chestColor: '#f35b04',   // bright orange chest
        beakColor: '#ffbf00',
        eyeColor: '#ffffff',
        trailColor: 'rgba(214, 40, 40, 0.25)',
        particleColor: '#d62828'
    },
    phoenix: { // Goldfinch (bright yellow!)
        color: '#ffc300',       // goldfinch yellow
        darkColor: '#b58900',
        wingColor: '#212529',   // black wings
        wingDarkColor: '#000000',
        chestColor: '#ffea00',
        beakColor: '#f3a683',
        eyeColor: '#ffffff',
        trailColor: 'rgba(255, 195, 0, 0.25)',
        particleColor: '#ffc300'
    },
    midnight: { // Raven (shadowy violet-black)
        color: '#212529',       // raven black
        darkColor: '#0b0c10',
        wingColor: '#343a40',
        wingDarkColor: '#1c2024',
        chestColor: '#495057',   // dark grey chest
        beakColor: '#212529',
        eyeColor: '#ffffff',
        trailColor: 'rgba(33, 37, 41, 0.25)',
        particleColor: '#212529'
    }
};

// Bird entity
const bird = {
    x: 150,
    y: 350,
    radius: 16,
    velocity: 0,
    rotation: 0,
    flapPhase: 0
};

// Game lists
let pipes = [];
let particles = [];
let frameCount = 0;
let lastTime = 0;
let distanceSinceLastPipe = 0;
let smoothedHandY = null;

// Parallax backgrounds
let bgLayers = {
    stars: [],
    cityFar: [],
    cityNear: [],
    groundX: 0
};

function darkenColor(hex, percent) {
    hex = hex.replace(/^\s*#|\s*$/g, '');
    if(hex.length === 3) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    let r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    r = Math.max(0, Math.floor(r * (1 - percent)));
    g = Math.max(0, Math.floor(g * (1 - percent)));
    b = Math.max(0, Math.floor(b * (1 - percent)));

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Initialize stars & building heights
function initBackgrounds() {
    bgLayers.stars = [];
    // Optimized cloud/star count to 15 to completely fix glitching
    for (let i = 0; i < 15; i++) {
        bgLayers.stars.push({
            x: Math.random() * logicalWidth,
            y: Math.random() * (logicalHeight - 350) + 40,
            size: Math.random() * 1.2 + 0.6,
            speed: Math.random() * 0.05 + 0.02
        });
    }

    bgLayers.cityFar = [];
    let farX = 0;
    while (farX < logicalWidth * 2.5) {
        let w = Math.random() * 60 + 40;
        let h = Math.random() * 180 + 100;
        let hasAntenna = Math.random() < 0.25;
        let antennaH = Math.random() * 15 + 10;
        bgLayers.cityFar.push({ x: farX, w: w, h: h, hasAntenna: hasAntenna, antennaH: antennaH, seed: Math.random() });
        farX += w - 2; // slightly overlap
    }

    bgLayers.cityNear = [];
    let nearX = 0;
    while (nearX < logicalWidth * 2.5) {
        let w = Math.random() * 90 + 60;
        let h = Math.random() * 300 + 180;
        let hasAntenna = Math.random() < 0.35;
        let antennaH = Math.random() * 25 + 15;
        bgLayers.cityNear.push({ x: nearX, w: w, h: h, hasAntenna: hasAntenna, antennaH: antennaH, seed: Math.random() });
        nearX += w - 2;
    }
}

// --- AUDIO SYNTHESIS SYSTEM (Web Audio API) ---
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playJumpSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(750, audioCtx.currentTime + 0.12);
        
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    } catch(e) { console.error(e); }
}

function playScoreSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.08); // A5
        
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime + 0.08);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.16);
    } catch(e) { console.error(e); }
}

function playHitSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(450, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.4);
        
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
    } catch(e) { console.error(e); }
}

function playShieldUpSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.3);
        
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) { console.error(e); }
}

function playShieldBreakSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(900, audioCtx.currentTime);
        osc.frequency.setValueAtTime(1300, audioCtx.currentTime + 0.04);
        osc.frequency.setValueAtTime(350, audioCtx.currentTime + 0.08);
        osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.3);
        
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) { console.error(e); }
}

function playCoinSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(987.77, audioCtx.currentTime); // B5
        osc.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.07); // E6
        
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.07);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    } catch(e) { console.error(e); }
}

function playSeasonShiftSound() {
    if (!soundOn) return;
    try {
        initAudio();
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc1.type = 'triangle';
        osc2.type = 'sawtooth';
        
        // Ascending retro shift chime
        osc1.frequency.setValueAtTime(261.63, audioCtx.currentTime); // C4
        osc1.frequency.exponentialRampToValueAtTime(523.25, audioCtx.currentTime + 0.12); // C5
        osc1.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.24); // C6
        
        osc2.frequency.setValueAtTime(196.00, audioCtx.currentTime); // G3
        osc2.frequency.exponentialRampToValueAtTime(392.00, audioCtx.currentTime + 0.12); // G4
        osc2.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.24); // G5
        
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        
        osc1.start();
        osc2.start();
        
        osc1.stop(audioCtx.currentTime + 0.3);
        osc2.stop(audioCtx.currentTime + 0.3);
    } catch(e) { console.error(e); }
}

// --- PARTICLE SYSTEM ---
class Particle {
    constructor(x, y, vx, vy, size, color, alpha, decay, shape = 'circle') {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.size = size;
        this.color = color;
        this.alpha = alpha;
        this.decay = decay;
        this.shape = shape;
        this.angle = Math.random() * Math.PI * 2;
        this.spin = Math.random() * 0.04 - 0.02;
    }

    update(dt = 1.0) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.alpha -= this.decay * dt;
        this.angle += this.spin * dt;
        
        // Apply drift to weather particles
        if (this.shape === 'snowflake') {
            this.x += Math.sin(this.angle) * 0.2 * dt;
        } else if (this.shape === 'petal') {
            this.x += (Math.sin(this.angle) * 0.4 - 0.25) * dt;
        } else if (this.shape === 'leaf') {
            this.x += Math.sin(this.angle) * 0.3 * dt;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = (this.shape === 'snowflake' || this.shape === 'star') ? 8 : 0;
        ctx.shadowColor = this.color;

        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.beginPath();
        if (this.shape === 'star') {
            drawStarPath(ctx, 0, 0, 5, this.size, this.size / 2);
            ctx.fill();
        } else if (this.shape === 'petal') {
            // Soft cherry blossom petal shape
            ctx.ellipse(0, 0, this.size * 1.4, this.size * 0.9, 0, 0, Math.PI * 2);
            ctx.fill();
            // Muted pink inner shade
            ctx.fillStyle = '#ff85a2';
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size * 0.7, this.size * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.shape === 'leaf') {
            // Pointy falling leaf shape
            ctx.moveTo(0, -this.size * 1.3);
            ctx.quadraticCurveTo(this.size, -this.size * 0.4, this.size, 0);
            ctx.quadraticCurveTo(this.size * 0.4, this.size * 0.7, 0, this.size * 1.3);
            ctx.quadraticCurveTo(-this.size * 0.4, this.size * 0.7, -this.size, 0);
            ctx.quadraticCurveTo(-this.size, -this.size * 0.4, 0, -this.size * 1.3);
            ctx.closePath();
            ctx.fill();
        } else if (this.shape === 'snowflake') {
            // 6-point snowflake cross lines
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.2;
            for (let k = 0; k < 3; k++) {
                ctx.beginPath();
                ctx.moveTo(0, -this.size);
                ctx.lineTo(0, this.size);
                ctx.stroke();
                ctx.rotate(Math.PI / 3);
            }
        } else {
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawStarPath(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
}

function createExplosion(x, y, color, count = 20, isStar = false) {
    for (let i = 0; i < count; i++) {
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * 4 + 1.5;
        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;
        let size = Math.random() * 4 + 2;
        let decay = Math.random() * 0.02 + 0.015;
        particles.push(new Particle(
            x, y, vx, vy, size, color, 1.0, decay, isStar ? 'star' : 'circle'
        ));
    }
}

// --- GLOBAL LEADERBOARD SYSTEM ---
let pilotName = "";
let cachedLeaderboard = [];

function getLeaderboard() {
    return cachedLeaderboard;
}

async function fetchGlobalLeaderboard() {
    try {
        const response = await fetch('/api/leaderboard', { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                cachedLeaderboard = data;
                renderLeaderboardList();
            }
        }
    } catch (e) {
        console.error("Error fetching global leaderboard:", e);
    }
}

async function saveLeaderboardScore(name, scoreVal, diff) {
    try {
        const response = await fetch('/api/score', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name.toUpperCase().slice(0, 25), score: scoreVal, difficulty: diff }),
            cache: 'no-store'
        });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                cachedLeaderboard = data;
                renderLeaderboardList();
            }
        }
    } catch (e) {
        console.error("Error submitting score:", e);
    }
}

function checkHighScoreEligibility(scoreVal) {
    let board = getLeaderboard();
    if (board.length < 10) return true; // Show top 10 on global board
    return scoreVal > board[board.length - 1].score;
}

function renderLeaderboardList() {
    let board = getLeaderboard();
    
    // 1. Render game over screen list
    const container = document.getElementById('leaderboardList');
    if (container) {
        container.innerHTML = '';
        board.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = `leaderboard-item rank-${index + 1}`;
            row.innerHTML = `
                <span>#${index + 1} ${item.name} (${item.difficulty.toUpperCase()})</span>
                <span>${item.score}</span>
            `;
            container.appendChild(row);
        });
    }

    // 2. Render start screen menu list
    const startContainer = document.getElementById('startLeaderboardList');
    if (startContainer) {
        startContainer.innerHTML = '';
        board.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = `leaderboard-item rank-${index + 1}`;
            row.innerHTML = `
                <span>#${index + 1} ${item.name} (${item.difficulty.toUpperCase()})</span>
                <span>${item.score}</span>
            `;
            startContainer.appendChild(row);
        });
    }
}

// --- GAME LOGIC FUNCTIONS ---

function jump() {
    if (gameState !== STATE_PLAYING) return;
    bird.velocity = currentPhysics.jumpStrength;
    playJumpSound();
    
    // Spawn jump dust particles
    const skinInfo = skins[selectedSkin];
    for (let i = 0; i < 4; i++) {
        particles.push(new Particle(
            bird.x - bird.radius,
            bird.y + (Math.random() * 10 - 5),
            -Math.random() * 2 - 1,
            Math.random() * 1.5 - 0.75,
            Math.random() * 3 + 2,
            skinInfo.particleColor,
            0.8,
            0.03
        ));
    }
}

function createPipe() {
    const gap = currentPhysics.pipeGap;
    const minHeight = 60;
    const maxHeight = logicalHeight - 150 - gap - minHeight;
    const topHeight = Math.floor(Math.random() * (maxHeight - minHeight)) + minHeight;
    const bottomHeight = logicalHeight - 150 - gap - topHeight;

    // Check if we spawn a power-up in the middle
    let powerupType = null;
    let powerupY = 0;
    
    // 25% chance of spawning power-up if score > 3
    if (score > 3 && Math.random() < 0.25) {
        // If shield is already active, spawn a coin, otherwise 50% coin, 50% shield
        if (isShieldActive) {
            powerupType = 'star';
        } else {
            powerupType = Math.random() < 0.5 ? 'shield' : 'star';
        }
        powerupY = topHeight + gap / 2;
    }

    pipes.push({
        x: logicalWidth + 60,
        topHeight: topHeight,
        bottomHeight: bottomHeight,
        gap: gap,
        passed: false,
        powerupType: powerupType,
        powerupY: powerupY,
        powerupCollected: false,
        floatOffset: Math.random() * Math.PI * 2 // for floating animation
    });
}

function resetGame() {
    score = 0;
    document.getElementById('score').innerText = '0';
    bird.y = 250;
    bird.velocity = 0;
    bird.rotation = 0;
    pipes = [];
    particles = [];
    scorePopups = [];
    isShieldActive = false;
    activeShieldHits = 0;
    invulnerableTime = 0;
    document.getElementById('shieldHud').classList.remove('active');
    frameCount = 0;

    // Load best score
    let board = getLeaderboard();
    bestScore = board.length > 0 ? board[0].score : 0;
    
    // Configure physics preset
    currentPhysics = physicsPresets[difficulty];
    
    // Spawn first pipe at starting offset (initial headroom)
    distanceSinceLastPipe = currentPhysics.pipeSpeed * currentPhysics.spawnInterval * 0.55;
    
    // Pre-populate some scrolling building logic
    initBackgrounds();

    // Reset Seasons and Hand smoothing variables
    currentSeasonIndex = 0;
    seasonTextTimer = 0;
    seasonText = '';
    weatherParticles = [];
    smoothedHandY = null;
}

function triggerGameOver() {
    gameState = STATE_GAMEOVER;
    playHitSound();

    // Explosion
    createExplosion(bird.x, bird.y, skins[selectedSkin].particleColor, 35);
    createExplosion(bird.x, bird.y, '#ffffff', 15);

    // Save and render UI
    document.getElementById('finalScore').innerText = score;
    
    // Highscore record
    let records = getLeaderboard();
    let currentBest = records.length > 0 ? records[0].score : 0;
    if (score > currentBest) {
        bestScore = score;
        document.getElementById('bestScore').innerText = score + ' (NEW RECORD!)';
        document.getElementById('bestScore').style.color = 'var(--neon-green)';
    } else {
        document.getElementById('bestScore').innerText = currentBest;
        document.getElementById('bestScore').style.color = 'var(--neon-yellow)';
    }

    document.getElementById('statLevel').innerText = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

    // Show game over overlay
    document.getElementById('gameOverOverlay').classList.add('active');
    
    // Automatically submit score on Game Over
    if (pilotName && score >= 0) {
        saveLeaderboardScore(pilotName, score, difficulty);
    } else {
        fetchGlobalLeaderboard();
    }
}

// --- UPDATE & DRAW ---

function update(deltaTime) {
    if (gameState !== STATE_PLAYING) return;

    frameCount++;

    let dt = deltaTime / 16.67;

    // Calculate speed boost based on score: +0.5 speed for every 10 points (increased difficulty!)
    let speedBoost = Math.floor(score / 10) * 0.5;
    let activePipeSpeed = currentPhysics.pipeSpeed + speedBoost;

    // Invulnerability timer
    if (invulnerableTime > 0) {
        invulnerableTime -= deltaTime;
    }

    // Seasons State Calculations (Every 15 points)
    let calculatedSeason = Math.floor(score / 15) % 4;
    if (calculatedSeason !== currentSeasonIndex) {
        currentSeasonIndex = calculatedSeason;
        const sName = seasons[currentSeasonIndex].name;
        seasonText = `${sName} SYSTEM ACTIVE`;
        seasonTextTimer = 2500; // Display banner for 2.5 seconds
        playSeasonShiftSound();
        
        // Flashy particle blast in center
        createExplosion(logicalWidth / 2, logicalHeight / 2, seasons[currentSeasonIndex].neonLine, 35);
    }

    if (seasonTextTimer > 0) {
        seasonTextTimer -= deltaTime;
    }

    // Update weather particles
    for (let i = weatherParticles.length - 1; i >= 0; i--) {
        weatherParticles[i].update(dt);
        if (weatherParticles[i].y > logicalHeight || weatherParticles[i].alpha <= 0 || weatherParticles[i].x < -50 || weatherParticles[i].x > logicalWidth + 100) {
            weatherParticles.splice(i, 1);
        }
    }

    // Spawn weather particles based on season
    if (frameCount % 6 === 0) {
        if (currentSeasonIndex === 0) { // Spring
            // Pink petals drifting down-left from top/right
            let rx = Math.random() * (logicalWidth + 80);
            let ry = -10;
            let size = Math.random() * 3 + 2;
            let decay = Math.random() * 0.004 + 0.002;
            weatherParticles.push(new Particle(
                rx, ry, -1.0 - Math.random() * 0.8, 1.2 + Math.random() * 1.0, size, '#ffb7b2', 0.9, decay, 'petal'
            ));
        } else if (currentSeasonIndex === 1) { // Summer
            // Golden sun sparks rising from bottom grid
            let rx = Math.random() * logicalWidth;
            let ry = logicalHeight - 150 + Math.random() * 150;
            let size = Math.random() * 2 + 1;
            let decay = Math.random() * 0.015 + 0.01;
            weatherParticles.push(new Particle(
                rx, ry, Math.random() * 0.8 - 0.4, -0.8 - Math.random() * 1.2, size, '#ffb703', 0.8, decay, 'star'
            ));
        } else if (currentSeasonIndex === 2) { // Autumn
            // Maple leaves drifting down from top
            let rx = Math.random() * logicalWidth;
            let ry = -15;
            let size = Math.random() * 4 + 2.5;
            let decay = Math.random() * 0.005 + 0.002;
            weatherParticles.push(new Particle(
                rx, ry, Math.random() * 0.6 - 0.3, 0.9 + Math.random() * 1.0, size, '#fcbf49', 0.9, decay, 'leaf'
            ));
        } else if (currentSeasonIndex === 3) { // Winter
            // White snow falling from top
            let rx = Math.random() * logicalWidth;
            let ry = -10;
            let size = Math.random() * 2.5 + 1.5;
            let decay = Math.random() * 0.007 + 0.003;
            weatherParticles.push(new Particle(
                rx, ry, Math.random() * 0.5 - 0.25, 0.7 + Math.random() * 0.9, size, '#ffffff', 0.9, decay, 'snowflake'
            ));
        }
    }

    // Bird movement & control system branching
    if (controlMethod === 'motion') {
        bird.velocity = 0;
        if (handY !== null) {
            // Stage 1: Butter-smooth raw hand position to filter high-frequency tremor/noise
            if (smoothedHandY === null) {
                smoothedHandY = handY;
            } else {
                let handSmoothFactor = 1 - Math.exp(-0.08 * dt); // slow, stable filter
                smoothedHandY += (handY - smoothedHandY) * handSmoothFactor;
            }

            // Map hand vertical space [0.25, 0.75] to screen [0.0, 1.0] for optimal range
            let normY = (smoothedHandY - 0.25) / 0.50;
            normY = Math.max(0, Math.min(1, normY));
            
            const targetY = normY * (logicalHeight - 150 - bird.radius * 2) + bird.radius;
            
            // Stage 2: Exponential decay glide to eliminate 30Hz camera frame-rate step-jitter
            let birdSmoothFactor = 1 - Math.exp(-0.16 * dt); // responsive, fluid glide
            let diff = targetY - bird.y;
            bird.y += diff * birdSmoothFactor;
            
            // Dynamic rotation based on movement speed
            bird.rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 7, diff * 0.05));
            bird.flapPhase += 0.25 * dt;
        }
    } else {
        bird.velocity += currentPhysics.gravity * dt;
        bird.y += bird.velocity * dt;
        bird.rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 7, bird.velocity * 0.05));
        bird.flapPhase += 0.25 * dt;
    }

    // Top and bottom boundaries
    if (bird.y + bird.radius < 0) {
        bird.y = -bird.radius;
        bird.velocity = 0;
    }

    if (bird.y + bird.radius >= logicalHeight - 150) {
        triggerGameOver();
        return;
    }

    // Update floating score popups
    for (let i = scorePopups.length - 1; i >= 0; i--) {
        let p = scorePopups[i];
        p.y -= 1.5 * dt;
        p.alpha -= 0.02 * dt;
        if (p.alpha <= 0) {
            scorePopups.splice(i, 1);
        }
    }

    // Emit trail particles
    const skinInfo = skins[selectedSkin];
    if (frameCount % 2 === 0) {
        particles.push(new Particle(
            bird.x - bird.radius + 2,
            bird.y + Math.sin(bird.flapPhase) * 4,
            -activePipeSpeed * 0.7,
            Math.random() * 0.8 - 0.4,
            Math.random() * 3 + 2,
            isShieldActive ? '#00f0ff' : skinInfo.trailColor,
            0.6,
            0.02
        ));
    }

    // Spawn pipes based on physical distance traveled (completely micro-stutter free)
    let targetDistance = currentPhysics.pipeSpeed * currentPhysics.spawnInterval;
    distanceSinceLastPipe += activePipeSpeed * dt;
    if (distanceSinceLastPipe >= targetDistance) {
        createPipe();
        distanceSinceLastPipe -= targetDistance; // retain sub-pixel remainder for precision
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
        let p = pipes[i];
        p.x -= activePipeSpeed * dt;

        // Collectibles check
        if (p.powerupType && !p.powerupCollected) {
            // Float powerup y position
            let currentPowerupY = p.powerupY + Math.sin(frameCount * 0.08 + p.floatOffset) * 8;
            
            // Distance checking
            let dx = bird.x - p.x;
            let dy = bird.y - currentPowerupY;
            let dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < bird.radius + 15) {
                // Collect power-up!
                p.powerupCollected = true;
                if (p.powerupType === 'shield') {
                    isShieldActive = true;
                    activeShieldHits = 1;
                    document.getElementById('shieldHud').classList.add('active');
                    playShieldUpSound();
                    createExplosion(p.x, currentPowerupY, '#00f0ff', 15);
                } else if (p.powerupType === 'star') {
                    score += 5;
                    document.getElementById('score').innerText = score;
                    playCoinSound();
                    createExplosion(p.x, currentPowerupY, '#ffb703', 20, true);
                    scorePopups.push({
                        x: p.x,
                        y: currentPowerupY - 20,
                        text: '+5',
                        alpha: 1.0,
                        color: 'var(--neon-yellow)'
                    });
                }
            }
        }

        // Collision checking
        if (invulnerableTime <= 0) {
            const birdLeft = bird.x - bird.radius;
            const birdRight = bird.x + bird.radius;
            const birdTop = bird.y - bird.radius;
            const birdBottom = bird.y + bird.radius;

            const pipeLeft = p.x;
            const pipeRight = p.x + 60; // pipe width
            const pipeTopBoundary = p.topHeight;
            const pipeBottomBoundary = logicalHeight - 150 - p.bottomHeight;

            // Simple box-circle collision
            if (birdRight > pipeLeft && birdLeft < pipeRight) {
                if (birdTop < pipeTopBoundary || birdBottom > pipeBottomBoundary) {
                    if (isShieldActive) {
                        // Shield Break!
                        isShieldActive = false;
                        activeShieldHits = 0;
                        invulnerableTime = 1500; // 1.5s invulnerable
                        document.getElementById('shieldHud').classList.remove('active');
                        playShieldBreakSound();
                        createExplosion(bird.x, bird.y, '#00f0ff', 30);
                    } else {
                        // Dead
                        triggerGameOver();
                        return;
                    }
                }
            }
        }

        // Passed pipe check
        if (!p.passed && p.x + 60 < bird.x) {
            p.passed = true;
            score += 1;
            document.getElementById('score').innerText = score;
            playScoreSound();
        }

        // Remove out-of-screen pipes
        if (p.x < -70) {
            pipes.splice(i, 1);
        }
    }

    // Scroll Background Layers
    bgLayers.stars.forEach(s => {
        s.x -= s.speed * dt;
        if (s.x < 0) s.x = logicalWidth;
    });

    // City far scrolling
    bgLayers.cityFar.forEach(b => {
        b.x -= activePipeSpeed * 0.05 * dt;
    });
    while (bgLayers.cityFar.length > 0 && bgLayers.cityFar[0].x + bgLayers.cityFar[0].w < 0) {
        let first = bgLayers.cityFar.shift();
        let last = bgLayers.cityFar[bgLayers.cityFar.length - 1];
        first.x = last.x + last.w - 2;
        bgLayers.cityFar.push(first);
    }

    // City near scrolling
    bgLayers.cityNear.forEach(b => {
        b.x -= activePipeSpeed * 0.15 * dt;
    });
    while (bgLayers.cityNear.length > 0 && bgLayers.cityNear[0].x + bgLayers.cityNear[0].w < 0) {
        let first = bgLayers.cityNear.shift();
        let last = bgLayers.cityNear[bgLayers.cityNear.length - 1];
        first.x = last.x + last.w - 2;
        bgLayers.cityNear.push(first);
    }

    // Ground scrolling
    bgLayers.groundX -= activePipeSpeed * dt;
    if (bgLayers.groundX <= -40) {
        bgLayers.groundX += 40;
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(dt);
        if (particles[i].alpha <= 0) {
            particles.splice(i, 1);
        }
    }
}

function drawCloud(ctx, cx, cy, scale, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 15 * scale, 0, Math.PI * 2);
    ctx.arc(cx + 10 * scale, cy - 5 * scale, 12 * scale, 0, Math.PI * 2);
    ctx.arc(cx - 10 * scale, cy - 3 * scale, 10 * scale, 0, Math.PI * 2);
    ctx.arc(cx + 20 * scale, cy + 2 * scale, 8 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const activeSeason = seasons[currentSeasonIndex];

    // 1. SKY GRADIENT (Seasonal)
    let skyGrad = ctx.createLinearGradient(0, 0, 0, logicalHeight);
    skyGrad.addColorStop(0, activeSeason.skyTop);
    skyGrad.addColorStop(1, activeSeason.skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // 2. STARS OR CLOUDS (Seasonal)
    if (currentSeasonIndex === 3) { // Winter stars
        ctx.fillStyle = activeSeason.starColor;
        bgLayers.stars.forEach(s => {
            ctx.globalAlpha = s.speed * 8;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1.0;
    } else { // Drifting clouds
        bgLayers.stars.forEach(s => {
            drawCloud(ctx, s.x, s.y, s.size * 0.7, activeSeason.cloudColor);
        });
    }

    // 3. FAR MOUNTAINS/HILLS (Seasonal)
    bgLayers.cityFar.forEach(b => {
        let drawX = Math.floor(b.x);
        let drawW = Math.ceil(b.w);
        
        let hillGrad = ctx.createLinearGradient(0, logicalHeight - 150 - b.h, 0, logicalHeight - 150);
        hillGrad.addColorStop(0, activeSeason.hillFar);
        hillGrad.addColorStop(1, activeSeason.hillFarBottom);
        ctx.fillStyle = hillGrad;
        
        // Draw smooth rolling hills using ellipse
        ctx.beginPath();
        ctx.ellipse(drawX + drawW / 2, logicalHeight - 150, drawW * 1.6, b.h, 0, Math.PI, Math.PI * 2);
        ctx.fill();
    });

    // 4. NEAR TREES/FOREST (Seasonal)
    bgLayers.cityNear.forEach(b => {
        let drawX = Math.floor(b.x);
        let drawW = Math.ceil(b.w);
        let treeY = logicalHeight - 150 - b.h;

        let treeGrad = ctx.createLinearGradient(0, treeY, 0, logicalHeight - 150);
        treeGrad.addColorStop(0, activeSeason.hillNear);
        treeGrad.addColorStop(1, activeSeason.hillNearBottom);
        
        // A. Draw organic tree trunk
        ctx.fillStyle = '#4a3b32'; // natural brown
        ctx.fillRect(drawX + drawW / 2 - 3, treeY, 6, b.h);

        // B. Draw seasonal foliage
        ctx.fillStyle = treeGrad;
        if (currentSeasonIndex === 3) { // Winter snow pine (Triangle tree)
            ctx.beginPath();
            ctx.moveTo(drawX + drawW / 2, treeY - 10);
            ctx.lineTo(drawX + drawW / 2 - drawW / 3, treeY + b.h);
            ctx.lineTo(drawX + drawW / 2 + drawW / 3, treeY + b.h);
            ctx.closePath();
            ctx.fill();
            
            // Snow cap on pine
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(drawX + drawW / 2, treeY - 10);
            ctx.lineTo(drawX + drawW / 2 - drawW / 6, treeY + b.h * 0.3);
            ctx.lineTo(drawX + drawW / 2 + drawW / 6, treeY + b.h * 0.3);
            ctx.closePath();
            ctx.fill();
        } else { // Spring / Summer / Autumn fluffy deciduous trees
            ctx.beginPath();
            ctx.arc(drawX + drawW / 2, treeY + 5, drawW / 3, 0, Math.PI * 2);
            ctx.arc(drawX + drawW / 2 - 12, treeY + 12, drawW / 4, 0, Math.PI * 2);
            ctx.arc(drawX + drawW / 2 + 12, treeY + 12, drawW / 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Soft blossom highlight for spring
            if (currentSeasonIndex === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.beginPath();
                ctx.arc(drawX + drawW / 2 - 4, treeY + 2, drawW / 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });

    // 4.5 WEATHER PARTICLES (Cherry blossoms, leaves, snow, etc.)
    weatherParticles.forEach(wp => wp.draw(ctx));

    pipes.forEach(p => {
        const topY = p.topHeight;
        const bottomY = logicalHeight - 150 - p.bottomHeight;
        
        // Volumetric 3D Cylinder stone Column Gradient
        let pipeGrad = ctx.createLinearGradient(p.x, 0, p.x + 60, 0);
        pipeGrad.addColorStop(0, darkenColor(activeSeason.obstacleColor, 0.45));
        pipeGrad.addColorStop(0.3, activeSeason.obstacleColor);
        pipeGrad.addColorStop(0.5, activeSeason.obstacleHighlight);
        pipeGrad.addColorStop(0.7, activeSeason.obstacleColor);
        pipeGrad.addColorStop(1, darkenColor(activeSeason.obstacleColor, 0.55));

        let capGrad = ctx.createLinearGradient(p.x - 4, 0, p.x + 64, 0);
        capGrad.addColorStop(0, darkenColor(activeSeason.obstacleColor, 0.35));
        capGrad.addColorStop(0.3, activeSeason.obstacleColor);
        capGrad.addColorStop(0.5, activeSeason.obstacleHighlight);
        capGrad.addColorStop(0.7, activeSeason.obstacleColor);
        capGrad.addColorStop(1, darkenColor(activeSeason.obstacleColor, 0.45));

        ctx.fillStyle = pipeGrad;

        ctx.save();
        // Drop shadow for natural depth
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';

        // Draw top pipe
        ctx.fillRect(p.x, 0, 60, topY);
        
        // Draw top cap
        ctx.fillStyle = capGrad;
        ctx.fillRect(p.x - 4, topY - 25, 68, 25);
        ctx.strokeStyle = darkenColor(activeSeason.obstacleColor, 0.5);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 4, topY - 25, 68, 25);

        // Draw bottom pipe
        ctx.fillStyle = pipeGrad;
        ctx.fillRect(p.x, bottomY, 60, p.bottomHeight);
        
        // Draw bottom cap
        ctx.fillStyle = capGrad;
        ctx.fillRect(p.x - 4, bottomY, 68, 25);
        ctx.strokeStyle = darkenColor(activeSeason.obstacleColor, 0.5);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 4, bottomY, 68, 25);

        ctx.restore();

        // Horizontal brick joints for stone column realism
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.lineWidth = 1;
        for (let jy = 30; jy < topY - 25; jy += 30) {
            ctx.beginPath();
            ctx.moveTo(p.x, jy);
            ctx.lineTo(p.x + 60, jy);
            ctx.stroke();
        }
        for (let jy = bottomY + 30; jy < logicalHeight - 150 - 30; jy += 30) {
            ctx.beginPath();
            ctx.moveTo(p.x, jy);
            ctx.lineTo(p.x + 60, jy);
            ctx.stroke();
        }

        // Draw collectibles if present
        if (p.powerupType && !p.powerupCollected) {
            let currentPowerupY = p.powerupY + Math.sin(frameCount * 0.08 + p.floatOffset) * 8;
            ctx.save();
            ctx.shadowBlur = 15;
            
            if (p.powerupType === 'shield') {
                ctx.shadowColor = '#00f0ff';
                ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                
                // Draw shield sphere
                ctx.beginPath();
                ctx.arc(p.x + 30, currentPowerupY, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Draw central symbol
                ctx.beginPath();
                ctx.arc(p.x + 30, currentPowerupY, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            } else if (p.powerupType === 'star') {
                ctx.shadowColor = '#ffb703';
                ctx.fillStyle = '#ffb703';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                
                ctx.beginPath();
                drawStarPath(ctx, p.x + 30, currentPowerupY, 5, 12, 5);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    });

    // 6. PARTICLES
    particles.forEach(p => p.draw(ctx));

    // 7. BIRD (Realistic Volumetric Bird)
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);

    // Flashing effect if invulnerable
    let drawBird = true;
    if (invulnerableTime > 0) {
        drawBird = Math.floor(invulnerableTime / 100) % 2 === 0;
    }

    const skinInfo = skins[selectedSkin];

    if (drawBird) {
        // A. 3D Spherical Body Gradient
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        let bodyGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, bird.radius);
        bodyGrad.addColorStop(0, '#ffffff'); // shiny light reflection
        bodyGrad.addColorStop(0.3, skinInfo.color);
        bodyGrad.addColorStop(1, skinInfo.darkColor);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // B. Organic Chest Patch
        ctx.fillStyle = skinInfo.chestColor;
        ctx.beginPath();
        ctx.arc(3, 4, bird.radius * 0.65, -Math.PI / 4, Math.PI * 0.7);
        ctx.closePath();
        ctx.fill();

        // C. Eye (Natural black pupil with white highlight reflection)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(6, -4, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1f24';
        ctx.beginPath();
        ctx.arc(7, -4, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(6.2, -4.8, 0.8, 0, Math.PI * 2);
        ctx.fill();

        // D. Curved Natural Beak
        let beakGrad = ctx.createLinearGradient(bird.radius - 2, 0, bird.radius + 8, 2);
        beakGrad.addColorStop(0, skinInfo.beakColor);
        beakGrad.addColorStop(1, darkenColor(skinInfo.beakColor, 0.3));
        ctx.fillStyle = beakGrad;
        ctx.beginPath();
        ctx.moveTo(bird.radius - 3, -2);
        ctx.quadraticCurveTo(bird.radius + 3, 0, bird.radius + 8, 2);
        ctx.quadraticCurveTo(bird.radius + 1, 5, bird.radius - 3, 4);
        ctx.closePath();
        ctx.fill();

        // E. Layered Feather Wings
        ctx.save();
        ctx.translate(-3, 1);
        let flapRotation = Math.sin(bird.flapPhase) * 0.5;
        ctx.rotate(flapRotation);
        
        // Wing shadow
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(-1, 1, 12, 7, -Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Main Wing
        let wingGrad = ctx.createLinearGradient(0, -8, 0, 8);
        wingGrad.addColorStop(0, skinInfo.wingColor);
        wingGrad.addColorStop(1, skinInfo.wingDarkColor);
        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 7, -Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Feather lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5, -2);
        ctx.quadraticCurveTo(0, -1, 5, -2);
        ctx.moveTo(-4, 1);
        ctx.quadraticCurveTo(0, 2, 6, 1);
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();

    // Draw active Shield overlay around bird (natural blue bubble)
    if (isShieldActive) {
        ctx.save();
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(74, 144, 226, 0.08)';
        
        ctx.beginPath();
        let pulseSize = bird.radius + 8 + Math.sin(frameCount * 0.1) * 2;
        ctx.arc(bird.x, bird.y, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // 8. SCORE POPUPS
    scorePopups.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.font = 'bold 16px "Orbitron"';
        ctx.shadowBlur = 5;
        ctx.shadowColor = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    });

    // 9. NATURAL SOIL AND VEGETATION GROUND
    let floorY = logicalHeight - 150;
    
    // Draw organic base soil (dark rich earth brown)
    let floorGrad = ctx.createLinearGradient(0, floorY, 0, logicalHeight);
    floorGrad.addColorStop(0, '#5c4033'); 
    floorGrad.addColorStop(1, '#2c1e18');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, floorY, logicalWidth, 150);

    // Draw volumetric grass/sand/snow surface layer
    ctx.fillStyle = activeSeason.groundTop;
    ctx.fillRect(0, floorY, logicalWidth, 12);
    ctx.fillStyle = activeSeason.groundBottom;
    ctx.fillRect(0, floorY + 12, logicalWidth, 6);

    // Small organic blades / bumps along the surface
    ctx.fillStyle = activeSeason.groundTop;
    ctx.beginPath();
    for (let gx = 0; gx < logicalWidth; gx += 8) {
        let h = 4 + Math.sin(gx * 0.1) * 3;
        ctx.moveTo(gx, floorY);
        ctx.lineTo(gx + 3, floorY - h);
        ctx.lineTo(gx + 6, floorY);
    }
    ctx.closePath();
    ctx.fill();

    // Flat borders replacement (natural divider)
    ctx.save();
    ctx.strokeStyle = activeSeason.borderHighlight;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(logicalWidth, floorY);
    ctx.stroke();
    ctx.restore();

    // 10. SEASON SHIFT BANNER
    if (seasonTextTimer > 0) {
        ctx.save();
        let alpha = Math.min(1.0, seasonTextTimer / 500);
        ctx.globalAlpha = alpha;
        
        // Clean horizontal dark card banner
        ctx.fillStyle = 'rgba(24, 28, 36, 0.9)';
        ctx.fillRect(0, logicalHeight / 2 - 40, logicalWidth, 80);
        
        // Sleek clean boundaries (no neon glow)
        ctx.strokeStyle = activeSeason.borderHighlight;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, logicalHeight / 2 - 40);
        ctx.lineTo(logicalWidth, logicalHeight / 2 - 40);
        ctx.moveTo(0, logicalHeight / 2 + 40);
        ctx.lineTo(logicalWidth, logicalHeight / 2 + 40);
        ctx.stroke();
        
        // Modern clean text banner (Outfit font)
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 1.3rem "Outfit"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seasonText, logicalWidth / 2, logicalHeight / 2);
        ctx.restore();
    }
}

// --- GAME LOOP ---
function gameLoop(time) {
    if (lastTime === 0) lastTime = time;
    let deltaTime = time - lastTime;
    lastTime = time;

    // Cap deltaTime to avoid massive jumps on lag
    if (deltaTime > 100) deltaTime = 100;

    update(deltaTime);
    draw();

    if (gameState === STATE_PLAYING) {
        requestAnimationFrame(gameLoop);
    }
}

// --- EVENT HANDLERS & INITIALIZATION ---

function startGame() {
    const nameInput = document.getElementById('playerNameInput');
    const nameVal = nameInput ? nameInput.value.trim() : "";
    
    if (!nameVal) {
        document.getElementById('startOverlay').classList.add('active');
        if (nameInput) {
            nameInput.classList.add('error');
            playHitSound();
            setTimeout(() => nameInput.classList.remove('error'), 300);
            nameInput.focus();
        }
        return;
    }
    
    pilotName = nameVal;
    localStorage.setItem('neon_flappy_player_name', nameVal);

    initAudio();
    resetGame();
    gameState = STATE_PLAYING;
    
    // Hide start/gameover overlays
    document.getElementById('startOverlay').classList.remove('active');
    document.getElementById('gameOverOverlay').classList.remove('active');
    document.getElementById('pauseOverlay').classList.remove('active');

    // Trigger initial jump
    bird.velocity = currentPhysics.jumpStrength;

    lastTime = 0;
    requestAnimationFrame(gameLoop);
}

function pauseGame() {
    if (gameState !== STATE_PLAYING) return;
    gameState = STATE_PAUSED;
    document.getElementById('pauseOverlay').classList.add('active');
}

function resumeGame() {
    if (gameState !== STATE_PAUSED) return;
    gameState = STATE_PLAYING;
    document.getElementById('pauseOverlay').classList.remove('active');
    
    lastTime = 0;
    requestAnimationFrame(gameLoop);
}

function toggleSound() {
    soundOn = !soundOn;
    localStorage.setItem('neon_flappy_sound', soundOn ? 'on' : 'off');
    
    const svg = document.querySelector('#soundToggle svg');
    if (soundOn) {
        svg.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        `;
    } else {
        svg.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
        `;
    }
}

// Bind controls
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault(); // prevent scrolling
        if (gameState === STATE_PLAYING) {
            jump();
        } else if (gameState === STATE_START) {
            startGame();
        } else if (gameState === STATE_PAUSED) {
            resumeGame();
        } else if (gameState === STATE_GAMEOVER) {
            // Check if name input has focus, do not restart
            if (document.activeElement !== document.getElementById('pilotInput')) {
                startGame();
            }
        }
    }
    
    if (e.key === 'p' || e.key === 'P') {
        if (gameState === STATE_PLAYING) {
            pauseGame();
        } else if (gameState === STATE_PAUSED) {
            resumeGame();
        }
    }
});

// Canvas touch/mouse controls
const handleInteraction = (e) => {
    // Check if clicked buttons or overlay links
    if (e.target.closest('.hud-btn') || e.target.closest('.overlay') || e.target.closest('#newRecordUI')) {
        return;
    }
    
    if (gameState === STATE_PLAYING) {
        jump();
    } else if (gameState === STATE_START) {
        startGame();
    } else if (gameState === STATE_PAUSED) {
        resumeGame();
    }
};

canvas.addEventListener('mousedown', handleInteraction);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // prevent double triggers on mobile
    handleInteraction(e);
}, { passive: false });

// Sound Toggle click
document.getElementById('soundToggle').onclick = (e) => {
    e.stopPropagation();
    toggleSound();
};

// Pause Toggle click
document.getElementById('pauseBtn').onclick = (e) => {
    e.stopPropagation();
    if (gameState === STATE_PLAYING) {
        pauseGame();
    } else if (gameState === STATE_PAUSED) {
        resumeGame();
    }
};

// Start System button click
document.getElementById('playBtn').onclick = (e) => {
    e.stopPropagation();
    startGame();
};

// Resume button click
document.getElementById('resumeBtn').onclick = (e) => {
    e.stopPropagation();
    resumeGame();
};

// Reboot system click
document.getElementById('restartBtn').onclick = (e) => {
    e.stopPropagation();
    startGame();
};

// Change Pilot button click
document.getElementById('changePilotBtn').onclick = (e) => {
    e.stopPropagation();
    gameState = STATE_START;
    document.getElementById('gameOverOverlay').classList.remove('active');
    document.getElementById('startOverlay').classList.add('active');
    const nameInput = document.getElementById('playerNameInput');
    if (nameInput) {
        nameInput.focus();
    }
};

// Selection clicks (Difficulty & Skins)
document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        difficulty = btn.getAttribute('data-diff');
        currentPhysics = physicsPresets[difficulty];
    };
});

document.querySelectorAll('.skin-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSkin = btn.getAttribute('data-skin');
    };
});

// Control selector bindings
document.querySelectorAll('.control-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.control-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        controlMethod = btn.getAttribute('data-control');
        
        if (controlMethod === 'motion') {
            document.getElementById('keyboardInstruct').style.display = 'none';
            document.getElementById('motionInstruct').style.display = 'block';
            document.getElementById('pauseTipText').innerText = "Hold hand in camera view to resume";
            
            if (!handLandmarker) {
                document.getElementById('playBtn').disabled = true;
                document.getElementById('playBtn').innerText = "LOADING ENGINE...";
                cameraStatus.style.display = 'flex';
                cameraStatus.innerText = "LOADING CORE...";
                pipContainer.classList.add('active');
                
                initMediaPipe().then(() => {
                    startWebcam().then(() => {
                        document.getElementById('playBtn').disabled = false;
                        document.getElementById('playBtn').innerText = "START SYSTEM";
                    });
                });
            } else {
                startWebcam();
            }
        } else {
            document.getElementById('keyboardInstruct').style.display = 'block';
            document.getElementById('motionInstruct').style.display = 'none';
            document.getElementById('pauseTipText').innerText = "Press SPACE or CLICK to resume operations";
            stopWebcam();
        }
    };
});

// --- MEDIAPIPE GESTURE ENGINE ---

async function initMediaPipe() {
    if (handLandmarker) return;
    try {
        cameraStatus.innerText = "LOADING CORE...";
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        cameraStatus.innerText = "LOADING MODEL...";
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });
        cameraStatus.innerText = "WEBCAM INCOMING...";
    } catch (e) {
        console.error("Failed to load MediaPipe:", e);
        cameraStatus.innerText = "LOAD ERROR";
    }
}

async function startWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cameraStatus.innerText = "NO CAMERA SUPPORT";
        return;
    }
    
    webcamRunning = true;
    pipContainer.classList.add('active');
    
    try {
        const constraints = { video: { width: 120, height: 90 } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.addEventListener('loadeddata', predictWebcam);
    } catch (err) {
        console.error("Webcam error:", err);
        cameraStatus.innerText = "ACCESS DENIED";
    }
}

function stopWebcam() {
    webcamRunning = false;
    pipContainer.classList.remove('active');
    pipContainer.classList.remove('tracking');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

async function predictWebcam() {
    if (!webcamRunning || !handLandmarker) return;
    
    if (pipCanvas.width !== video.videoWidth) {
        pipCanvas.width = video.videoWidth;
        pipCanvas.height = video.videoHeight;
    }
    
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const detections = handLandmarker.detectForVideo(video, startTimeMs);
        
        pipCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
        
        if (detections.landmarks && detections.landmarks.length > 0) {
            pipContainer.classList.add('tracking');
            cameraStatus.style.display = 'none';
            
            const landmarks = detections.landmarks[0];
            // Refined: Track index finger tip (landmark 8) for natural pointing control
            const targetLandmark = landmarks[8];
            
            // Feed raw coordinates directly to handY (allowing 60Hz loop to handle smoothing)
            handY = targetLandmark.y;
            
            drawSkeleton(landmarks);
        } else {
            pipContainer.classList.remove('tracking');
            // Drift handY slowly to center if lost
            if (handY !== null) {
                handY += (0.5 - handY) * 0.1;
            }
        }
    }
    
    if (webcamRunning) {
        window.requestAnimationFrame(predictWebcam);
    }
}

function drawSkeleton(landmarks) {
    pipCtx.fillStyle = 'rgba(57, 255, 20, 0.9)'; // Neon green dots
    pipCtx.strokeStyle = 'rgba(57, 255, 20, 0.6)'; // Neon green lines
    pipCtx.lineWidth = 1.5;
    
    // Draw connections
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [9, 10], [10, 11], [11, 12],     // Middle
        [13, 14], [14, 15], [15, 16],    // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm
    ];
    
    connections.forEach(([i, j]) => {
        let x1 = landmarks[i].x * pipCanvas.width;
        let y1 = landmarks[i].y * pipCanvas.height;
        let x2 = landmarks[j].x * pipCanvas.width;
        let y2 = landmarks[j].y * pipCanvas.height;
        
        pipCtx.beginPath();
        pipCtx.moveTo(x1, y1);
        pipCtx.lineTo(x2, y2);
        pipCtx.stroke();
    });

    // Draw joints
    landmarks.forEach(lm => {
        let px = lm.x * pipCanvas.width;
        let py = lm.y * pipCanvas.height;
        pipCtx.beginPath();
        pipCtx.arc(px, py, 2, 0, Math.PI * 2);
        pipCtx.fill();
    });
}

// --- INIT APP ---
// Load settings
let savedSoundSetting = localStorage.getItem('neon_flappy_sound');
if (savedSoundSetting === 'off') {
    toggleSound();
}

const savedName = localStorage.getItem('neon_flappy_player_name');
if (savedName) {
    pilotName = savedName;
    const nameInput = document.getElementById('playerNameInput');
    if (nameInput) nameInput.value = savedName;
}

// Initial draw in menu
initBackgrounds();
draw();
fetchGlobalLeaderboard();
// Start polling for dynamic automatic updates
setInterval(fetchGlobalLeaderboard, 5000);
