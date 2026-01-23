/**
 * Tot the Wandering Cat - Surreal Lynchian Animation
 * A black long-haired cat with yellow eyes that wanders the page
 * and peeks through horizontal gaps between cards, pupils aligned
 * Also hunts the fish cursor!
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

    // Track mouse position
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    // Pupil offset from cat center (approximate in screen pixels)
    // The cat SVG has eyes at roughly y=-130 from center, and the cat is 350px tall
    // When rendered at 280px width, pupils are about 100px up from cat center
    const PUPIL_OFFSET_Y = -100;

    function getViewport() {
        return {
            width: window.innerWidth,
            height: window.innerHeight
        };
    }

    // Horizontal gap peek positions - where pupils should align
    // Updated for wider card spacing
    function getPeekPositions() {
        const vp = getViewport();
        return [
            // Gaps between top stat cards (horizontal row) - wider spacing now
            { x: vp.width * 0.20, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.34, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.50, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.66, y: vp.height * 0.17, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.80, y: vp.height * 0.17, rotation: 0, from: 'bottom' },

            // Gaps between charts (horizontal) - wider gaps
            { x: vp.width * 0.37, y: vp.height * 0.50, rotation: 0, from: 'bottom' },
            { x: vp.width * 0.63, y: vp.height * 0.50, rotation: 0, from: 'bottom' },

            // Peeking from top (upside down) - between rows
            { x: vp.width * 0.37, y: vp.height * 0.30, rotation: 180, from: 'top' },
            { x: vp.width * 0.63, y: vp.height * 0.30, rotation: 180, from: 'top' },

            // Peeking from sides - more room with wider margins
            { x: vp.width * 0.02, y: vp.height * 0.4, rotation: 90, from: 'left' },
            { x: vp.width * 0.98, y: vp.height * 0.4, rotation: -90, from: 'right' },
            { x: vp.width * 0.02, y: vp.height * 0.6, rotation: 90, from: 'left' },
            { x: vp.width * 0.98, y: vp.height * 0.6, rotation: -90, from: 'right' },

            // Bottom peek positions
            { x: vp.width * 0.3, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
            { x: vp.width * 0.5, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
            { x: vp.width * 0.7, y: vp.height * 0.94, rotation: 180, from: 'bottom' },
        ];
    }

    // Easing function for smooth movement
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Lerp with easing
    function smoothLerp(current, target, speed) {
        const diff = target - current;
        if (Math.abs(diff) < 0.1) return target;
        return current + diff * speed;
    }

    // Normalize angle to -180 to 180
    function normalizeAngle(angle) {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    // Smooth angle interpolation
    function lerpAngle(current, target, speed) {
        let diff = normalizeAngle(target - current);
        if (Math.abs(diff) < 0.5) return target;
        return current + diff * speed;
    }

    // Keep cat within bounds - visible areas preferred
    function clampPosition(x, y) {
        const vp = getViewport();
        const margin = 80; // Keep cat this far from edges minimum

        // Horizontal bounds - keep fully on screen
        const minX = margin;
        const maxX = vp.width - margin;

        // Vertical bounds - keep visible
        const minY = 120; // Don't go too high
        const maxY = vp.height - 60; // Don't go off bottom

        return {
            x: Math.max(minX, Math.min(maxX, x)),
            y: Math.max(minY, Math.min(maxY, y))
        };
    }

    function renderCat() {
        const vp = getViewport();

        // Update wander offsets - favor edges and gaps where cat is more visible
        // Use a slower base movement that cycles around the edges
        const wanderAngle = frame * 0.003; // Slow circular patrol
        const edgeRadius = Math.min(vp.width, vp.height) * 0.35;

        // Base position favors edges - cycles around perimeter
        const baseX = vp.width * 0.5 + Math.cos(wanderAngle) * edgeRadius;
        const baseY = vp.height * 0.5 + Math.sin(wanderAngle * 0.7) * (vp.height * 0.25);

        // Add some organic variation
        wanderOffsetX = Math.sin(frame * 0.008) * (vp.width * 0.08) +
                       Math.cos(frame * 0.012) * (vp.width * 0.04);
        wanderOffsetY = Math.cos(frame * 0.009) * (vp.height * 0.06) +
                       Math.sin(frame * 0.007) * (vp.height * 0.03);

        // Peek behavior timing
        peekTimer++;
        huntTimer++;

        // Randomly trigger hunting mode (about every 15-25 seconds while wandering)
        if (peekPhase === 0 && !isHunting && huntTimer > 450 + Math.random() * 300) {
            isHunting = true;
            peekPhase = 3;
            peekTimer = 0;
            huntTimer = 0;
            huntDuration = 90 + Math.random() * 90; // 3-6 seconds of hunting
        }

        if (peekPhase === 0) {
            // Wandering - set target based on edge-favoring base position
            targetX = baseX + wanderOffsetX;
            targetY = baseY + wanderOffsetY;
            targetRotation = Math.sin(frame * 0.008) * 15; // Gentle rotation while wandering

            if (peekTimer > 200 + Math.random() * 150) {
                // Start moving to a peek position
                peekPhase = 1;
                peekTimer = 0;
                const positions = getPeekPositions();
                const peek = positions[Math.floor(Math.random() * positions.length)];

                // Adjust target so PUPILS align with gap
                // Account for rotation when calculating offset
                const rotRad = peek.rotation * Math.PI / 180;
                const offsetX = -Math.sin(rotRad) * PUPIL_OFFSET_Y;
                const offsetY = Math.cos(rotRad) * PUPIL_OFFSET_Y;

                targetX = peek.x + offsetX;
                targetY = peek.y + offsetY;
                targetRotation = peek.rotation;
                peekHoldDuration = 90 + Math.random() * 120;
            }
        } else if (peekPhase === 1) {
            // Moving to peek position - check if arrived
            const distX = Math.abs(currentX - targetX);
            const distY = Math.abs(currentY - targetY);
            const distRot = Math.abs(normalizeAngle(currentRotation - targetRotation));

            if (distX < 5 && distY < 5 && distRot < 3) {
                peekPhase = 2;
                peekTimer = 0;
            }
        } else if (peekPhase === 2) {
            // Peeking - hold position
            if (peekTimer > peekHoldDuration) {
                peekPhase = 0;
                peekTimer = 0;
                targetRotation = 0;
            }
        } else if (peekPhase === 3) {
            // HUNTING - lock onto fish cursor!
            // Move toward mouse but keep some distance
            const dx = mouseX - currentX;
            const dy = mouseY - currentY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Stay about 150-200px away, stalking
            const desiredDist = 150 + Math.sin(frame * 0.05) * 50;
            if (dist > desiredDist) {
                targetX = currentX + dx * 0.3;
                targetY = currentY + dy * 0.3;
            } else {
                // Close enough, hold position but track
                targetX = currentX + dx * 0.05;
                targetY = currentY + dy * 0.05;
            }

            // Rotate to face the fish
            targetRotation = Math.atan2(dy, dx) * 180 / Math.PI - 90;

            // End hunting after duration
            if (peekTimer > huntDuration) {
                peekPhase = 0;
                peekTimer = 0;
                isHunting = false;
                targetRotation = 0;
            }
        }

        // Smooth movement - different speeds for different phases
        const moveSpeed = peekPhase === 1 ? 0.03 : 0.02;
        const rotSpeed = peekPhase === 1 ? 0.04 : 0.02;

        currentX = smoothLerp(currentX, targetX, moveSpeed);
        currentY = smoothLerp(currentY, targetY, moveSpeed);
        currentRotation = lerpAngle(currentRotation, targetRotation, rotSpeed);

        // Clamp position to keep cat in bounds and visible
        const clamped = clampPosition(currentX, currentY);
        currentX = clamped.x;
        currentY = clamped.y;

        // Animation parameters
        const isHuntingPhase = peekPhase === 3;
        const breathe = isHuntingPhase ? Math.sin(frame * 0.06) * 4 : Math.sin(frame * 0.03) * 10; // Shallow, quick breathing when hunting
        const morphScale = (peekPhase === 2 || isHuntingPhase) ? 0.15 : 1; // Very still when hunting

        // Body morphing - crouched and tense when hunting
        const huntCrouch = isHuntingPhase ? 0.92 : 1; // Slightly flattened crouch
        const huntTense = isHuntingPhase ? (1 + Math.sin(frame * 0.1) * 0.03) : 1; // Subtle tension tremor
        const bodyStretch = (1 + Math.sin(frame * 0.04) * 0.15 * morphScale) * huntCrouch;
        const bodySquash = (1 + Math.cos(frame * 0.035) * 0.1 * morphScale) * huntTense;
        const headTilt = (Math.sin(frame * 0.05) * 10 + Math.cos(frame * 0.03) * 4) * morphScale;
        const headScale = 1 + Math.sin(frame * 0.06) * 0.12 * morphScale;

        // Eyes - behavior changes based on phase
        let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
        let leftPupilX, leftPupilY, rightPupilX, rightPupilY;
        let leftPupilDilate, rightPupilDilate;

        if (peekPhase === 3) {
            // HUNTING - eyes track the fish intensely!
            // Calculate direction to mouse relative to cat's current rotation
            const dx = mouseX - currentX;
            const dy = mouseY - currentY;
            const angleToMouse = Math.atan2(dy, dx);
            const catAngle = (currentRotation + 90) * Math.PI / 180;
            const relativeAngle = angleToMouse - catAngle;

            // Convert to pupil offset (max ~6px movement)
            const trackX = Math.cos(relativeAngle) * 5;
            const trackY = Math.sin(relativeAngle) * 4;

            // Eyes locked forward, very slight tremor (excitement)
            leftEyeX = Math.sin(frame * 0.15) * 1;
            leftEyeY = Math.cos(frame * 0.18) * 0.8;
            rightEyeX = Math.cos(frame * 0.16) * 1;
            rightEyeY = Math.sin(frame * 0.14) * 0.8;

            // Pupils track the fish!
            leftPupilX = trackX + Math.sin(frame * 0.2) * 0.5;
            leftPupilY = trackY + Math.cos(frame * 0.22) * 0.3;
            rightPupilX = trackX + Math.cos(frame * 0.21) * 0.5;
            rightPupilY = trackY + Math.sin(frame * 0.19) * 0.3;

            // Pupils VERY dilated when hunting (excitement!)
            leftPupilDilate = 1.5 + Math.sin(frame * 0.15) * 0.2;
            rightPupilDilate = 1.5 + Math.cos(frame * 0.17) * 0.2;
        } else if (peekPhase === 2) {
            // Peeking - eyes mostly still, pupils centered (looking at viewer)
            leftEyeX = Math.sin(frame * 0.02) * 2;
            leftEyeY = Math.cos(frame * 0.025) * 1.5;
            rightEyeX = Math.cos(frame * 0.022) * 2;
            rightEyeY = Math.sin(frame * 0.02) * 1.5;
            // Pupils very centered
            leftPupilX = Math.sin(frame * 0.015) * 1;
            leftPupilY = Math.cos(frame * 0.018) * 0.5;
            rightPupilX = Math.cos(frame * 0.016) * 1;
            rightPupilY = Math.sin(frame * 0.015) * 0.5;
            leftPupilDilate = 1 + Math.sin(frame * 0.1) * 0.3;
            rightPupilDilate = 1 + Math.cos(frame * 0.12) * 0.3;
        } else {
            // Wandering - normal surreal eye movement
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

        // Tail - low and twitchy tip when hunting
        const tailWag = isHuntingPhase ? Math.sin(frame * 0.15) * 8 : Math.sin(frame * 0.08) * 30 * morphScale; // Quick small twitch when hunting
        const tailStretch = isHuntingPhase ? 0.85 : 1 + Math.sin(frame * 0.05) * 0.4 * morphScale; // Low tail when hunting
        const tailCurl = isHuntingPhase ? -20 + Math.sin(frame * 0.2) * 5 : Math.sin(frame * 0.03) * 45 * morphScale; // Curved down, tip twitches

        // Ears - perked forward when hunting
        const earTwitchScale = (peekPhase === 2 || isHuntingPhase) ? 0.2 : 1;
        const huntEarForward = isHuntingPhase ? -8 : 0; // Ears rotated forward
        const leftEarTwitch = Math.sin(frame * 0.11) * 12 * earTwitchScale + huntEarForward;
        const rightEarTwitch = Math.cos(frame * 0.13) * 12 * earTwitchScale + huntEarForward;
        const leftEarStretch = isHuntingPhase ? 1.1 : 1 + Math.sin(frame * 0.07) * 0.2 * morphScale; // Tall ears when hunting
        const rightEarStretch = isHuntingPhase ? 1.1 : 1 + Math.cos(frame * 0.09) * 0.2 * morphScale;

        // Float
        const floatRotation = (Math.sin(frame * 0.015) * 4 + Math.cos(frame * 0.01) * 2) * morphScale;
        const floatY = Math.sin(frame * 0.04) * 20 * morphScale;

        // Fur ripple
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

        // Jumps - not when peeking
        const jumpMoment = Math.sin(frame * 0.008);
        const bigJump = peekPhase === 2 ? 0 : (jumpMoment > 0.96 ? (jumpMoment - 0.96) * 25 * -120 : 0);

        // Build SVG
        svg.innerHTML = `
            <g transform="translate(${posX}, ${posY + bigJump}) rotate(${floatRotation}) scale(${1 + impossibleStretch * 0.3}, ${1 - impossibleStretch * 0.1})">
                <!-- Shadow -->
                <ellipse
                    cx="${12 + Math.sin(frame * 0.03) * 25 * morphScale}"
                    cy="${195 + Math.cos(frame * 0.02) * 12 * morphScale - bigJump * 0.3}"
                    rx="${125 + Math.sin(frame * 0.04) * 25 * morphScale - bigJump * 0.2}"
                    ry="${32 - bigJump * 0.1}"
                    fill="rgba(0,0,0,0.12)"
                    style="filter: blur(12px)"
                />

                <!-- Tail -->
                <g transform="translate(115, 45) rotate(${-25 + tailWag + tailCurl}) scale(${tailStretch}, 1)">
                    <ellipse cx="55" cy="0" rx="${65 + Math.sin(furRipple) * 6}" ry="28" fill="#1a1a1a"/>
                    <ellipse cx="88" cy="-22" rx="50" ry="22" fill="#2a2a2a"/>
                    <ellipse cx="118" cy="-42" rx="38" ry="18" fill="#1a1a1a"/>
                    <ellipse cx="${138 + Math.sin(frame * 0.1) * 12 * morphScale}" cy="${-55 + Math.cos(frame * 0.1) * 12 * morphScale}" rx="22" ry="12" fill="#2a2a2a"/>
                </g>

                <!-- Body -->
                <g transform="scale(${bodySquash}, ${bodyStretch})">
                    <ellipse cx="0" cy="${75 + breathe}" rx="${140 + Math.sin(furRipple) * 8 * morphScale}" ry="${110 + Math.cos(furRipple + 1) * 8 * morphScale}" fill="#1a1a1a"/>
                    <ellipse cx="${Math.sin(furRipple * 0.5) * 5 * morphScale}" cy="${28 + breathe}" rx="${75 + Math.sin(furRipple + 2) * 5 * morphScale}" ry="55" fill="#2a2a2a"/>
                    <ellipse cx="0" cy="${40 + breathe}" rx="55" ry="40" fill="#3a3a3a"/>
                </g>

                <!-- Paws -->
                <ellipse cx="${-72 + Math.sin(frame * 0.09) * 6 * morphScale}" cy="${160 + Math.cos(frame * 0.08) * 4 * morphScale}" rx="38" ry="28" fill="#1a1a1a"/>
                <ellipse cx="${72 + Math.cos(frame * 0.1) * 6 * morphScale}" cy="${160 + Math.sin(frame * 0.07) * 4 * morphScale}" rx="38" ry="28" fill="#1a1a1a"/>

                <!-- Neck fluff -->
                <ellipse cx="${Math.sin(furRipple * 0.3) * 3 * morphScale}" cy="${-38 + breathe * 0.5}" rx="${95 + Math.sin(furRipple) * 5 * morphScale}" ry="65" fill="#2a2a2a"/>
                <ellipse cx="0" cy="${-28 + breathe * 0.5}" rx="82" ry="50" fill="#1a1a1a"/>

                <!-- Head -->
                <g transform="translate(0, ${-115 + breathe * 0.3}) rotate(${headTilt}) scale(${headScale})">
                    <ellipse cx="0" cy="0" rx="92" ry="82" fill="#1a1a1a"/>

                    <!-- Left ear -->
                    <g transform="translate(-56, -60) rotate(${leftEarTwitch}) scale(1, ${leftEarStretch})">
                        <polygon points="-26,-50 0,-112 26,-45" fill="#1a1a1a"/>
                        <polygon points="-18,-52 0,-96 18,-48" fill="#3a3a3a"/>
                        <polygon points="-3,-112 0,-138 3,-110" fill="#2a2a2a"/>
                    </g>

                    <!-- Right ear -->
                    <g transform="translate(56, -60) rotate(${rightEarTwitch}) scale(1, ${rightEarStretch})">
                        <polygon points="-26,-45 0,-112 26,-50" fill="#1a1a1a"/>
                        <polygon points="-18,-48 0,-96 18,-52" fill="#3a3a3a"/>
                        <polygon points="-3,-110 0,-138 3,-112" fill="#2a2a2a"/>
                    </g>

                    <!-- Left eye -->
                    <g transform="translate(${-40 + leftEyeX}, ${-8 + leftEyeY})">
                        <ellipse cx="0" cy="0" rx="26" ry="30" fill="#f4d03f"/>
                        <ellipse cx="${leftPupilX}" cy="${leftPupilY}" rx="${9 * leftPupilDilate}" ry="${20 * leftPupilDilate}" fill="#1a1a1a"/>
                        <circle cx="-8" cy="-10" r="6" fill="white" opacity="0.85"/>
                        <circle cx="${5 + Math.sin(frame * 0.08) * 4 * morphScale}" cy="${5 + Math.cos(frame * 0.06) * 3 * morphScale}" r="3" fill="white" opacity="0.5"/>
                    </g>

                    <!-- Right eye -->
                    <g transform="translate(${40 + rightEyeX}, ${-8 + rightEyeY})">
                        <ellipse cx="0" cy="0" rx="26" ry="30" fill="#f4d03f"/>
                        <ellipse cx="${rightPupilX}" cy="${rightPupilY}" rx="${9 * rightPupilDilate}" ry="${20 * rightPupilDilate}" fill="#1a1a1a"/>
                        <circle cx="-8" cy="-10" r="6" fill="white" opacity="0.85"/>
                        <circle cx="${5 + Math.cos(frame * 0.07) * 4 * morphScale}" cy="${5 + Math.sin(frame * 0.08) * 3 * morphScale}" r="3" fill="white" opacity="0.5"/>
                    </g>

                    <!-- Nose -->
                    <ellipse cx="${Math.sin(frame * 0.04) * 2 * morphScale}" cy="${30 + Math.cos(frame * 0.03) * 2 * morphScale}" rx="14" ry="10" fill="#4a4a4a"/>

                    <!-- Mouth -->
                    <g transform="translate(0, 44)">
                        ${(mouthOpenAmount > 0.1 || isYawning) ? `
                            <ellipse cx="0" cy="${7 + (isYawning ? 14 : mouthOpenAmount * 11)}" rx="${20 + (isYawning ? 9 : mouthOpenAmount * 7)}" ry="${11 + (isYawning ? 23 : mouthOpenAmount * 14)}" fill="#1a0a0a"/>
                            <ellipse cx="0" cy="${5 + (isYawning ? 11 : mouthOpenAmount * 9)}" rx="${16 + (isYawning ? 7 : mouthOpenAmount * 5)}" ry="${7 + (isYawning ? 18 : mouthOpenAmount * 11)}" fill="#3d2020"/>
                            ${isYawning ? `
                                <ellipse cx="-11" cy="-2" rx="3" ry="5" fill="#f0f0f0" opacity="0.7"/>
                                <ellipse cx="11" cy="-2" rx="3" ry="5" fill="#f0f0f0" opacity="0.7"/>
                            ` : ''}
                            ${tongueExtend > 0.05 ? `
                                <g transform="translate(0, ${4 + mouthOpenAmount * 7})">
                                    <ellipse cx="${Math.sin(frame * 0.25) * 2}" cy="0" rx="${13 * tongueThick}" ry="${7 * tongueThick}" fill="#cc6b6b"/>
                                    <path d="M ${-9 * tongueThick} 0 Q ${-7 * tongueThick + tongueWave * 0.3} ${14 * tongueExtend} ${Math.sin(frame * 0.15) * 4} ${28 * tongueExtend + tongueCurl * 0.3} Q ${7 * tongueThick + tongueWave * 0.4} ${42 * tongueExtend} ${tongueCurl * 0.3} ${52 * tongueExtend} L ${tongueCurl * 0.2} ${62 * tongueExtend} Q ${-tongueWave * 0.2} ${52 * tongueExtend} ${9 * tongueThick} 0 Z" fill="#e07575"/>
                                    <ellipse cx="${tongueCurl * 0.4 + Math.sin(frame * 0.2) * 10}" cy="${65 * tongueExtend}" rx="${7 * tongueThick}" ry="${5 * tongueThick}" fill="#d46a6a"/>
                                </g>
                            ` : ''}
                        ` : `
                            <path d="M 0 0 L 0 9 M -13 15 Q 0 24 13 15" stroke="#4a4a4a" stroke-width="2.5" fill="none"/>
                            ${isLicking ? `<ellipse cx="${-18 + Math.sin(frame * 0.3) * 36}" cy="${11 + Math.cos(frame * 0.3) * 4}" rx="7" ry="4" fill="#cc6b6b"/>` : ''}
                        `}
                    </g>

                    <!-- Whiskers -->
                    <g stroke="#5a5a5a" stroke-width="1.5" opacity="0.7">
                        <line x1="${-100 + Math.sin(frame * 0.06) * 8 * morphScale}" y1="${20 + Math.cos(frame * 0.07) * 3 * morphScale}" x2="-50" y2="30"/>
                        <line x1="${-105 + Math.sin(frame * 0.07 + 1) * 8 * morphScale}" y1="${35 + Math.cos(frame * 0.06) * 3 * morphScale}" x2="-52" y2="40"/>
                        <line x1="${-100 + Math.sin(frame * 0.05 + 2) * 8 * morphScale}" y1="${50 + Math.cos(frame * 0.08) * 3 * morphScale}" x2="-50" y2="48"/>
                        <line x1="${100 + Math.cos(frame * 0.06) * 8 * morphScale}" y1="${20 + Math.sin(frame * 0.07) * 3 * morphScale}" x2="50" y2="30"/>
                        <line x1="${105 + Math.cos(frame * 0.07 + 1) * 8 * morphScale}" y1="${35 + Math.sin(frame * 0.06) * 3 * morphScale}" x2="52" y2="40"/>
                        <line x1="${100 + Math.cos(frame * 0.05 + 2) * 8 * morphScale}" y1="${50 + Math.sin(frame * 0.08) * 3 * morphScale}" x2="50" y2="48"/>
                    </g>

                    <!-- Cheek fluff -->
                    <ellipse cx="${-82 + Math.sin(furRipple * 0.5) * 3 * morphScale}" cy="20" rx="28" ry="22" fill="#2a2a2a" opacity="0.6"/>
                    <ellipse cx="${82 + Math.cos(furRipple * 0.5) * 3 * morphScale}" cy="20" rx="28" ry="22" fill="#2a2a2a" opacity="0.6"/>
                </g>

                <!-- Ghost afterimage -->
                <g transform="translate(${-Math.sin(frame * 0.018) * 20 * morphScale}, ${-Math.cos(frame * 0.018) * 15 * morphScale}) scale(0.97)" opacity="${0.08 * morphScale}" style="filter: blur(10px)">
                    <ellipse cx="0" cy="75" rx="140" ry="110" fill="#1a1a1a"/>
                    <ellipse cx="0" cy="-115" rx="92" ry="82" fill="#1a1a1a"/>
                </g>
            </g>
        `;

        // Position and rotate the SVG on screen
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

    // Initialize position
    const vp = getViewport();
    currentX = vp.width * 0.5;
    currentY = vp.height * 0.5;
    targetX = currentX;
    targetY = currentY;

    // Start animation
    renderCat();
    requestAnimationFrame(animate);

    // Handle resize
    window.addEventListener('resize', () => {
        const vp = getViewport();
        // Keep cat in bounds on resize
        currentX = Math.min(Math.max(currentX, 100), vp.width - 100);
        currentY = Math.min(Math.max(currentY, 100), vp.height - 100);
        renderCat();
    });
})();
