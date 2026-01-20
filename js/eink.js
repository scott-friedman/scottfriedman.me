/**
 * E-Ink Display Submission
 * Handles text and image submissions to Firebase Firestore
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ==========================================================================
// Firebase Configuration
// ==========================================================================
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "inky-179bb.firebaseapp.com",
    projectId: "inky-179bb",
    storageBucket: "inky-179bb.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// ==========================================================================
// Constants
// ==========================================================================
const MAX_WIDTH = 800;
const MAX_HEIGHT = 480;
const JPEG_QUALITY = 0.8;
const MAX_BASE64_SIZE = 500 * 1024; // 500KB limit for Firestore

// ==========================================================================
// DOM Elements
// ==========================================================================
const form = document.getElementById('submission-form');
const modeButtons = document.querySelectorAll('.mode-btn');
const textModeSection = document.getElementById('text-mode');
const imageModeSection = document.getElementById('image-mode');
const textContent = document.getElementById('text-content');
const charCurrent = document.getElementById('char-current');
const imageInput = document.getElementById('image-input');
const fileUpload = document.getElementById('file-upload');
const previewContainer = document.getElementById('preview-container');
const previewImage = document.getElementById('preview-image');
const clearImageBtn = document.getElementById('clear-image');
const imageSizeEl = document.getElementById('image-size');
const authorInput = document.getElementById('author-input');
const submitBtn = document.getElementById('submit-btn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoading = submitBtn.querySelector('.btn-loading');
const statusMessage = document.getElementById('status-message');

// ==========================================================================
// State
// ==========================================================================
let currentMode = 'text';
let processedImageBase64 = null;

// ==========================================================================
// Mode Toggle
// ==========================================================================
modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === currentMode) return;

        currentMode = mode;

        // Update button states
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show/hide sections
        if (mode === 'text') {
            textModeSection.classList.remove('hidden');
            imageModeSection.classList.add('hidden');
        } else {
            textModeSection.classList.add('hidden');
            imageModeSection.classList.remove('hidden');
        }

        // Clear status
        hideStatus();
    });
});

// ==========================================================================
// Character Count
// ==========================================================================
textContent.addEventListener('input', () => {
    charCurrent.textContent = textContent.value.length;
});

// ==========================================================================
// Image Handling
// ==========================================================================

/**
 * Resize image to fit within max dimensions and convert to JPEG base64
 */
function resizeImage(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(img.src);

            const canvas = document.createElement('canvas');
            let { width, height } = img;

            // Calculate new dimensions maintaining aspect ratio
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            // White background for transparent images
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            // Get base64 without the data URL prefix
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const base64 = dataUrl.split(',')[1];

            resolve({
                base64,
                width,
                height,
                size: Math.round(base64.length * 0.75) // Approximate byte size
            });
        };

        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Failed to load image'));
        };

        img.src = URL.createObjectURL(file);
    });
}

/**
 * Progressively reduce quality to fit size limit
 */
async function processImage(file) {
    let quality = JPEG_QUALITY;
    let result = await resizeImage(file, MAX_WIDTH, MAX_HEIGHT, quality);

    // If still too large, reduce quality progressively
    while (result.size > MAX_BASE64_SIZE && quality > 0.3) {
        quality -= 0.1;
        result = await resizeImage(file, MAX_WIDTH, MAX_HEIGHT, quality);
    }

    if (result.size > MAX_BASE64_SIZE) {
        throw new Error('Image too large. Please try a smaller image.');
    }

    return result;
}

/**
 * Handle file selection
 */
async function handleFileSelect(file) {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        showStatus('Please select an image file.', 'error');
        return;
    }

    // Validate file size (10MB max before processing)
    if (file.size > 10 * 1024 * 1024) {
        showStatus('Image too large. Maximum size is 10MB.', 'error');
        return;
    }

    try {
        // Show loading state
        fileUpload.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        previewImage.src = '';
        imageSizeEl.textContent = 'Processing...';

        // Process image
        const result = await processImage(file);
        processedImageBase64 = result.base64;

        // Show preview
        previewImage.src = `data:image/jpeg;base64,${result.base64}`;
        imageSizeEl.textContent = `${result.width}x${result.height} | ${formatBytes(result.size)}`;

        hideStatus();
    } catch (error) {
        console.error('Image processing error:', error);
        showStatus(error.message || 'Failed to process image.', 'error');
        clearImage();
    }
}

/**
 * Clear selected image
 */
function clearImage() {
    processedImageBase64 = null;
    imageInput.value = '';
    previewContainer.classList.add('hidden');
    fileUpload.classList.remove('hidden');
    previewImage.src = '';
    imageSizeEl.textContent = '--';
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// File input change
imageInput.addEventListener('change', (e) => {
    handleFileSelect(e.target.files[0]);
});

// Drag and drop
fileUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUpload.classList.add('dragover');
});

fileUpload.addEventListener('dragleave', () => {
    fileUpload.classList.remove('dragover');
});

fileUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUpload.classList.remove('dragover');
    handleFileSelect(e.dataTransfer.files[0]);
});

// Clear button
clearImageBtn.addEventListener('click', clearImage);

// ==========================================================================
// Form Submission
// ==========================================================================
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate
    if (currentMode === 'text') {
        const text = textContent.value.trim();
        if (!text) {
            showStatus('Please enter a message.', 'error');
            return;
        }
    } else {
        if (!processedImageBase64) {
            showStatus('Please select an image.', 'error');
            return;
        }
    }

    // Get author name
    const author = authorInput.value.trim() || 'Anonymous';

    // Set loading state
    setLoading(true);
    hideStatus();

    try {
        // Build document
        const doc = {
            type: currentMode,
            content: currentMode === 'text' ? textContent.value.trim() : processedImageBase64,
            author: author,
            status: 'pending',
            created_at: serverTimestamp()
        };

        // Submit to Firestore
        await addDoc(collection(db, 'inky_submissions'), doc);

        // Success
        showStatus('Sent! Your submission will appear on the display in about 30 seconds.', 'success');

        // Reset form
        if (currentMode === 'text') {
            textContent.value = '';
            charCurrent.textContent = '0';
        } else {
            clearImage();
        }

    } catch (error) {
        console.error('Submission error:', error);
        showStatus('Failed to submit. Please try again.', 'error');
    } finally {
        setLoading(false);
    }
});

// ==========================================================================
// UI Helpers
// ==========================================================================
function setLoading(loading) {
    submitBtn.disabled = loading;
    btnText.classList.toggle('hidden', loading);
    btnLoading.classList.toggle('hidden', !loading);
}

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove('hidden');
}

function hideStatus() {
    statusMessage.classList.add('hidden');
}

// ==========================================================================
// Initialize
// ==========================================================================
console.log('E-Ink submission page loaded');
