/**
 * Shared Firebase Configuration
 * Centralizes Firebase configuration for all pages
 */

// Firebase configurations for different projects
const FIREBASE_CONFIGS = {
    main: {
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
    },
    eink: {
        apiKey: "AIzaSyBxxG0U3hg9Pv13fCY_e9lMaCseozloOcQ",
        authDomain: "inky-179bb.firebaseapp.com",
        projectId: "inky-179bb",
        storageBucket: "inky-179bb.firebasestorage.app",
        messagingSenderId: "817484798144",
        appId: "1:817484798144:web:8e42f66edae0976d573525"
    }
};

/**
 * Initialize Firebase with the specified configuration
 * @param {string} configKey - 'main' or 'eink'
 * @returns {firebase.app.App} The initialized Firebase app
 */
function initFirebaseApp(configKey = 'main') {
    const config = FIREBASE_CONFIGS[configKey];
    if (!config) {
        throw new Error(`Unknown Firebase config: ${configKey}`);
    }

    // Prevent re-initialization
    if (!firebase.apps.length) {
        return firebase.initializeApp(config);
    }
    return firebase.app();
}

/**
 * Get Firebase config for a specific project
 * @param {string} configKey - 'main' or 'eink'
 * @returns {Object} The Firebase configuration object
 */
function getFirebaseConfig(configKey = 'main') {
    return FIREBASE_CONFIGS[configKey];
}

// Export for ES6 module usage (eink.js)
if (typeof window !== 'undefined') {
    window.FIREBASE_CONFIGS = FIREBASE_CONFIGS;
    window.initFirebaseApp = initFirebaseApp;
    window.getFirebaseConfig = getFirebaseConfig;
}
