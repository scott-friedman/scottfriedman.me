/**
 * Command Center - Smart Home Controls
 * Allows visitors to control whitelisted Home Assistant devices
 */

(function() {
    'use strict';

    // Configuration
    const WORKER_URL = 'https://ha-command-center.s-friedman.workers.dev';

    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
    };

    // State
    let isEnabled = true;
    let devices = {};
    let db = null;
    let lastLogTimestamp = 0;
    let refreshDebounceTimer = null;
    let isInitialLoad = true;
    let lastLocalActionTime = 0; // Track when WE made an action
    const LOCAL_ACTION_COOLDOWN = 3000; // Ignore Firebase refreshes for 3s after our own action

    // DOM Elements
    const devicesGrid = document.getElementById('devices-grid');
    const activityLog = document.getElementById('activity-log');
    const disabledBanner = document.getElementById('disabled-banner');
    const adminSection = document.getElementById('admin-section');
    const toggleEnabledBtn = document.getElementById('toggle-enabled-btn');
    const toggleBtnText = document.getElementById('toggle-btn-text');

    /**
     * Initialize Firebase
     */
    function initFirebase() {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.database();
    }

    /**
     * Check if user is admin (logged into admin panel)
     */
    function checkAdminAuth() {
        return localStorage.getItem('admin_auth') === 'true';
    }

    /**
     * Setup admin controls if authenticated
     */
    function setupAdminControls() {
        if (checkAdminAuth()) {
            adminSection.style.display = 'block';
            toggleEnabledBtn.addEventListener('click', toggleEnabled);
        }
    }

    /**
     * Toggle command center enabled state (admin only)
     */
    async function toggleEnabled() {
        const newState = !isEnabled;
        toggleEnabledBtn.disabled = true;

        try {
            await db.ref('commandcenter/enabled').set(newState);
            // State will update via real-time listener
        } catch (error) {
            console.error('Failed to toggle enabled state:', error);
            alert('Failed to update. Please try again.');
        }

        toggleEnabledBtn.disabled = false;
    }

    /**
     * Update UI based on enabled state
     */
    function updateEnabledUI() {
        if (isEnabled) {
            disabledBanner.style.display = 'none';
            devicesGrid.classList.remove('disabled');
            toggleBtnText.textContent = 'Disable Controls';
            toggleEnabledBtn.classList.remove('enable');
        } else {
            disabledBanner.style.display = 'flex';
            devicesGrid.classList.add('disabled');
            toggleBtnText.textContent = 'Enable Controls';
            toggleEnabledBtn.classList.add('enable');
        }

        // Update all device cards
        document.querySelectorAll('.device-card').forEach(card => {
            if (isEnabled) {
                card.classList.remove('disabled');
            } else {
                card.classList.add('disabled');
            }
        });
    }

    /**
     * Listen for enabled state changes from Firebase
     */
    function listenForEnabledState() {
        db.ref('commandcenter/enabled').on('value', (snapshot) => {
            isEnabled = snapshot.val() !== false; // Default to true if not set
            updateEnabledUI();
        });
    }

    /**
     * Fetch devices and their states from the worker
     */
    async function fetchDevices() {
        try {
            const response = await fetch(`${WORKER_URL}/api/state`);
            if (!response.ok) throw new Error('Failed to fetch devices');

            const data = await response.json();
            devices = data.states || {};
            renderDevices();
        } catch (error) {
            console.error('Failed to fetch devices:', error);
            renderDevicesError();
        }
    }

    /**
     * Render device cards
     */
    function renderDevices() {
        const entityIds = Object.keys(devices);

        if (entityIds.length === 0) {
            devicesGrid.innerHTML = `
                <div class="error-message">
                    No devices configured yet. Check back later!
                </div>
            `;
            return;
        }

        devicesGrid.innerHTML = entityIds.map(entityId => {
            const device = devices[entityId];
            const isOn = device.state === 'on';
            const disabledClass = isEnabled ? '' : 'disabled';
            const isLight = entityId.startsWith('light.');
            const isFan = entityId.startsWith('fan.');
            const supportsColor = device.supports_color;

            // Build extra controls HTML
            let extraControls = '';

            // Color picker for color-capable lights
            if (isLight && supportsColor) {
                const currentColor = device.rgb_color
                    ? `rgb(${device.rgb_color.join(',')})`
                    : '#ffffff';
                const presetColors = [
                    { name: 'Red', rgb: [255, 0, 0] },
                    { name: 'Orange', rgb: [255, 128, 0] },
                    { name: 'Yellow', rgb: [255, 255, 0] },
                    { name: 'Green', rgb: [0, 255, 0] },
                    { name: 'Blue', rgb: [0, 128, 255] },
                    { name: 'Purple', rgb: [128, 0, 255] },
                    { name: 'Pink', rgb: [255, 0, 128] },
                    { name: 'White', rgb: [255, 255, 255] }
                ];
                const presetSwatches = presetColors.map(c => `
                    <button
                        class="color-preset"
                        data-entity-id="${entityId}"
                        data-rgb="${c.rgb.join(',')}"
                        style="background: rgb(${c.rgb.join(',')})"
                        title="${c.name}"
                        ${!isEnabled || !isOn ? 'disabled' : ''}
                    ></button>
                `).join('');

                extraControls += `
                    <div class="color-control">
                        <label class="color-label">Color</label>
                        <div class="color-presets">
                            ${presetSwatches}
                            <label class="color-picker-wrapper" title="Custom color">
                                <input
                                    type="color"
                                    class="color-picker"
                                    data-entity-id="${entityId}"
                                    value="${rgbToHex(device.rgb_color || [255, 255, 255])}"
                                    ${!isEnabled || !isOn ? 'disabled' : ''}
                                >
                                <span class="color-picker-icon">+</span>
                            </label>
                        </div>
                        <div class="current-color">
                            <span class="current-color-swatch" style="background: ${currentColor}"></span>
                            <span class="current-color-label">Current</span>
                        </div>
                    </div>
                `;
            }

            // Fan speed controls
            if (isFan) {
                const currentSpeed = device.percentage || 0;
                extraControls += `
                    <div class="fan-control">
                        <label class="fan-label">Speed: ${currentSpeed}%</label>
                        <div class="fan-buttons">
                            <button
                                class="fan-btn ${currentSpeed === 33 ? 'active' : ''}"
                                data-entity-id="${entityId}"
                                data-speed="33"
                                ${!isEnabled || !isOn ? 'disabled' : ''}
                            >Low</button>
                            <button
                                class="fan-btn ${currentSpeed === 66 ? 'active' : ''}"
                                data-entity-id="${entityId}"
                                data-speed="66"
                                ${!isEnabled || !isOn ? 'disabled' : ''}
                            >Med</button>
                            <button
                                class="fan-btn ${currentSpeed === 100 ? 'active' : ''}"
                                data-entity-id="${entityId}"
                                data-speed="100"
                                ${!isEnabled || !isOn ? 'disabled' : ''}
                            >High</button>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="device-card ${disabledClass}" data-entity-id="${entityId}">
                    <div class="device-header">
                        <span class="device-emoji">${device.emoji || '🔌'}</span>
                        <span class="device-name">${device.name}</span>
                    </div>
                    <div class="device-status">
                        <span class="status-dot ${isOn ? 'on' : 'off'}"></span>
                        <span class="status-text">${isOn ? 'ON' : 'OFF'}</span>
                    </div>
                    <button
                        class="device-btn ${isOn ? 'turn-off' : 'turn-on'}"
                        data-entity-id="${entityId}"
                        data-action="${isOn ? 'turn_off' : 'turn_on'}"
                        ${!isEnabled ? 'disabled' : ''}
                    >
                        ${isOn ? 'Turn Off' : 'Turn On'}
                    </button>
                    ${extraControls}
                </div>
            `;
        }).join('');

        // Add click handlers for on/off buttons
        devicesGrid.querySelectorAll('.device-btn').forEach(btn => {
            btn.addEventListener('click', handleDeviceControl);
        });

        // Add color picker handlers
        devicesGrid.querySelectorAll('.color-picker').forEach(picker => {
            picker.addEventListener('change', handleColorChange);
        });

        // Add color preset handlers
        devicesGrid.querySelectorAll('.color-preset').forEach(btn => {
            btn.addEventListener('click', handleColorPreset);
        });

        // Add fan speed button handlers
        devicesGrid.querySelectorAll('.fan-btn').forEach(btn => {
            btn.addEventListener('click', handleFanSpeed);
        });
    }

    /**
     * Convert RGB array to hex color
     */
    function rgbToHex(rgb) {
        return '#' + rgb.map(c => {
            const hex = c.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }

    /**
     * Convert hex color to RGB array
     */
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : [255, 255, 255];
    }

    /**
     * Render error state for devices
     */
    function renderDevicesError() {
        devicesGrid.innerHTML = `
            <div class="error-message">
                Unable to load devices. The command center may be offline.
            </div>
        `;
    }

    /**
     * Handle device control button click
     */
    async function handleDeviceControl(event) {
        const btn = event.currentTarget;
        const entityId = btn.dataset.entityId;
        const action = btn.dataset.action;

        if (!isEnabled) return;

        // Mark that WE are making an action (prevents Firebase refresh flicker)
        lastLocalActionTime = Date.now();

        // Optimistic UI update - instantly toggle the state
        const newState = action === 'turn_on' ? 'on' : 'off';
        updateDeviceUI(entityId, newState);

        try {
            const response = await fetch(`${WORKER_URL}/api/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity_id: entityId, action })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to control device');
            }

            // Success - trust the optimistic update, no need to refetch
            // The periodic refresh will sync state if needed
        } catch (error) {
            console.error('Failed to control device:', error);
            // Revert on error
            await fetchDevices();
            alert(error.message || 'Failed to control device. Please try again.');
        }
    }

    /**
     * Update device UI optimistically without full re-render
     */
    function updateDeviceUI(entityId, newState) {
        const card = document.querySelector(`.device-card[data-entity-id="${entityId}"]`);
        if (!card) return;

        const isOn = newState === 'on';
        const statusDot = card.querySelector('.status-dot');
        const statusText = card.querySelector('.status-text');
        const btn = card.querySelector('.device-btn');

        // Update status indicator
        statusDot.classList.toggle('on', isOn);
        statusDot.classList.toggle('off', !isOn);
        statusText.textContent = isOn ? 'ON' : 'OFF';

        // Update button
        btn.classList.toggle('turn-on', !isOn);
        btn.classList.toggle('turn-off', isOn);
        btn.dataset.action = isOn ? 'turn_off' : 'turn_on';
        btn.textContent = isOn ? 'Turn Off' : 'Turn On';

        // Update local state
        if (devices[entityId]) {
            devices[entityId].state = newState;
        }

        // Enable/disable extra controls based on state
        const colorPicker = card.querySelector('.color-picker');
        const fanButtons = card.querySelectorAll('.fan-btn');

        if (colorPicker) {
            colorPicker.disabled = !isOn || !isEnabled;
        }
        fanButtons.forEach(b => {
            b.disabled = !isOn || !isEnabled;
        });
    }

    /**
     * Handle color picker change
     */
    async function handleColorChange(event) {
        const picker = event.currentTarget;
        const entityId = picker.dataset.entityId;
        const hexColor = picker.value;
        const rgbColor = hexToRgb(hexColor);

        if (!isEnabled) return;

        lastLocalActionTime = Date.now();
        picker.disabled = true;

        try {
            const response = await fetch(`${WORKER_URL}/api/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity_id: entityId,
                    action: 'turn_on',
                    rgb_color: rgbColor
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to set color');
            }

            // Refresh device states immediately
            await fetchDevices();
        } catch (error) {
            console.error('Failed to set color:', error);
            alert(error.message || 'Failed to set color. Please try again.');
        }

        picker.disabled = false;
    }

    /**
     * Handle color preset button click
     */
    async function handleColorPreset(event) {
        const btn = event.currentTarget;
        const entityId = btn.dataset.entityId;
        const rgbColor = btn.dataset.rgb.split(',').map(Number);

        if (!isEnabled) return;

        lastLocalActionTime = Date.now();

        // Disable all color presets for this device
        const presets = document.querySelectorAll(`.color-preset[data-entity-id="${entityId}"]`);
        presets.forEach(p => p.disabled = true);
        btn.classList.add('loading');

        // Optimistic UI update for current color swatch
        const card = document.querySelector(`.device-card[data-entity-id="${entityId}"]`);
        const currentSwatch = card?.querySelector('.current-color-swatch');
        if (currentSwatch) {
            currentSwatch.style.background = `rgb(${rgbColor.join(',')})`;
        }

        try {
            const response = await fetch(`${WORKER_URL}/api/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity_id: entityId,
                    action: 'turn_on',
                    rgb_color: rgbColor
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to set color');
            }
        } catch (error) {
            console.error('Failed to set color:', error);
            alert(error.message || 'Failed to set color. Please try again.');
        }

        btn.classList.remove('loading');
        presets.forEach(p => p.disabled = false);
    }

    /**
     * Handle fan speed button click
     */
    async function handleFanSpeed(event) {
        const btn = event.currentTarget;
        const entityId = btn.dataset.entityId;
        const speed = parseInt(btn.dataset.speed, 10);

        if (!isEnabled) return;

        lastLocalActionTime = Date.now();

        // Disable all fan buttons for this device
        const fanButtons = document.querySelectorAll(`.fan-btn[data-entity-id="${entityId}"]`);
        fanButtons.forEach(b => b.disabled = true);
        btn.classList.add('loading');

        try {
            const response = await fetch(`${WORKER_URL}/api/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity_id: entityId,
                    action: 'set_percentage',
                    percentage: speed
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to set fan speed');
            }

            // Refresh device states immediately
            await fetchDevices();
        } catch (error) {
            console.error('Failed to set fan speed:', error);
            alert(error.message || 'Failed to set fan speed. Please try again.');
        }

        btn.classList.remove('loading');
        fanButtons.forEach(b => b.disabled = false);
    }

    /**
     * Listen for activity log updates from Firebase
     * Also triggers device state refresh when new actions are logged
     */
    function listenForActivityLog() {
        const logRef = db.ref('commandcenter/log').orderByChild('timestamp').limitToLast(10);

        // Listen for value changes to render the log
        logRef.on('value', (snapshot) => {
            const logs = snapshot.val();
            renderActivityLog(logs);

            // Track the latest timestamp for initial load
            if (logs) {
                Object.values(logs).forEach(log => {
                    if (log.timestamp > lastLogTimestamp) {
                        lastLogTimestamp = log.timestamp;
                    }
                });
            }
            isInitialLoad = false;
        });

        // Listen specifically for new entries (more reliable than value for detecting additions)
        logRef.on('child_added', (snapshot) => {
            const log = snapshot.val();
            if (!log || !log.timestamp) return;

            // Skip if this is from initial load (timestamp not newer than what we've seen)
            if (log.timestamp <= lastLogTimestamp) return;

            // Skip if WE just made an action
            const timeSinceLocalAction = Date.now() - lastLocalActionTime;
            if (timeSinceLocalAction < LOCAL_ACTION_COOLDOWN) return;

            // New action from another user - refresh device states
            clearTimeout(refreshDebounceTimer);
            refreshDebounceTimer = setTimeout(() => {
                fetchDevices();
            }, 300);

            lastLogTimestamp = log.timestamp;
        });
    }

    /**
     * Render activity log
     */
    function renderActivityLog(logs) {
        if (!logs) {
            activityLog.innerHTML = '<li class="activity-placeholder">No recent activity</li>';
            return;
        }

        // Convert to array and sort by timestamp (newest first)
        const logArray = Object.values(logs).sort((a, b) => b.timestamp - a.timestamp);

        activityLog.innerHTML = logArray.map(log => {
            const timeAgo = getTimeAgo(log.timestamp);
            const actionClass = log.action === 'turn_on' ? 'action-on' : 'action-off';
            const actionText = log.action === 'turn_on' ? 'turned on' : 'turned off';

            return `
                <li>
                    <span class="activity-action">
                        <span class="${actionClass}">Someone ${actionText}</span>
                        <strong>${log.deviceName || log.entity_id}</strong>
                    </span>
                    <span class="activity-time">${timeAgo}</span>
                </li>
            `;
        }).join('');
    }

    /**
     * Get human-readable time ago string
     */
    function getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    /**
     * Periodically refresh device states
     */
    function startStateRefresh() {
        // Refresh every 30 seconds
        setInterval(fetchDevices, 30000);
    }

    /**
     * Initialize the command center
     */
    function init() {
        initFirebase();
        setupAdminControls();
        listenForEnabledState();
        listenForActivityLog();
        fetchDevices();
        startStateRefresh();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
