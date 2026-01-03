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
    let cyclesChart = null;
    let weightChart = null;

    // Chart.js default styling
    const chartColors = {
        primary: '#2d5a3d',
        primaryLight: 'rgba(45, 90, 61, 0.2)',
        secondary: '#c45d3a',
        secondaryLight: 'rgba(196, 93, 58, 0.2)',
        gray: '#666',
        gridColor: 'rgba(0, 0, 0, 0.05)'
    };

    // Initialize Firebase (may already be initialized by main.js)
    function initFirebase() {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        return firebase.database();
    }

    // Format relative time
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

    // Format date for display
    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Update current status display
    function updateCurrentStatus(data) {
        if (!data) {
            showNoData();
            return;
        }

        // Status badge
        const statusBadge = document.getElementById('status-badge');
        const status = (data.status || 'Unknown').toLowerCase();
        statusBadge.textContent = data.status || 'Unknown';
        statusBadge.className = 'status-badge ' + getStatusClass(status);

        // Last updated
        const lastUpdated = document.getElementById('last-updated');
        lastUpdated.textContent = timeAgo(data.updatedAt);

        // Waste level
        const wastePercent = data.wasteLevel || 0;
        const wasteFill = document.getElementById('waste-fill');
        const wasteText = document.getElementById('waste-percent');

        wasteFill.style.width = wastePercent + '%';
        wasteFill.className = 'progress-fill' + getWasteClass(wastePercent);
        wasteText.textContent = wastePercent + '%';

        // Last cycle
        const lastCycle = document.getElementById('last-cycle');
        if (data.lastCycle) {
            lastCycle.textContent = timeAgo(new Date(data.lastCycle).getTime());
        } else {
            lastCycle.textContent = '--';
        }

        // Last weight
        const lastWeight = document.getElementById('last-weight');
        if (data.lastWeight) {
            lastWeight.textContent = data.lastWeight.toFixed(1) + ' kg';
        } else {
            lastWeight.textContent = '-- kg';
        }
    }

    // Get CSS class for status
    function getStatusClass(status) {
        if (status.includes('ready') || status.includes('idle')) return 'ready';
        if (status.includes('cycling') || status.includes('running')) return 'cycling';
        if (status.includes('full') || status.includes('drawer')) return 'drawer-full';
        if (status.includes('offline') || status.includes('unavailable')) return 'offline';
        if (status.includes('error') || status.includes('fault')) return 'error';
        return 'ready';
    }

    // Get CSS class for waste level
    function getWasteClass(percent) {
        if (percent >= 80) return ' danger';
        if (percent >= 60) return ' warning';
        return '';
    }

    // Show no data state
    function showNoData() {
        const statusSection = document.getElementById('current-status');
        statusSection.innerHTML = `
            <div class="no-data">
                <p>No data available yet</p>
                <p class="hint">Set up your Home Assistant automation to start sending data.</p>
            </div>
        `;
    }

    // Initialize cycles chart
    function initCyclesChart(historyData) {
        const ctx = document.getElementById('cycles-chart');
        if (!ctx) return;

        // Prepare data - last 14 days
        const labels = [];
        const data = [];
        const today = new Date();

        for (let i = 13; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            labels.push(formatDate(dateKey));
            data.push(historyData[dateKey]?.cycles || 0);
        }

        // Update today's cycles stat
        const todayKey = today.toISOString().split('T')[0];
        const todayCycles = document.getElementById('today-cycles');
        todayCycles.textContent = historyData[todayKey]?.cycles || 0;

        if (cyclesChart) {
            cyclesChart.data.labels = labels;
            cyclesChart.data.datasets[0].data = data;
            cyclesChart.update();
            return;
        }

        cyclesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cycles',
                    data: data,
                    backgroundColor: chartColors.primaryLight,
                    borderColor: chartColors.primary,
                    borderWidth: 2,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            color: chartColors.gray
                        },
                        grid: {
                            color: chartColors.gridColor
                        }
                    },
                    x: {
                        ticks: {
                            color: chartColors.gray,
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // Initialize weight chart
    function initWeightChart(historyData) {
        const ctx = document.getElementById('weight-chart');
        if (!ctx) return;

        // Collect all weights from history
        const weights = [];
        const labels = [];

        Object.keys(historyData)
            .sort()
            .slice(-14)
            .forEach(dateKey => {
                const dayData = historyData[dateKey];
                if (dayData.weights && dayData.weights.length) {
                    dayData.weights.forEach((w, i) => {
                        weights.push(w);
                        labels.push(formatDate(dateKey));
                    });
                } else if (dayData.avgWeight) {
                    weights.push(dayData.avgWeight);
                    labels.push(formatDate(dateKey));
                }
            });

        if (weights.length === 0) {
            document.getElementById('weight-note').textContent = 'No weight data yet';
            return;
        }

        document.getElementById('weight-note').textContent = `${weights.length} measurements`;

        if (weightChart) {
            weightChart.data.labels = labels;
            weightChart.data.datasets[0].data = weights;
            weightChart.update();
            return;
        }

        weightChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Weight (kg)',
                    data: weights,
                    backgroundColor: chartColors.secondaryLight,
                    borderColor: chartColors.secondary,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            color: chartColors.gray,
                            callback: (value) => value + ' kg'
                        },
                        grid: {
                            color: chartColors.gridColor
                        }
                    },
                    x: {
                        ticks: {
                            color: chartColors.gray,
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // Fetch and display all data
    function loadData() {
        const db = initFirebase();

        // Fetch current status
        db.ref('litterrobot/current').once('value').then((snapshot) => {
            const data = snapshot.val();
            updateCurrentStatus(data);
        }).catch(err => {
            console.log('Error fetching current status:', err);
            showNoData();
        });

        // Fetch history
        db.ref('litterrobot/history').once('value').then((snapshot) => {
            const history = snapshot.val() || {};
            initCyclesChart(history);
            initWeightChart(history);
        }).catch(err => {
            console.log('Error fetching history:', err);
        });
    }

    // Real-time updates for current status
    function setupRealtimeUpdates() {
        const db = initFirebase();

        db.ref('litterrobot/current').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                updateCurrentStatus(data);
            }
        });
    }

    // Initialize dashboard
    function init() {
        loadData();
        setupRealtimeUpdates();

        // Refresh charts every 5 minutes
        setInterval(() => {
            const db = initFirebase();
            db.ref('litterrobot/history').once('value').then((snapshot) => {
                const history = snapshot.val() || {};
                initCyclesChart(history);
                initWeightChart(history);
            });
        }, 300000);
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
