/**
 * LitterRobot Dashboard
 * Fetches data from Firebase and displays live status + historical charts
 */

(function() {
    'use strict';

    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
    };

    // Chart instances
    let visitsChart = null;
    let cyclesChart = null;
    let weightChart = null;

    // Store history data globally for re-rendering
    let historyData = {};

    // Current time periods for each chart
    const chartPeriods = {
        visits: 14,
        cycles: 14,
        weight: 14
    };

    // Chart.js default styling
    const chartColors = {
        visits: '#2d5a3d',
        visitsLight: 'rgba(45, 90, 61, 0.15)',
        cycles: '#c45d3a',
        cyclesLight: 'rgba(196, 93, 58, 0.15)',
        weight: '#6b4423',
        weightLight: 'rgba(107, 68, 35, 0.15)',
        gray: '#666',
        gridColor: 'rgba(0, 0, 0, 0.05)'
    };

    // Initialize Firebase
    function initFirebase() {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        return firebase.database();
    }

    // Status code to human-readable text mapping
    const STATUS_MAP = {
        'rdy': 'Ready',
        'ccp': 'Cycle Complete',
        'ccc': 'Cleaning',
        'csf': 'Cat Sensor Fault',
        'df1': 'Drawer Almost Full',
        'df2': 'Drawer Full',
        'dfs': 'Drawer Full',
        'sdf': 'Drawer Full',
        'dhf': 'Dump + Home Fault',
        'dpf': 'Dump Position Fault',
        'ec':  'Empty Cycle',
        'hpf': 'Home Position Fault',
        'off': 'Off',
        'offline': 'Offline',
        'otf': 'Over Torque Fault',
        'p':   'Paused',
        'pause': 'Paused',
        'pd':  'Pinch Detect',
        'spf': 'Sensor Position Fault',
        'br':  'Bonnet Removed',
        'csi': 'Cat Sensor Interrupted',
        'cst': 'Cat Sensor Timing',
        'cd':  'Cat Detected',
        'ready': 'Ready',
        'clean cycle': 'Cleaning',
        'cycling': 'Cleaning',
        'drawer full': 'Drawer Full',
        'idle': 'Ready',
        'unknown': 'Unknown',
        'unavailable': 'Offline'
    };

    function getReadableStatus(statusCode) {
        if (!statusCode) return 'Unknown';
        const lower = statusCode.toLowerCase().trim();
        return STATUS_MAP[lower] || statusCode;
    }

    function timeAgo(timestamp) {
        if (!timestamp) return '--';
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

    function formatDate(dateStr, period) {
        // Parse date string as local time (not UTC) to avoid off-by-one day issue
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        if (period === 'all' || period >= 365) {
            return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        } else if (period >= 30) {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function updateCurrentStatus(data) {
        if (!data) return;

        const statusBadge = document.getElementById('status-badge');
        const rawStatus = data.status || 'Unknown';
        const readableStatus = getReadableStatus(rawStatus);
        statusBadge.textContent = readableStatus;
        statusBadge.className = 'status-badge ' + getStatusClass(readableStatus.toLowerCase());

        const lastUpdated = document.getElementById('last-updated');
        lastUpdated.textContent = timeAgo(data.updatedAt);

        const wastePercent = data.wasteLevel || 0;
        const wasteFill = document.getElementById('waste-fill');
        const wasteText = document.getElementById('waste-percent');
        wasteFill.style.width = wastePercent + '%';
        wasteFill.className = 'progress-fill' + getWasteClass(wastePercent);
        wasteText.textContent = wastePercent + '%';

        const lastCycle = document.getElementById('last-cycle');
        if (data.lastCycle) {
            lastCycle.textContent = timeAgo(new Date(data.lastCycle).getTime());
        } else {
            lastCycle.textContent = '--';
        }

        const lastWeight = document.getElementById('last-weight');
        if (data.lastWeight) {
            lastWeight.textContent = data.lastWeight.toFixed(1) + ' lbs';
        } else {
            lastWeight.textContent = '-- lbs';
        }

        const todayVisits = document.getElementById('today-visits');
        if (todayVisits) {
            todayVisits.textContent = data.todayVisits || 0;
        }

        const todayCycles = document.getElementById('today-cycles');
        if (todayCycles) {
            todayCycles.textContent = data.todayCycles || 0;
        }
    }

    function getStatusClass(status) {
        if (status.includes('ready') || status.includes('idle')) return 'ready';
        if (status.includes('cycling') || status.includes('running')) return 'cycling';
        if (status.includes('full') || status.includes('drawer')) return 'drawer-full';
        if (status.includes('offline') || status.includes('unavailable')) return 'offline';
        if (status.includes('error') || status.includes('fault')) return 'error';
        return 'ready';
    }

    function getWasteClass(percent) {
        if (percent >= 80) return ' danger';
        if (percent >= 60) return ' warning';
        return '';
    }

    // Get common chart options
    function getChartOptions(period) {
        const maxTicks = period === 'all' || period >= 365 ? 12 : (period >= 30 ? 10 : 7);
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        maxTicksLimit: 5,
                        font: { size: 10 },
                        color: chartColors.gray
                    },
                    grid: { color: chartColors.gridColor }
                },
                x: {
                    ticks: {
                        maxTicksLimit: maxTicks,
                        font: { size: 9 },
                        color: chartColors.gray
                    },
                    grid: { display: false }
                }
            },
            elements: {
                point: {
                    radius: period >= 30 ? 1 : 2,
                    hoverRadius: 4
                },
                line: {
                    tension: 0.3
                }
            }
        };
    }

    // Get date range based on period
    function getDateRange(period) {
        const today = new Date();
        const dates = [];

        if (period === 'all') {
            // Return all dates from history
            return Object.keys(historyData).sort();
        }

        for (let i = period - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        return dates;
    }

    // Initialize/update visits chart
    function updateVisitsChart(period) {
        const ctx = document.getElementById('visits-chart');
        if (!ctx) return;

        const dates = getDateRange(period);
        const labels = dates.map(d => formatDate(d, period));
        const data = dates.map(d => historyData[d]?.visits || historyData[d]?.cycles || 0);

        if (visitsChart) {
            visitsChart.data.labels = labels;
            visitsChart.data.datasets[0].data = data;
            visitsChart.options = getChartOptions(period);
            visitsChart.update();
            return;
        }

        visitsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Visits',
                    data: data,
                    backgroundColor: chartColors.visitsLight,
                    borderColor: chartColors.visits,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: getChartOptions(period)
        });
    }

    // Initialize/update cycles chart
    function updateCyclesChart(period) {
        const ctx = document.getElementById('cycles-chart');
        if (!ctx) return;

        const dates = getDateRange(period);
        const labels = dates.map(d => formatDate(d, period));
        const data = dates.map(d => historyData[d]?.cycles || 0);

        if (cyclesChart) {
            cyclesChart.data.labels = labels;
            cyclesChart.data.datasets[0].data = data;
            cyclesChart.options = getChartOptions(period);
            cyclesChart.update();
            return;
        }

        cyclesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cycles',
                    data: data,
                    backgroundColor: chartColors.cyclesLight,
                    borderColor: chartColors.cycles,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: getChartOptions(period)
        });
    }

    // Initialize/update weight chart
    function updateWeightChart(period) {
        const ctx = document.getElementById('weight-chart');
        if (!ctx) return;

        const dates = getDateRange(period);
        const weights = [];
        const labels = [];

        dates.forEach(dateKey => {
            const dayData = historyData[dateKey];
            if (dayData) {
                if (dayData.weights && dayData.weights.length) {
                    dayData.weights.forEach(w => {
                        weights.push(w);
                        labels.push(formatDate(dateKey, period));
                    });
                } else if (dayData.avgWeight) {
                    weights.push(dayData.avgWeight);
                    labels.push(formatDate(dateKey, period));
                }
            }
        });

        if (weights.length === 0) return;

        const options = getChartOptions(period);
        options.scales.y.ticks.callback = (value) => value.toFixed(1);
        options.plugins.tooltip = {
            callbacks: {
                label: (context) => context.parsed.y.toFixed(1) + ' lbs'
            }
        };

        if (weightChart) {
            weightChart.data.labels = labels;
            weightChart.data.datasets[0].data = weights;
            weightChart.options = options;
            weightChart.update();
            return;
        }

        weightChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Weight (lbs)',
                    data: weights,
                    backgroundColor: chartColors.weightLight,
                    borderColor: chartColors.weight,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: options
        });
    }

    // Handle toggle button clicks
    function setupToggleListeners() {
        document.querySelectorAll('.chart-toggles').forEach(toggleGroup => {
            const chartType = toggleGroup.dataset.chart;

            toggleGroup.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Update active state
                    toggleGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // Get period
                    const days = btn.dataset.days;
                    const period = days === 'all' ? 'all' : parseInt(days);
                    chartPeriods[chartType] = period;

                    // Update the appropriate chart
                    if (chartType === 'visits') {
                        updateVisitsChart(period);
                    } else if (chartType === 'cycles') {
                        updateCyclesChart(period);
                    } else if (chartType === 'weight') {
                        updateWeightChart(period);
                    }
                });
            });
        });
    }

    function loadData() {
        const db = initFirebase();

        db.ref('litterrobot/current').once('value').then((snapshot) => {
            const data = snapshot.val();
            updateCurrentStatus(data);
        }).catch(err => {
            console.log('Error fetching current status:', err);
        });

        db.ref('litterrobot/history').once('value').then((snapshot) => {
            historyData = snapshot.val() || {};
            updateVisitsChart(chartPeriods.visits);
            updateCyclesChart(chartPeriods.cycles);
            updateWeightChart(chartPeriods.weight);
        }).catch(err => {
            console.log('Error fetching history:', err);
        });
    }

    function setupRealtimeUpdates() {
        const db = initFirebase();

        db.ref('litterrobot/current').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                updateCurrentStatus(data);
            }
        });
    }

    function init() {
        setupToggleListeners();
        loadData();
        setupRealtimeUpdates();

        // Refresh charts every 5 minutes
        setInterval(() => {
            const db = initFirebase();
            db.ref('litterrobot/history').once('value').then((snapshot) => {
                historyData = snapshot.val() || {};
                updateVisitsChart(chartPeriods.visits);
                updateCyclesChart(chartPeriods.cycles);
                updateWeightChart(chartPeriods.weight);
            });
        }, 300000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
