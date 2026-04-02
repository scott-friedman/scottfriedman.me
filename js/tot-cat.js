/**
 * Tot the Wandering Cat - Surreal Lynchian Animation
 * A black long-haired cat with yellow eyes that wanders the page
 * and peeks through horizontal gaps between cards, pupils aligned
 * Also hunts the fish cursor!
 *
 * Performance: SVG elements are created once and updated via setAttribute
 * instead of rebuilding innerHTML every frame.
 */

(function() {
    const svg = document.getElementById('tot-cat-svg');
    if (!svg) return;

    let frame = 0;
    let lastTime = 0;
    const fps = 30;
    const frameInterval = 1000 / fps;

    // Smooth position state
    let currentX = window.innerWidth * 0.5;
    let currentY = window.innerHeight * 0.5;
    let currentRotation = 0;
    let targetX = currentX;
    let targetY = currentY;
    let targetRotation = 0;

    // Peek behavior state
    let peekPhase = 0; // 0 = wandering, 1 = moving to peek, 2 = peeking, 3 = hunting fish
    let peekTimer = 0;
    let peekHoldDuration = 0;
    let wanderOffsetX = 0;
    let wanderOffsetY = 0;

    // Mouse/fish tracking
    let mouseX = window.innerWidth * 0.5;
    let mouseY = window.innerHeight * 0.5;
    let huntTimer = 0;
    let huntDuration = 0;
    let isHunting = false;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    const PUPIL_OFFSET_Y = -100;

    // ===== SVG helpers =====
    const NS = 'http://www.w3.org/2000/svg';
    const el = {};

    function create(tag, attrs, parent) {
        const e = document.createElementNS(NS, tag);
        if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
        (parent || svg).appendChild(e);
        return e;
    }

    function setA(e, attrs) {
        for (const k in attrs) e.setAttribute(k, attrs[k]);
    }

    // ===== Build SVG tree once =====
    function initSVG() {
        el.root = create('g');

        // Shadow
        el.shadow = create('ellipse', { fill: 'rgba(0,0,0,0.12)', style: 'filter:blur(12px)' }, el.root);

        // Tail
        el.tailG = create('g', null, el.root);
        el.tail1 = create('ellipse', { cx: 55, cy: 0, ry: 28, fill: '#1a1a1a' }, el.tailG);
        create('ellipse', { cx: 88, cy: -22, rx: 50, ry: 22, fill: '#2a2a2a' }, el.tailG);
        create('ellipse', { cx: 118, cy: -42, rx: 38, ry: 18, fill: '#1a1a1a' }, el.tailG);
        el.tail4 = create('ellipse', { rx: 22, ry: 12, fill: '#2a2a2a' }, el.tailG);

        // Body
        el.bodyG = create('g', null, el.root);
        el.body1 = create('ellipse', { cx: 0, fill: '#1a1a1a' }, el.bodyG);
        el.body2 = create('ellipse', { ry: 55, fill: '#2a2a2a' }, el.bodyG);
        el.body3 = create('ellipse', { cx: 0, rx: 55, ry: 40, fill: '#3a3a3a' }, el.bodyG);

        // Paws
        el.pawL = create('ellipse', { rx: 38, ry: 28, fill: '#1a1a1a' }, el.root);
        el.pawR = create('ellipse', { rx: 38, ry: 28, fill: '#1a1a1a' }, el.root);

        // Neck fluff
        el.neck1 = create('ellipse', { ry: 65, fill: '#2a2a2a' }, el.root);
        el.neck2 = create('ellipse', { cx: 0, rx: 82, ry: 50, fill: '#1a1a1a' }, el.root);

        // Head
        el.headG = create('g', null, el.root);
        create('ellipse', { cx: 0, cy: 0, rx: 92, ry: 82, fill: '#1a1a1a' }, el.headG);

        // Left ear
        el.earLG = create('g', null, el.headG);
        create('polygon', { points: '-26,-50 0,-112 26,-45', fill: '#1a1a1a' }, el.earLG);
        create('polygon', { points: '-18,-52 0,-96 18,-48', fill: '#3a3a3a' }, el.earLG);
        create('polygon', { points: '-3,-112 0,-138 3,-110', fill: '#2a2a2a' }, el.earLG);

        // Right ear
        el.earRG = create('g', null, el.headG);
        create('polygon', { points: '-26,-45 0,-112 26,-50', fill: '#1a1a1a' }, el.earRG);
        create('polygon', { points: '-18,-48 0,-96 18,-52', fill: '#3a3a3a' }, el.earRG);
        create('polygon', { points: '-3,-110 0,-138 3,-112', fill: '#2a2a2a' }, el.earRG);

        // Left eye
        el.eyeLG = create('g', null, el.headG);
        create('ellipse', { cx: 0, cy: 0, rx: 26, ry: 30, fill: '#f4d03f' }, el.eyeLG);
        el.pupilL = create('ellipse', { fill: '#1a1a1a' }, el.eyeLG);
        create('circle', { cx: -8, cy: -10, r: 6, fill: 'white', opacity: 0.85 }, el.eyeLG);
        el.hlL = create('circle', { r: 3, fill: 'white', opacity: 0.5 }, el.eyeLG);

        // Right eye
        el.eyeRG = create('g', null, el.headG);
        create('ellipse', { cx: 0, cy: 0, rx: 26, ry: 30, fill: '#f4d03f' }, el.eyeRG);
        el.pupilR = create('ellipse', { fill: '#1a1a1a' }, el.eyeRG);
        create('circle', { cx: -8, cy: -10, r: 6, fill: 'white', opacity: 0.85 }, el.eyeRG);
        el.hlR = create('circle', { r: 3, fill: 'white', opacity: 0.5 }, el.eyeRG);

        // Nose
        el.nose = create('ellipse', { rx: 14, ry: 10, fill: '#4a4a4a' }, el.headG);

        // Mouth container
        el.mouthG = create('g', { transform: 'translate(0, 44)' }, el.headG);

        // Closed mouth group
        el.mClosedG = create('g', null, el.mouthG);
        create('path', { d: 'M 0 0 L 0 9 M -13 15 Q 0 24 13 15', stroke: '#4a4a4a', 'stroke-width': 2.5, fill: 'none' }, el.mClosedG);
        el.lickTongue = create('ellipse', { rx: 7, ry: 4, fill: '#cc6b6b', display: 'none' }, el.mClosedG);

        // Open mouth group
        el.mOpenG = create('g', { display: 'none' }, el.mouthG);
        el.mOuter = create('ellipse', { cx: 0, fill: '#1a0a0a' }, el.mOpenG);
        el.mInner = create('ellipse', { cx: 0, fill: '#3d2020' }, el.mOpenG);
        el.toothL = create('ellipse', { cx: -11, cy: -2, rx: 3, ry: 5, fill: '#f0f0f0', opacity: 0.7, display: 'none' }, el.mOpenG);
        el.toothR = create('ellipse', { cx: 11, cy: -2, rx: 3, ry: 5, fill: '#f0f0f0', opacity: 0.7, display: 'none' }, el.mOpenG);

        // Tongue
        el.tongueG = create('g', { display: 'none' }, el.mOpenG);
        el.tongueBase = create('ellipse', { cy: 0, fill: '#cc6b6b' }, el.tongueG);
        el.tonguePath = create('path', { fill: '#e07575' }, el.tongueG);
        el.tongueTip = create('ellipse', { fill: '#d46a6a' }, el.tongueG);

        // Whiskers
        const whG = create('g', { stroke: '#5a5a5a', 'stroke-width': 1.5, opacity: 0.7 }, el.headG);
        el.wh = [];
        for (let i = 0; i < 6; i++) el.wh.push(create('line', null, whG));

        // Cheek fluff
        el.cheekL = create('ellipse', { cy: 20, rx: 28, ry: 22, fill: '#2a2a2a', opacity: 0.6 }, el.headG);
        el.cheekR = create('ellipse', { cy: 20, rx: 28, ry: 22, fill: '#2a2a2a', opacity: 0.6 }, el.headG);

        // Ghost afterimage
        el.ghostG = create('g', { style: 'filter:blur(10px)' }, el.root);
        create('ellipse', { cx: 0, cy: 75, rx: 140, ry: 110, fill: '#1a1a1a' }, el.ghostG);
        create('ellipse', { cx: 0, cy: -115, rx: 92, ry: 82, fill: '#1a1a1a' }, el.ghostG);
    }

    // ===== Position / movement helpers =====

    function getViewport() {
        return { width: window.innerWidth, height: window.innerHeight };
    }

    function getPeekPositions() {
        const vp = getViewport();
        return [
            { x: vp.width * 0.20, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.34, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.50, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.66, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.80, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.37, y: vp.height * 0.50, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.63, y: vp.height * 0.50, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.37, y: vp.height * 0.30, rotation: 180, from: 'top' },
            { x: vp.width * 0.63, y: vp.height * 0.30, rotation: 180, from: 'top' },
            { x: vp.width * 0.02, y: vp.height * 0.4, rotation: 90, from: 'left' },
            { x: vp.width * 0.98, y: vp.height * 0.4, rotation: -90, from: 'right' },
            { x: vp.width * 0.02, y: vp.height * 0.6, rotation: 90, from: 'left' },
            { x: vp.width * 0.98, y: vp.height * 0.6, rotation: -90, from: 'right' },
            { x: vp.width * 0.3, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
            { x: vp.width * 0.5, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
            { x: vp.width * 0.7, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
        ];
    }

    function smoothLerp(current, target, speed) {
        const diff = target - current;
        if (Math.abs(diff) < 0.1) return target;
        return current + diff * speed;
    }

    function normalizeAngle(angle) {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    function lerpAngle(current, target, speed) {
        let diff = normalizeAngle(target - current);
        if (Math.abs(diff) < 0.5) return target;
        return current + diff * speed;
    }

    function clampPosition(x, y) {
        const vp = getViewport();
        return {
            x: Math.max(80, Math.min(vp.width - 80, x)),
            y: Math.max(120, Math.min(vp.height - 60, y))
        };
    }

    // ===== Render (attribute updates only) =====

    function renderCat() {
        const vp = getViewport();

        const wanderAngle = frame * 0.003;
        const edgeRadius = Math.min(vp.width, vp.height) * 0.35;
        const baseX = vp.width * 0.5 + Math.cos(wanderAngle) * edgeRadius;
        const baseY = vp.height * 0.5 + Math.sin(wanderAngle * 0.7) * (vp.height * 0.25);

        wanderOffsetX = Math.sin(frame * 0.008) * (vp.width * 0.08) +
                       Math.cos(frame * 0.012) * (vp.width * 0.04);
        wanderOffsetY = Math.cos(frame * 0.009) * (vp.height * 0.06) +
                       Math.sin(frame * 0.007) * (vp.height * 0.03);

        peekTimer++;
        huntTimer++;

        if (peekPhase === 0 && !isHunting && huntTimer > 450 + Math.random() * 300) {
            isHunting = true;
            peekPhase = 3;
            peekTimer = 0;
            huntTimer = 0;
            huntDuration = 90 + Math.random() * 90;
        }

        if (peekPhase === 0) {
            targetX = baseX + wanderOffsetX;
            targetY = baseY + wanderOffsetY;
            targetRotation = Math.sin(frame * 0.008) * 15;

            if (peekTimer > 200 + Math.random() * 150) {
                peekPhase = 1;
                peekTimer = 0;
                const positions = getPeekPositions();
                const peek = positions[Math.floor(Math.random() * positions.length)];
                const rotRad = peek.rotation * Math.PI / 180;
                targetX = peek.x + (-Math.sin(rotRad) * PUPIL_OFFSET_Y);
                targetY = peek.y + (Math.cos(rotRad) * PUPIL_OFFSET_Y);
                targetRotation = peek.rotation;
                peekHoldDuration = 90 + Math.random() * 120;
            }
        } else if (peekPhase === 1) {
            const distX = Math.abs(currentX - targetX);
            const distY = Math.abs(currentY - targetY);
            const distRot = Math.abs(normalizeAngle(currentRotation - targetRotation));
            if (distX < 5 && distY < 5 && distRot < 3) {
                peekPhase = 2;
                peekTimer = 0;
            }
        } else if (peekPhase === 2) {
            if (peekTimer > peekHoldDuration) {
                peekPhase = 0;
                peekTimer = 0;
                targetRotation = 0;
            }
        } else if (peekPhase === 3) {
            const dx = mouseX - currentX;
            const dy = mouseY - currentY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const desiredDist = 150 + Math.sin(frame * 0.05) * 50;
            if (dist > desiredDist) {
                targetX = currentX + dx * 0.3;
                targetY = currentY + dy * 0.3;
            } else {
                targetX = currentX + dx * 0.05;
                targetY = currentY + dy * 0.05;
            }
            targetRotation = Math.atan2(dy, dx) * 180 / Math.PI - 90;
            if (peekTimer > huntDuration) {
                peekPhase = 0;
                peekTimer = 0;
                isHunting = false;
                targetRotation = 0;
            }
        }

        const moveSpeed = peekPhase === 1 ? 0.03 : 0.02;
        const rotSpeed = peekPhase === 1 ? 0.04 : 0.02;
        currentX = smoothLerp(currentX, targetX, moveSpeed);
        currentY = smoothLerp(currentY, targetY, moveSpeed);
        currentRotation = lerpAngle(currentRotation, targetRotation, rotSpeed);
        const clamped = clampPosition(currentX, currentY);
        currentX = clamped.x;
        currentY = clamped.y;

        // Animation parameters
        const isHuntingPhase = peekPhase === 3;
        const breathe = isHuntingPhase ? Math.sin(frame * 0.06) * 4 : Math.sin(frame * 0.03) * 10;
        const morphScale = (peekPhase === 2 || isHuntingPhase) ? 0.15 : 1;

        const huntCrouch = isHuntingPhase ? 0.92 : 1;
        const huntTense = isHuntingPhase ? (1 + Math.sin(frame * 0.1) * 0.03) : 1;
        const bodyStretch = (1 + Math.sin(frame * 0.04) * 0.15 * morphScale) * huntCrouch;
        const bodySquash = (1 + Math.cos(frame * 0.035) * 0.1 * morphScale) * huntTense;
        const headTilt = (Math.sin(frame * 0.05) * 10 + Math.cos(frame * 0.03) * 4) * morphScale;
        const headScale = 1 + Math.sin(frame * 0.06) * 0.12 * morphScale;

        // Eyes
        let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
        let leftPupilX, leftPupilY, rightPupilX, rightPupilY;
        let leftPupilDilate, rightPupilDilate;

        if (peekPhase === 3) {
            const dx = mouseX - currentX;
            const dy = mouseY - currentY;
            const angleToMouse = Math.atan2(dy, dx);
            const catAngle = (currentRotation + 90) * Math.PI / 180;
            const relativeAngle = angleToMouse - catAngle;
            const trackX = Math.cos(relativeAngle) * 5;
            const trackY = Math.sin(relativeAngle) * 4;
            leftEyeX = Math.sin(frame * 0.15) * 1;
            leftEyeY = Math.cos(frame * 0.18) * 0.8;
            rightEyeX = Math.cos(frame * 0.16) * 1;
            rightEyeY = Math.sin(frame * 0.14) * 0.8;
            leftPupilX = trackX + Math.sin(frame * 0.2) * 0.5;
            leftPupilY = trackY + Math.cos(frame * 0.22) * 0.3;
            rightPupilX = trackX + Math.cos(frame * 0.21) * 0.5;
            rightPupilY = trackY + Math.sin(frame * 0.19) * 0.3;
            leftPupilDilate = 1.5 + Math.sin(frame * 0.15) * 0.2;
            rightPupilDilate = 1.5 + Math.cos(frame * 0.17) * 0.2;
        } else if (peekPhase === 2) {
            leftEyeX = Math.sin(frame * 0.02) * 2;
            leftEyeY = Math.cos(frame * 0.025) * 1.5;
            rightEyeX = Math.cos(frame * 0.022) * 2;
            rightEyeY = Math.sin(frame * 0.02) * 1.5;
            leftPupilX = Math.sin(frame * 0.015) * 1;
            leftPupilY = Math.cos(frame * 0.018) * 0.5;
            rightPupilX = Math.cos(frame * 0.016) * 1;
            rightPupilY = Math.sin(frame * 0.015) * 0.5;
            leftPupilDilate = 1 + Math.sin(frame * 0.1) * 0.3;
            rightPupilDilate = 1 + Math.cos(frame * 0.12) * 0.3;
        } else {
            leftEyeX = Math.sin(frame * 0.07) * 8;
            leftEyeY = Math.cos(frame * 0.09) * 6;
            rightEyeX = Math.cos(frame * 0.08) * 8;
            rightEyeY = Math.sin(frame * 0.06) * 6;
            leftPupilX = Math.sin(frame * 0.05) * 3;
            leftPupilY = Math.cos(frame * 0.04) * 2;
            rightPupilX = Math.cos(frame * 0.06) * 3;
            rightPupilY = Math.sin(frame * 0.05) * 2;
            leftPupilDilate = 1 + Math.sin(frame * 0.1) * 0.3;
            rightPupilDilate = 1 + Math.cos(frame * 0.12) * 0.3;
        }

        // Tail
        const tailWag = isHuntingPhase ? Math.sin(frame * 0.15) * 8 : Math.sin(frame * 0.08) * 30 * morphScale;
        const tailStretch = isHuntingPhase ? 0.85 : 1 + Math.sin(frame * 0.05) * 0.4 * morphScale;
        const tailCurl = isHuntingPhase ? -20 + Math.sin(frame * 0.2) * 5 : Math.sin(frame * 0.03) * 45 * morphScale;

        // Ears
        const earTwitchScale = (peekPhase === 2 || isHuntingPhase) ? 0.2 : 1;
        const huntEarForward = isHuntingPhase ? -8 : 0;
        const leftEarTwitch = Math.sin(frame * 0.11) * 12 * earTwitchScale + huntEarForward;
        const rightEarTwitch = Math.cos(frame * 0.13) * 12 * earTwitchScale + huntEarForward;
        const leftEarStretch = isHuntingPhase ? 1.1 : 1 + Math.sin(frame * 0.07) * 0.2 * morphScale;
        const rightEarStretch = isHuntingPhase ? 1.1 : 1 + Math.cos(frame * 0.09) * 0.2 * morphScale;

        // Float & fur
        const floatRotation = (Math.sin(frame * 0.015) * 4 + Math.cos(frame * 0.01) * 2) * morphScale;
        const floatY = Math.sin(frame * 0.04) * 20 * morphScale;
        const furRipple = frame * 0.1;

        // Impossible stretch
        const stretchMoment = Math.sin(frame * 0.018);
        const impossibleStretch = peekPhase === 2 ? 0 : (stretchMoment > 0.88 ? (stretchMoment - 0.88) * 8 : 0);

        // Mouth
        const mouthCycle = frame * 0.055;
        const mouthOpenAmount = peekPhase === 2 ? 0 : Math.max(0, Math.sin(mouthCycle) * 1.1);
        const isLicking = peekPhase !== 2 && Math.sin(frame * 0.04) > 0.65;
        const isYawning = peekPhase !== 2 && Math.sin(frame * 0.014) > 0.93;

        // Tongue
        const tongueExtend = isLicking ? Math.sin(frame * 0.15) * 0.5 + 0.5 : (isYawning ? 0.3 : 0);
        const tongueWave = Math.sin(frame * 0.2) * 15;
        const tongueCurl = Math.sin(frame * 0.12) * 20;
        const tongueThick = 1 + Math.sin(frame * 0.18) * 0.2;

        // Internal SVG position
        const posX = 200;
        const posY = 280 + floatY;

        // Jumps
        const jumpMoment = Math.sin(frame * 0.008);
        const bigJump = peekPhase === 2 ? 0 : (jumpMoment > 0.96 ? (jumpMoment - 0.96) * 25 * -120 : 0);

        // ===== Update SVG attributes =====

        setA(el.root, { transform: `translate(${posX},${posY + bigJump}) rotate(${floatRotation}) scale(${1 + impossibleStretch * 0.3},${1 - impossibleStretch * 0.1})` });

        setA(el.shadow, {
            cx: 12 + Math.sin(frame * 0.03) * 25 * morphScale,
            cy: 195 + Math.cos(frame * 0.02) * 12 * morphScale - bigJump * 0.3,
            rx: 125 + Math.sin(frame * 0.04) * 25 * morphScale - bigJump * 0.2,
            ry: 32 - bigJump * 0.1
        });

        // Tail
        setA(el.tailG, { transform: `translate(115,45) rotate(${-25 + tailWag + tailCurl}) scale(${tailStretch},1)` });
        el.tail1.setAttribute('rx', 65 + Math.sin(furRipple) * 6);
        setA(el.tail4, {
            cx: 138 + Math.sin(frame * 0.1) * 12 * morphScale,
            cy: -55 + Math.cos(frame * 0.1) * 12 * morphScale
        });

        // Body
        setA(el.bodyG, { transform: `scale(${bodySquash},${bodyStretch})` });
        setA(el.body1, {
            cy: 75 + breathe,
            rx: 140 + Math.sin(furRipple) * 8 * morphScale,
            ry: 110 + Math.cos(furRipple + 1) * 8 * morphScale
        });
        setA(el.body2, {
            cx: Math.sin(furRipple * 0.5) * 5 * morphScale,
            cy: 28 + breathe,
            rx: 75 + Math.sin(furRipple + 2) * 5 * morphScale
        });
        el.body3.setAttribute('cy', 40 + breathe);

        // Paws
        setA(el.pawL, {
            cx: -72 + Math.sin(frame * 0.09) * 6 * morphScale,
            cy: 160 + Math.cos(frame * 0.08) * 4 * morphScale
        });
        setA(el.pawR, {
            cx: 72 + Math.cos(frame * 0.1) * 6 * morphScale,
            cy: 160 + Math.sin(frame * 0.07) * 4 * morphScale
        });

        // Neck
        setA(el.neck1, {
            cx: Math.sin(furRipple * 0.3) * 3 * morphScale,
            cy: -38 + breathe * 0.5,
            rx: 95 + Math.sin(furRipple) * 5 * morphScale
        });
        el.neck2.setAttribute('cy', -28 + breathe * 0.5);

        // Head
        setA(el.headG, { transform: `translate(0,${-115 + breathe * 0.3}) rotate(${headTilt}) scale(${headScale})` });

        // Ears
        setA(el.earLG, { transform: `translate(-56,-60) rotate(${leftEarTwitch}) scale(1,${leftEarStretch})` });
        setA(el.earRG, { transform: `translate(56,-60) rotate(${rightEarTwitch}) scale(1,${rightEarStretch})` });

        // Eyes
        setA(el.eyeLG, { transform: `translate(${-40 + leftEyeX},${-8 + leftEyeY})` });
        setA(el.pupilL, { cx: leftPupilX, cy: leftPupilY, rx: 9 * leftPupilDilate, ry: 20 * leftPupilDilate });
        setA(el.hlL, {
            cx: 5 + Math.sin(frame * 0.08) * 4 * morphScale,
            cy: 5 + Math.cos(frame * 0.06) * 3 * morphScale
        });

        setA(el.eyeRG, { transform: `translate(${40 + rightEyeX},${-8 + rightEyeY})` });
        setA(el.pupilR, { cx: rightPupilX, cy: rightPupilY, rx: 9 * rightPupilDilate, ry: 20 * rightPupilDilate });
        setA(el.hlR, {
            cx: 5 + Math.cos(frame * 0.07) * 4 * morphScale,
            cy: 5 + Math.sin(frame * 0.08) * 3 * morphScale
        });

        // Nose
        setA(el.nose, {
            cx: Math.sin(frame * 0.04) * 2 * morphScale,
            cy: 30 + Math.cos(frame * 0.03) * 2 * morphScale
        });

        // Mouth - toggle between open/closed groups
        const isOpen = mouthOpenAmount > 0.1 || isYawning;
        el.mClosedG.setAttribute('display', isOpen ? 'none' : 'inline');
        el.mOpenG.setAttribute('display', isOpen ? 'inline' : 'none');

        if (isOpen) {
            const oY = isYawning ? 14 : mouthOpenAmount * 11;
            const oRX = isYawning ? 9 : mouthOpenAmount * 7;
            const oRY = isYawning ? 23 : mouthOpenAmount * 14;
            setA(el.mOuter, { cy: 7 + oY, rx: 20 + oRX, ry: 11 + oRY });

            const iY = isYawning ? 11 : mouthOpenAmount * 9;
            const iRX = isYawning ? 7 : mouthOpenAmount * 5;
            const iRY = isYawning ? 18 : mouthOpenAmount * 11;
            setA(el.mInner, { cy: 5 + iY, rx: 16 + iRX, ry: 7 + iRY });

            el.toothL.setAttribute('display', isYawning ? 'inline' : 'none');
            el.toothR.setAttribute('display', isYawning ? 'inline' : 'none');

            const showTongue = tongueExtend > 0.05;
            el.tongueG.setAttribute('display', showTongue ? 'inline' : 'none');
            if (showTongue) {
                setA(el.tongueG, { transform: `translate(0,${4 + mouthOpenAmount * 7})` });
                setA(el.tongueBase, { cx: Math.sin(frame * 0.25) * 2, rx: 13 * tongueThick, ry: 7 * tongueThick });
                el.tonguePath.setAttribute('d',
                    `M ${-9 * tongueThick} 0 Q ${-7 * tongueThick + tongueWave * 0.3} ${14 * tongueExtend} ${Math.sin(frame * 0.15) * 4} ${28 * tongueExtend + tongueCurl * 0.3} Q ${7 * tongueThick + tongueWave * 0.4} ${42 * tongueExtend} ${tongueCurl * 0.3} ${52 * tongueExtend} L ${tongueCurl * 0.2} ${62 * tongueExtend} Q ${-tongueWave * 0.2} ${52 * tongueExtend} ${9 * tongueThick} 0 Z`
                );
                setA(el.tongueTip, {
                    cx: tongueCurl * 0.4 + Math.sin(frame * 0.2) * 10,
                    cy: 65 * tongueExtend,
                    rx: 7 * tongueThick,
                    ry: 5 * tongueThick
                });
            }
        } else {
            el.lickTongue.setAttribute('display', isLicking ? 'inline' : 'none');
            if (isLicking) {
                setA(el.lickTongue, {
                    cx: -18 + Math.sin(frame * 0.3) * 36,
                    cy: 11 + Math.cos(frame * 0.3) * 4
                });
            }
        }

        // Whiskers
        setA(el.wh[0], { x1: -100 + Math.sin(frame * 0.06) * 8 * morphScale, y1: 20 + Math.cos(frame * 0.07) * 3 * morphScale, x2: -50, y2: 30 });
        setA(el.wh[1], { x1: -105 + Math.sin(frame * 0.07 + 1) * 8 * morphScale, y1: 35 + Math.cos(frame * 0.06) * 3 * morphScale, x2: -52, y2: 40 });
        setA(el.wh[2], { x1: -100 + Math.sin(frame * 0.05 + 2) * 8 * morphScale, y1: 50 + Math.cos(frame * 0.08) * 3 * morphScale, x2: -50, y2: 48 });
        setA(el.wh[3], { x1: 100 + Math.cos(frame * 0.06) * 8 * morphScale, y1: 20 + Math.sin(frame * 0.07) * 3 * morphScale, x2: 50, y2: 30 });
        setA(el.wh[4], { x1: 105 + Math.cos(frame * 0.07 + 1) * 8 * morphScale, y1: 35 + Math.sin(frame * 0.06) * 3 * morphScale, x2: 52, y2: 40 });
        setA(el.wh[5], { x1: 100 + Math.cos(frame * 0.05 + 2) * 8 * morphScale, y1: 50 + Math.sin(frame * 0.08) * 3 * morphScale, x2: 50, y2: 48 });

        // Cheeks
        el.cheekL.setAttribute('cx', -82 + Math.sin(furRipple * 0.5) * 3 * morphScale);
        el.cheekR.setAttribute('cx', 82 + Math.cos(furRipple * 0.5) * 3 * morphScale);

        // Ghost
        setA(el.ghostG, {
            transform: `translate(${-Math.sin(frame * 0.018) * 20 * morphScale},${-Math.cos(frame * 0.018) * 15 * morphScale}) scale(0.97)`,
            opacity: 0.08 * morphScale
        });

        // Position on screen
        svg.style.left = `${currentX - 140}px`;
        svg.style.top = `${currentY - 175}px`;
        svg.style.transform = `rotate(${currentRotation}deg)`;
    }

    function animate(currentTime) {
        if (currentTime - lastTime >= frameInterval) {
            frame++;
            lastTime = currentTime;
            renderCat();
        }
        requestAnimationFrame(animate);
    }

    // Initialize
    const vp = getViewport();
    currentX = vp.width * 0.5;
    currentY = vp.height * 0.5;
    targetX = currentX;
    targetY = currentY;

    initSVG();
    renderCat();
    requestAnimationFrame(animate);

    window.addEventListener('resize', () => {
        const vp = getViewport();
        currentX = Math.min(Math.max(currentX, 100), vp.width - 100);
        currentY = Math.min(Math.max(currentY, 100), vp.height - 100);
        renderCat();
    });
})();
