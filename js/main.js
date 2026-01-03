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
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
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
    const toolbar = document.querySelector('.draw-toolbar');
    const mobileToggle = document.querySelector('.mobile-draw-toggle');

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

    // Mobile draw mode
    let isMobile = window.matchMedia('(pointer: coarse)').matches;
    let drawModeActive = !isMobile; // Desktop: always on, Mobile: off by default
    let drawModeTimeout = null;

    function getDocumentHeight() {
        return Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
    }

    function resizeCanvas() {
        // Save existing drawing
        const imageData = canvas.width > 0 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;

        // Size canvas to full document
        canvas.width = window.innerWidth;
        canvas.height = getDocumentHeight();

        // Restore drawing
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
        // Convert percentage coordinates to pixels
        ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x * canvas.width, points[i].y * canvas.height);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Get position as percentage of canvas (for cross-device compatibility)
    function getPos(e) {
        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        // Return as percentage (0-1) for cross-device compatibility
        return {
            x: clientX / canvas.width,
            y: (clientY + window.scrollY) / canvas.height
        };
    }

    // Convert percentage position to pixels for drawing
    function toPixels(pos) {
        return {
            x: pos.x * canvas.width,
            y: pos.y * canvas.height
        };
    }

    function startDrawing(e) {
        if (e.target !== canvas) return;
        if (isMobile && !drawModeActive) return;

        isDrawing = true;
        const pos = getPos(e);  // percentage coordinates
        const pixels = toPixels(pos);
        lastX = pixels.x;
        lastY = pixels.y;

        const color = isEraser ? 'rgba(250, 250, 250, 1)' : (fixedColor || getFlowingColor());
        currentStroke = [{
            x: pos.x,  // store as percentage
            y: pos.y,
            color: color,
            width: isEraser ? lineWidth * 4 : lineWidth
        }];

        // Hide hint after first stroke
        if (!hasDrawn && hint) {
            hasDrawn = true;
            hint.classList.add('hidden');
        }

        // Reset mobile timeout
        if (isMobile) resetDrawModeTimeout();
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();

        const pos = getPos(e);  // percentage coordinates
        const pixels = toPixels(pos);

        // Get current color (flowing or fixed)
        const color = isEraser ? 'rgba(250, 250, 250, 1)' : (fixedColor || getFlowingColor());
        const width = isEraser ? lineWidth * 4 : lineWidth;

        // Slight width variation for organic feel
        const widthVariation = autoColorMode && !isEraser ? (1 + Math.sin(Date.now() / 100) * 0.15) : 1;

        ctx.strokeStyle = color;
        ctx.lineWidth = width * widthVariation;

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pixels.x, pixels.y);
        ctx.stroke();

        currentStroke.push({ x: pos.x, y: pos.y, color, width });  // store as percentage
        lastX = pixels.x;
        lastY = pixels.y;

        // Advance color for flowing effect
        if (autoColorMode && !isEraser) advanceColor();

        // Reset mobile timeout
        if (isMobile) resetDrawModeTimeout();
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

    // ==========================================================================
    // Mobile Draw Mode Toggle
    // ==========================================================================
    function setDrawMode(active) {
        drawModeActive = active;

        if (mobileToggle) {
            mobileToggle.classList.toggle('active', active);
        }
        if (toolbar) {
            toolbar.classList.toggle('visible', active);
        }
        if (canvas) {
            canvas.classList.toggle('draw-enabled', active);
        }

        if (active) {
            resetDrawModeTimeout();
        } else {
            clearTimeout(drawModeTimeout);
        }
    }

    function resetDrawModeTimeout() {
        clearTimeout(drawModeTimeout);
        // Auto-exit draw mode after 5 seconds of inactivity
        drawModeTimeout = setTimeout(() => {
            if (isMobile && !isDrawing) {
                setDrawMode(false);
            }
        }, 5000);
    }

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            setDrawMode(!drawModeActive);
        });
    }

    // ==========================================================================
    // Initialize Canvas
    // ==========================================================================
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Also resize when content might change height
    const resizeObserver = new ResizeObserver(() => {
        const newHeight = getDocumentHeight();
        if (canvas.height !== newHeight) {
            resizeCanvas();
        }
    });
    resizeObserver.observe(document.body);

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
