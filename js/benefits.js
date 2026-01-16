/**
 * Benefits of Everything
 * Find positive aspects of anything using AI
 */

(function() {
    'use strict';

    // Configuration
    const WORKER_URL = 'https://benefits-api.s-friedman.workers.dev';
    const HISTORY_LIMIT = 20;

    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
    };

    // DOM elements
    const queryInput = document.getElementById('query-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const loadingSection = document.getElementById('loading');
    const errorSection = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const retryBtn = document.getElementById('retry-btn');
    const resultsSection = document.getElementById('results');
    const resultQuery = document.getElementById('result-query');
    const cacheBadge = document.getElementById('cache-badge');
    const benefitsList = document.getElementById('benefits-list');
    const tipsList = document.getElementById('tips-list');
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');

    // State
    let db = null;
    let historyRef = null;
    let cacheRef = null;
    let lastQuery = '';
    let historyData = {};

    /**
     * Initialize Firebase
     */
    function initFirebase() {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.database();
        historyRef = db.ref('benefits/history');
        cacheRef = db.ref('benefits/cache');

        // Listen for history changes (real-time)
        historyRef.orderByChild('timestamp').limitToLast(HISTORY_LIMIT).on('value', (snapshot) => {
            historyData = snapshot.val() || {};
            renderHistory();
        });
    }

    /**
     * Show a specific section, hide others
     */
    function showSection(section) {
        [loadingSection, errorSection, resultsSection].forEach(s => {
            s.classList.add('hidden');
        });
        if (section) {
            section.classList.remove('hidden');
        }
    }

    /**
     * Normalize query for comparison
     */
    function normalizeQuery(query) {
        return query.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Generate Firebase-safe key from query
     */
    function queryToKey(query) {
        return normalizeQuery(query)
            .replace(/[.#$\[\]\/]/g, '_')
            .replace(/\s/g, '_')
            .substring(0, 100);
    }

    /**
     * Check local cache first, then Firebase cache
     */
    async function checkCache(normalizedQuery) {
        const cacheKey = queryToKey(normalizedQuery);
        try {
            const snapshot = await cacheRef.child(cacheKey).once('value');
            return snapshot.val();
        } catch (error) {
            console.error('Cache check error:', error);
            return null;
        }
    }

    /**
     * Save to history (add new entry or update existing)
     */
    async function saveToHistory(query, normalizedQuery) {
        // Check if this query already exists in history
        const existingKey = Object.keys(historyData).find(key => {
            return historyData[key].normalizedQuery === normalizedQuery;
        });

        if (existingKey) {
            // Update existing entry: increment click count and update timestamp
            await historyRef.child(existingKey).update({
                timestamp: Date.now(),
                clickCount: (historyData[existingKey].clickCount || 1) + 1
            });
        } else {
            // Add new entry
            await historyRef.push({
                query: query,
                normalizedQuery: normalizedQuery,
                timestamp: Date.now(),
                clickCount: 1
            });
        }
    }

    /**
     * Increment click count for a history item
     */
    async function incrementHistoryClick(key) {
        const current = historyData[key];
        if (current) {
            await historyRef.child(key).update({
                clickCount: (current.clickCount || 1) + 1
            });
        }
    }

    /**
     * Fetch benefits from the API
     */
    async function fetchBenefits(query) {
        showSection(loadingSection);
        const normalizedQuery = normalizeQuery(query);

        try {
            // Check Firebase cache first
            const cached = await checkCache(normalizedQuery);
            if (cached && cached.benefits && cached.usageTips) {
                renderResults({
                    benefits: cached.benefits,
                    usageTips: cached.usageTips,
                    query: query,
                    cached: true
                });
                // Still save to history (updates timestamp/count)
                await saveToHistory(query, normalizedQuery);
                return;
            }

            // Call the API
            const response = await fetch(`${WORKER_URL}/api/benefits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch benefits');
            }

            renderResults(data);

            // Save to history
            await saveToHistory(query, normalizedQuery);

        } catch (error) {
            console.error('Error:', error);
            showError(error.message);
        }
    }

    /**
     * Render the results
     */
    function renderResults(data) {
        resultQuery.textContent = data.query;

        // Show/hide cache badge
        if (data.cached) {
            cacheBadge.classList.remove('hidden');
        } else {
            cacheBadge.classList.add('hidden');
        }

        // Render benefits
        benefitsList.innerHTML = data.benefits.map(benefit =>
            `<li>${escapeHtml(benefit)}</li>`
        ).join('');

        // Render tips
        tipsList.innerHTML = data.usageTips.map(tip =>
            `<li>${escapeHtml(tip)}</li>`
        ).join('');

        showSection(resultsSection);

        // Scroll results into view on mobile
        if (window.innerWidth <= 600) {
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Show error state
     */
    function showError(message) {
        errorMessage.textContent = `ERROR: ${message}`;
        showSection(errorSection);
    }

    /**
     * Render history list
     */
    function renderHistory() {
        const entries = Object.entries(historyData);

        if (entries.length === 0) {
            historyEmpty.classList.remove('hidden');
            // Clear any existing items
            const items = historyList.querySelectorAll('.history-item');
            items.forEach(item => item.remove());
            return;
        }

        historyEmpty.classList.add('hidden');

        // Sort by timestamp descending (most recent first)
        entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

        // Build HTML
        const html = entries.map(([key, item]) => {
            const count = item.clickCount || 1;
            const countText = count === 1 ? '1 view' : `${count} views`;
            return `
                <div class="history-item" data-key="${key}" data-query="${escapeHtml(item.query)}">
                    <span class="history-prompt">&gt;</span>
                    <span class="history-query">${escapeHtml(item.query)}</span>
                    <span class="history-dots">···</span>
                    <span class="history-count">(${countText})</span>
                </div>
            `;
        }).join('');

        // Replace content (keep the empty message element)
        const items = historyList.querySelectorAll('.history-item');
        items.forEach(item => item.remove());
        historyList.insertAdjacentHTML('beforeend', html);

        // Add click handlers
        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const key = item.dataset.key;
                const query = item.dataset.query;
                handleHistoryClick(key, query);
            });
        });
    }

    /**
     * Handle click on history item
     */
    async function handleHistoryClick(key, query) {
        queryInput.value = query;
        lastQuery = query;

        // Increment click count
        await incrementHistoryClick(key);

        // Fetch (will use cache)
        fetchBenefits(query);
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Handle form submission
     */
    function handleSubmit() {
        const query = queryInput.value.trim();

        if (!query) {
            queryInput.focus();
            return;
        }

        if (query.length < 2) {
            showError('Query too short. Enter at least 2 characters.');
            return;
        }

        lastQuery = query;
        fetchBenefits(query);
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        // Submit button
        analyzeBtn.addEventListener('click', handleSubmit);

        // Enter key
        queryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        });

        // Retry button
        retryBtn.addEventListener('click', () => {
            if (lastQuery) {
                fetchBenefits(lastQuery);
            } else {
                showSection(null);
                queryInput.focus();
            }
        });
    }

    /**
     * Initialize
     */
    function init() {
        initFirebase();
        initEventListeners();
        queryInput.focus();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
