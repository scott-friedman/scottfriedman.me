/**
 * Collaborative Whiteboard + Quirky Interactions
 * Beautiful flowing colors & subtle controls
 */

(function() {
    'use strict';

    // ==========================================================================
    // Firebase Configuration
    // ==========================================================================
    const FIREBASE_CONFIG = {
        // TODO: Add your Firebase config here for real-time sync
        // apiKey: "...", databaseURL: "...", etc.
    };

    // ==========================================================================
    // Beautiful Color System
    // ==========================================================================
    const COLOR_PALETTES = {
        forest: [
            { r: 45, g: 90, b: 61 },    // deep forest
            { r: 74, g: 140, b: 95 },   // forest
            { r: 127, g: 176, b: 105 }, // light green
        ],
        terracotta: [
            { r: 196, g: 93, b: 58 },   // terracotta
            { r: 212, g: 117, b: 106 }, // salmon
            { r: 232, g: 160, b: 144 }, // peach
        ],
        earth: [
            { r: 107, g: 68, b: 35 },   // brown
            { r: 139, g: 111, b: 71 },  // tan
            { r: 160, g: 128, b: 96 },  // light brown
        ],
        warm: [
            { r: 92, g: 83, b: 71 },    // warm gray
            { r: 138, g: 127, b: 114 }, // taupe
            { r: 181, g: 170, b: 156 }, // light taupe
        ]
    };

    const PALETTE_NAMES = Object.keys(COLOR_PALETTES);
    let currentPaletteIndex = 0;
    let colorProgress = 0;
    let autoColorMode = true;

    function lerpColor(c1, c2, t) {
        return {
            r: Math.round(c1.r + (c2.r - c1.r) * t),
            g: Math.round(c1.g + (c2.g - c1.g) * t),
            b: Math.round(c1.b + (c2.b - c1.b) * t)
        };
    }

    function getFlowingColor() {
        if (!autoColorMode) return null;

        const palette = COLOR_PALETTES[PALETTE_NAMES[currentPaletteIndex]];
        const segmentLength = 1 / (palette.length - 1);
        const segment = Math.floor(colorProgress / segmentLength);
        const segmentProgress = (colorProgress % segmentLength) / segmentLength;

        const c1 = palette[Math.min(segment, palette.length - 1)];
        const c2 = palette[Math.min(segment + 1, palette.length - 1)];
        const color = lerpColor(c1, c2, segmentProgress);

        // Add subtle opacity variation for watercolor effect
        const opacity = 0.4 + Math.sin(colorProgress * Math.PI * 4) * 0.15;

        return `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity.toFixed(2)})`;
    }

    function advanceColor() {
        colorProgress += 0.008;
        if (colorProgress >= 1) {
            colorProgress = 0;
            currentPaletteIndex = (currentPaletteIndex + 1) % PALETTE_NAMES.length;
        }
    }

    // ==========================================================================
    // Whiteboard Drawing
    // ==========================================================================
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const hint = document.querySelector('.draw-hint');

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let db = null;
    let strokesRef = null;
    let currentStroke = [];
    let hasDrawn = false;

    // Drawing settings
    let lineWidth = 4;
    let fixedColor = null;
    let isEraser = false;

    function resizeCanvas() {
        const imageData = canvas.width > 0 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        if (imageData) ctx.putImageData(imageData, 0, 0);
        setupContext();
    }

    function setupContext() {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    function initFirebase() {
        if (!FIREBASE_CONFIG.apiKey) {
            console.log('Firebase not configured. Drawing works locally.');
            return false;
        }
        try {
            firebase.initializeApp(FIREBASE_CONFIG);
            db = firebase.database();
            strokesRef = db.ref('strokes');
            strokesRef.on('child_added', (snapshot) => {
                const stroke = snapshot.val();
                if (stroke && stroke.points) drawStroke(stroke.points, stroke.color, stroke.width);
            });
            db.ref('canvas_cleared').on('value', (snapshot) => {
                if (snapshot.val()) ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
            console.log('Firebase connected!');
            return true;
        } catch (e) {
            console.log('Firebase init failed:', e);
            return false;
        }
    }

    function drawStroke(points, color, width) {
        if (points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = color || 'rgba(80, 60, 40, 0.5)';
        ctx.lineWidth = width || 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function getPos(e) {
        if (e.touches) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function startDrawing(e) {
        if (e.target !== canvas) return;

        isDrawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;

        const color = isEraser ? 'rgba(250, 250, 250, 1)' : (fixedColor || getFlowingColor());
        currentStroke = [{
            x: pos.x,
            y: pos.y,
            color: color,
            width: isEraser ? lineWidth * 4 : lineWidth
        }];

        // Hide hint after first stroke
        if (!hasDrawn && hint) {
            hasDrawn = true;
            hint.classList.add('hidden');
        }
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();

        const pos = getPos(e);

        // Get current color (flowing or fixed)
        const color = isEraser ? 'rgba(250, 250, 250, 1)' : (fixedColor || getFlowingColor());
        const width = isEraser ? lineWidth * 4 : lineWidth;

        // Slight width variation for organic feel
        const widthVariation = autoColorMode && !isEraser ? (1 + Math.sin(Date.now() / 100) * 0.15) : 1;

        ctx.strokeStyle = color;
        ctx.lineWidth = width * widthVariation;

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        currentStroke.push({ x: pos.x, y: pos.y, color, width });
        lastX = pos.x;
        lastY = pos.y;

        // Advance color for flowing effect
        if (autoColorMode && !isEraser) advanceColor();
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;

        if (strokesRef && currentStroke.length > 1) {
            const avgColor = currentStroke[Math.floor(currentStroke.length / 2)].color;
            strokesRef.push({
                points: currentStroke.map(p => ({ x: p.x, y: p.y })),
                color: avgColor,
                width: currentStroke[0].width,
                timestamp: Date.now()
            });
        }
        currentStroke = [];
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (db) {
            db.ref('canvas_cleared').set(Date.now());
            strokesRef.remove();
        }
    }

    // Initialize canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Touch events
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    initFirebase();

    // ==========================================================================
    // Toolbar Controls
    // ==========================================================================

    // Size buttons
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            lineWidth = parseInt(btn.dataset.size);
        });
    });

    // Color buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const color = btn.dataset.color;
            if (color === 'auto') {
                autoColorMode = true;
                fixedColor = null;
            } else {
                autoColorMode = false;
                fixedColor = hexToRgba(color, 0.6);
            }

            // Turn off eraser when selecting color
            isEraser = false;
            document.querySelector('[data-tool="eraser"]')?.classList.remove('active');
        });
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;

            if (tool === 'eraser') {
                isEraser = !isEraser;
                btn.classList.toggle('active', isEraser);
            } else if (tool === 'clear') {
                clearCanvas();
                // Brief flash feedback
                btn.style.background = 'var(--warm-light)';
                setTimeout(() => btn.style.background = '', 200);
            }
        });
    });

    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
            e.preventDefault();
            clearCanvas();
        }
    });

    // ==========================================================================
    // Quirky Interactions
    // ==========================================================================
    const h1 = document.querySelector('h1');
    if (h1) {
        h1.addEventListener('click', () => {
            const rotation = (Math.random() - 0.5) * 10;
            h1.style.transform = `rotate(${rotation}deg)`;
            setTimeout(() => h1.style.transform = 'rotate(0deg)', 500);
        });
        h1.style.transition = 'transform 0.3s ease, color 0.3s ease';
    }

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    console.log('✎ draw anywhere on the page!');
    console.log('tip: the colors flow through forest → terracotta → earth → warm gray');

})();
