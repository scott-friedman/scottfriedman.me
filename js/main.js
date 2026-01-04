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

    // Get page identifier for page-specific drawings
    function getPageId() {
        const path = window.location.pathname;
        const page = path.split('/').pop().replace('.html', '') || 'index';
        return page;
    }

    // ==========================================================================
    // Beautiful Color System
    // ==========================================================================
    const COLOR_PALETTES = {
        forest: [
            { r: 29, g: 71, b: 51 },    // deep forest
            { r: 46, g: 125, b: 84 },   // emerald
            { r: 98, g: 166, b: 117 },  // sage
        ],
        ocean: [
            { r: 35, g: 87, b: 102 },   // deep teal
            { r: 66, g: 133, b: 150 },  // ocean
            { r: 107, g: 168, b: 179 }, // seafoam
        ],
        sunset: [
            { r: 204, g: 102, b: 68 },  // burnt orange
            { r: 227, g: 139, b: 94 },  // apricot
            { r: 244, g: 187, b: 135 }, // peach
        ],
        berry: [
            { r: 143, g: 63, b: 89 },   // burgundy
            { r: 181, g: 93, b: 119 },  // dusty rose
            { r: 212, g: 145, b: 158 }, // blush
        ],
        plum: [
            { r: 88, g: 61, b: 100 },   // deep plum
            { r: 128, g: 95, b: 138 },  // mauve
            { r: 167, g: 137, b: 172 }, // lavender
        ],
        gold: [
            { r: 166, g: 124, b: 54 },  // antique gold
            { r: 199, g: 163, b: 86 },  // golden
            { r: 224, g: 196, b: 132 }, // champagne
        ],
        earth: [
            { r: 107, g: 68, b: 35 },   // chocolate
            { r: 148, g: 103, b: 61 },  // caramel
            { r: 180, g: 144, b: 103 }, // sand
        ],
        slate: [
            { r: 66, g: 72, b: 82 },    // charcoal
            { r: 105, g: 112, b: 122 }, // slate
            { r: 148, g: 154, b: 162 }, // silver
        ]
    };

    // Flow through colors in a pleasing order
    const ALL_COLORS = [
        ...COLOR_PALETTES.forest,
        ...COLOR_PALETTES.ocean,
        ...COLOR_PALETTES.plum,
        ...COLOR_PALETTES.berry,
        ...COLOR_PALETTES.sunset,
        ...COLOR_PALETTES.gold,
        ...COLOR_PALETTES.earth,
        ...COLOR_PALETTES.slate,
    ];
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

        // Use time + stroke progress for continuous color evolution
        const timeOffset = (Date.now() / 3000) % 1;  // Slow time-based drift
        const combinedProgress = (colorProgress + timeOffset) % 1;

        // Smoothly interpolate through ALL colors
        const totalColors = ALL_COLORS.length;
        const scaledProgress = combinedProgress * totalColors;
        const colorIndex = Math.floor(scaledProgress);
        const t = scaledProgress - colorIndex;

        const c1 = ALL_COLORS[colorIndex % totalColors];
        const c2 = ALL_COLORS[(colorIndex + 1) % totalColors];
        const color = lerpColor(c1, c2, t);

        // Dynamic opacity with multiple wave frequencies
        const wave1 = Math.sin(combinedProgress * Math.PI * 6) * 0.1;
        const wave2 = Math.sin(Date.now() / 500) * 0.05;
        const opacity = 0.45 + wave1 + wave2;

        return `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity.toFixed(2)})`;
    }

    function advanceColor() {
        // Faster progression through colors
        colorProgress += 0.025;
        if (colorProgress >= 1) {
            colorProgress = 0;
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
    let lastClearedTimestamp = 0;

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
            // Prevent re-initialization
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            db = firebase.database();

            const pageId = getPageId();
            strokesRef = db.ref('strokes/' + pageId);

            // Load existing strokes and listen for new ones
            strokesRef.on('child_added', (snapshot) => {
                const stroke = snapshot.val();
                if (stroke && stroke.points) drawStroke(stroke.points, stroke.color, stroke.width);
            });

            // Listen for canvas clear events (only respond to NEW clears after page load)
            const clearRef = db.ref('canvas_cleared/' + pageId);
            // First, get current value to establish baseline
            clearRef.once('value', (snapshot) => {
                lastClearedTimestamp = snapshot.val() || 0;
                // Now listen for future changes
                clearRef.on('value', (snapshot) => {
                    const cleared = snapshot.val();
                    if (cleared && cleared > lastClearedTimestamp) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        lastClearedTimestamp = cleared;
                    }
                });
            });

            console.log('Firebase connected for page:', pageId);
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
        // x: percentage to pixels, y: already in pixels
        ctx.moveTo(points[0].x * canvas.width, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x * canvas.width, points[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Get position for storage
    // x: percentage of width (for cross-device compatibility)
    // y: absolute pixels from top (so drawings stay at correct scroll position)
    function getPos(e) {
        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        return {
            x: clientX / canvas.width,
            y: clientY + window.scrollY  // absolute pixels from top
        };
    }

    // Convert stored position to pixels for drawing
    function toPixels(pos) {
        return {
            x: pos.x * canvas.width,
            y: pos.y  // y is already in pixels
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
            const pageId = getPageId();
            db.ref('canvas_cleared/' + pageId).set(Date.now());
            db.ref('strokes/' + pageId).remove();
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

    // ==========================================================================
    // Content Loading from Firebase
    // ==========================================================================

    // Helper function to render different audio embed types
    function renderSoundEmbed(sound) {
        const { title, type, url, artist } = sound;
        let embedHtml = '';

        // Build the title/artist header
        let header = '';
        if (title || artist) {
            header = `<div class="sound-info">`;
            if (title) header += `<span class="sound-title">${title}</span>`;
            if (artist) header += `<span class="sound-artist">${artist}</span>`;
            header += `</div>`;
        }

        switch (type) {
            case 'mixcloud':
            case 'bandcamp':
                embedHtml = `<iframe width="100%" height="120" src="${url}" frameborder="0" allow="autoplay"></iframe>`;
                break;

            case 'dropbox':
                // Convert Dropbox share link to direct link
                let directUrl = url;
                if (url.includes('dropbox.com') || url.includes('dropboxusercontent.com')) {
                    directUrl = url
                        .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                        .replace('&dl=0', '&dl=1')
                        .replace('?dl=0', '?dl=1');
                    // If no dl param, add it
                    if (!directUrl.includes('dl=1')) {
                        directUrl += (directUrl.includes('?') ? '&' : '?') + 'dl=1';
                    }
                }
                // Detect audio type from extension
                const ext = directUrl.split('.').pop().split('?')[0].toLowerCase();
                const mimeTypes = {
                    'mp3': 'audio/mpeg',
                    'm4a': 'audio/mp4',
                    'wav': 'audio/wav',
                    'ogg': 'audio/ogg',
                    'aac': 'audio/aac'
                };
                const mimeType = mimeTypes[ext] || 'audio/mpeg';
                embedHtml = `<audio controls preload="metadata"><source src="${directUrl}" type="${mimeType}">Your browser does not support audio.</audio>`;
                break;

            case 'audio':
                embedHtml = `<audio controls preload="metadata"><source src="${url}">Your browser does not support audio.</audio>`;
                break;

            default:
                embedHtml = `<iframe width="100%" height="120" src="${url}" frameborder="0"></iframe>`;
        }

        return `<div class="sound-embed">${header}${embedHtml}</div>`;
    }

    // Reorder sections in the DOM based on saved order
    function reorderSections(sectionOrder) {
        const main = document.querySelector('main');
        if (!main) return;

        // Find the first section and its preceding hr
        const sections = {};
        const hrElements = {};

        sectionOrder.forEach(id => {
            const section = document.getElementById(id);
            if (section) {
                sections[id] = section;
                // Find the hr before this section
                const prevSibling = section.previousElementSibling;
                if (prevSibling && prevSibling.tagName === 'HR') {
                    hrElements[id] = prevSibling;
                }
            }
        });

        // Find the insertion point (after nav's hr)
        const nav = main.querySelector('nav');
        if (!nav) return;
        let insertBefore = nav.nextElementSibling;
        while (insertBefore && insertBefore.tagName !== 'HR') {
            insertBefore = insertBefore.nextElementSibling;
        }
        if (insertBefore) insertBefore = insertBefore.nextElementSibling;

        // Reorder: move each section (with its preceding hr) in order
        sectionOrder.forEach(id => {
            const section = sections[id];
            const hr = hrElements[id];
            if (section) {
                // Find where to insert
                const footer = main.querySelector('footer');
                const lastHr = footer?.previousElementSibling;

                if (hr && lastHr) {
                    main.insertBefore(hr, lastHr);
                    main.insertBefore(section, lastHr);
                }
            }
        });

        // Also update the nav order
        const navEl = document.querySelector('nav');
        if (navEl) {
            const links = {};
            navEl.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && href.startsWith('#')) {
                    links[href.substring(1)] = a;
                }
            });

            // Reorder nav links
            sectionOrder.forEach(id => {
                if (links[id]) {
                    navEl.appendChild(links[id]);
                }
            });
        }
    }

    function loadContent() {
        if (!FIREBASE_CONFIG.apiKey) return;

        const contentRef = firebase.database().ref('content');
        contentRef.once('value').then((snapshot) => {
            const content = snapshot.val();
            if (!content) return;

            // Reorder sections if order is saved
            if (content.sectionOrder && content.sectionOrder.length > 0) {
                reorderSections(content.sectionOrder);
            }

            // Load Intro section
            if (content.about) {
                const aboutEl = document.getElementById('intro-content');
                if (aboutEl && content.about.paragraphs) {
                    aboutEl.innerHTML = content.about.paragraphs
                        .map(p => `<p>${p}</p>`)
                        .join('');
                }
            }

            // Load Projects
            if (content.projects && content.projects.length > 0) {
                const projectsEl = document.getElementById('projects-list');
                if (projectsEl) {
                    projectsEl.innerHTML = content.projects
                        .map(p => {
                            // Check if link is internal (page slug) or external (URL)
                            const link = p.link || '#';
                            const href = link.startsWith('http') || link.startsWith('#')
                                ? link
                                : `page.html?p=${link}`;
                            const target = link.startsWith('http') ? ' target="_blank"' : '';
                            return `<li><a href="${href}"${target}>${p.title}</a><span class="desc">— ${p.desc}</span></li>`;
                        })
                        .join('');
                }
            }

            // Load Writing
            if (content.writing && content.writing.length > 0) {
                const writingEl = document.getElementById('writing-list');
                if (writingEl) {
                    writingEl.innerHTML = content.writing
                        .map(w => {
                            // Check if link is internal (page slug) or external (URL)
                            const link = w.link || '#';
                            const href = link.startsWith('http') || link.startsWith('#')
                                ? link
                                : `page.html?p=${link}`;
                            const target = link.startsWith('http') ? ' target="_blank"' : '';
                            return `<li><span class="date">${w.date}</span><a href="${href}"${target}>${w.title}</a></li>`;
                        })
                        .join('');
                }
            }

            // Load Sounds (supports legacy mixes format)
            const soundsData = content.sounds || (content.mixes ? content.mixes.map(m => ({
                title: m.title || '',
                type: 'mixcloud',
                url: m.embedUrl || '',
                artist: ''
            })) : []);

            if (soundsData.length > 0) {
                const soundsEl = document.getElementById('sounds-list');
                if (soundsEl) {
                    soundsEl.innerHTML = soundsData.map(s => renderSoundEmbed(s)).join('');
                }
            }

            // Load Contact Links
            if (content.contact && content.contact.length > 0) {
                const contactEl = document.getElementById('contact-list');
                if (contactEl) {
                    contactEl.innerHTML = content.contact
                        .map(c => {
                            // Check if link is internal (page slug) or external (URL)
                            const href = c.url.startsWith('http') || c.url.startsWith('#') || c.url.startsWith('mailto:')
                                ? c.url
                                : `page.html?p=${c.url}`;
                            const target = c.url.startsWith('http') ? ' target="_blank"' : '';
                            return `<li><a href="${href}"${target}>${c.name}</a></li>`;
                        })
                        .join('');
                }
            }

            // Content loaded - reveal sections
            document.body.classList.remove('content-loading');
            document.body.classList.add('content-loaded');
        }).catch(err => {
            console.log('Content load failed, using defaults:', err);
            // Still reveal sections even on error
            document.body.classList.remove('content-loading');
            document.body.classList.add('content-loaded');
        });
    }

    // Load content after Firebase is ready
    if (FIREBASE_CONFIG.apiKey) {
        loadContent();
    }

})();
