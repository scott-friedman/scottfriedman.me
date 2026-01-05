/**
 * Sticky Notes - Collaborative Message Board
 * Allows users to create, position, and share sticky notes
 */

(function() {
    'use strict';

    // Firebase config (same as main.js)
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCFKStIkbW_omKXd7TQb3jUVuBJA4g3zqo",
        authDomain: "scottfriedman-f400d.firebaseapp.com",
        databaseURL: "https://scottfriedman-f400d-default-rtdb.firebaseio.com",
        projectId: "scottfriedman-f400d",
        storageBucket: "scottfriedman-f400d.firebasestorage.app",
        messagingSenderId: "1046658110090",
        appId: "1:1046658110090:web:49a24a0ff13b19cb111373"
    };

    const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
    const FONTS = [
        { id: 'caveat', label: 'Aa', family: "'Caveat', cursive" },
        { id: 'patrick', label: 'Aa', family: "'Patrick Hand', cursive" },
        { id: 'marker', label: 'Aa', family: "'Permanent Marker', cursive" }
    ];

    let db = null;
    let notesRef = null;
    const notes = {};

    // DOM Elements
    const container = document.getElementById('notes-container');
    const addBtn = document.getElementById('add-note-btn');

    // Currently editing note element (not yet saved to Firebase)
    let editingNote = null;

    // Drag state
    let draggedNote = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    /**
     * Check if current user is admin
     */
    function isAdmin() {
        return localStorage.getItem('admin_auth') === 'true';
    }

    /**
     * Initialize Firebase
     */
    function initFirebase() {
        // Firebase may already be initialized by main.js
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.database();
        notesRef = db.ref('stickynotes');

        // Listen for notes
        notesRef.on('child_added', (snapshot) => {
            const note = snapshot.val();
            const id = snapshot.key;
            notes[id] = note;
            renderNote(id, note, true);
        });

        notesRef.on('child_changed', (snapshot) => {
            const note = snapshot.val();
            const id = snapshot.key;
            notes[id] = note;
            updateNotePosition(id, note);
        });

        notesRef.on('child_removed', (snapshot) => {
            const id = snapshot.key;
            delete notes[id];
            removeNoteElement(id);
        });
    }

    /**
     * Render a saved sticky note
     */
    function renderNote(id, note, isNew = false) {
        // Check if note already exists
        if (document.querySelector(`[data-note-id="${id}"]`)) {
            updateNotePosition(id, note);
            return;
        }

        const el = document.createElement('div');
        el.className = 'sticky-note' + (isNew ? ' new' : '');
        el.dataset.noteId = id;
        el.dataset.color = note.color || 'yellow';
        el.dataset.font = note.font || 'caveat';
        el.style.cssText = `
            left: ${note.x}%;
            top: ${note.y}px;
            --rotation: ${note.rotation || 0}deg;
        `;

        // Note text
        const textEl = document.createElement('div');
        textEl.className = 'note-text';
        textEl.textContent = note.text;
        el.appendChild(textEl);

        // Delete button (admin only)
        if (isAdmin()) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-note';
            deleteBtn.textContent = '\u00d7';
            deleteBtn.title = 'Delete note';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNote(id);
            });
            el.appendChild(deleteBtn);
        }

        // Setup drag events
        setupDrag(el, id);

        container.appendChild(el);

        // Remove new class after animation
        if (isNew) {
            setTimeout(() => el.classList.remove('new'), 400);
        }
    }

    /**
     * Create a new editable note (not yet saved)
     */
    function createEditableNote() {
        // If already editing one, cancel it first
        if (editingNote) {
            cancelEdit();
        }

        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const font = 'caveat';

        // Position near center of viewport
        const x = 30 + Math.random() * 40;
        const y = 100 + Math.random() * 150 + window.scrollY;
        const rotation = (Math.random() - 0.5) * 10;

        const el = document.createElement('div');
        el.className = 'sticky-note editing new';
        el.dataset.color = color;
        el.dataset.font = font;
        el.style.cssText = `
            left: ${x}%;
            top: ${y}px;
            --rotation: ${rotation}deg;
        `;

        // Hidden text element (will show after saving)
        const textEl = document.createElement('div');
        textEl.className = 'note-text';
        el.appendChild(textEl);

        // Textarea for editing
        const textarea = document.createElement('textarea');
        textarea.className = 'note-textarea';
        textarea.placeholder = 'Write something...';
        textarea.maxLength = 200;
        el.appendChild(textarea);

        // Options bar
        const options = document.createElement('div');
        options.className = 'note-options';

        // Color buttons
        const colorsDiv = document.createElement('div');
        colorsDiv.className = 'note-colors';
        COLORS.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'note-color-btn' + (c === color ? ' active' : '');
            btn.dataset.color = c;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                colorsDiv.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                el.dataset.color = c;
            });
            colorsDiv.appendChild(btn);
        });
        options.appendChild(colorsDiv);

        // Divider
        const div1 = document.createElement('span');
        div1.className = 'options-divider';
        options.appendChild(div1);

        // Font buttons
        const fontsDiv = document.createElement('div');
        fontsDiv.className = 'note-fonts';
        FONTS.forEach(f => {
            const btn = document.createElement('button');
            btn.className = 'note-font-btn' + (f.id === font ? ' active' : '');
            btn.dataset.font = f.id;
            btn.style.fontFamily = f.family;
            btn.textContent = f.label;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                fontsDiv.querySelectorAll('.note-font-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                el.dataset.font = f.id;
            });
            fontsDiv.appendChild(btn);
        });
        options.appendChild(fontsDiv);

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'note-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelEdit();
        });
        options.appendChild(cancelBtn);

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'note-save-btn';
        saveBtn.textContent = 'Stick it!';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            saveEditingNote();
        });
        options.appendChild(saveBtn);

        el.appendChild(options);
        container.appendChild(el);

        editingNote = el;

        // Focus textarea after animation
        setTimeout(() => {
            textarea.focus();
            el.classList.remove('new');
        }, 100);

        // Setup drag for the editing note
        setupDrag(el, null);
    }

    /**
     * Save the currently editing note to Firebase
     */
    function saveEditingNote() {
        if (!editingNote) return;

        const textarea = editingNote.querySelector('.note-textarea');
        const text = textarea.value.trim();

        if (!text) {
            textarea.focus();
            return;
        }

        const note = {
            text: text,
            color: editingNote.dataset.color,
            font: editingNote.dataset.font,
            x: parseFloat(editingNote.style.left),
            y: parseFloat(editingNote.style.top),
            rotation: parseFloat(getComputedStyle(editingNote).getPropertyValue('--rotation')),
            createdAt: Date.now()
        };

        // Remove the editing note from DOM
        editingNote.remove();
        editingNote = null;

        // Push to Firebase (will trigger child_added and render)
        notesRef.push(note);
    }

    /**
     * Cancel editing and remove unsaved note
     */
    function cancelEdit() {
        if (editingNote) {
            editingNote.remove();
            editingNote = null;
        }
    }

    /**
     * Update note position in DOM
     */
    function updateNotePosition(id, note) {
        const el = document.querySelector(`[data-note-id="${id}"]`);
        if (!el) return;

        // Only update if we're not currently dragging this note
        if (el.classList.contains('dragging')) return;

        el.style.left = `${note.x}%`;
        el.style.top = `${note.y}px`;
    }

    /**
     * Remove note element from DOM
     */
    function removeNoteElement(id) {
        const el = document.querySelector(`[data-note-id="${id}"]`);
        if (el) {
            el.style.transform = 'scale(0) rotate(20deg)';
            el.style.opacity = '0';
            el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            setTimeout(() => el.remove(), 300);
        }
    }

    /**
     * Setup drag and drop for a note
     */
    function setupDrag(el, noteId) {
        el.addEventListener('mousedown', startDrag);
        el.addEventListener('touchstart', startDrag, { passive: false });

        function startDrag(e) {
            // Ignore if clicking buttons/textarea
            if (e.target.tagName === 'BUTTON' ||
                e.target.tagName === 'TEXTAREA' ||
                e.target.closest('button')) {
                return;
            }

            e.preventDefault();
            draggedNote = el;
            el.classList.add('dragging');

            const rect = el.getBoundingClientRect();
            const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
            const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

            dragOffsetX = clientX - rect.left;
            dragOffsetY = clientY - rect.top;
        }
    }

    /**
     * Handle drag movement
     */
    function onDrag(e) {
        if (!draggedNote) return;

        e.preventDefault();
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        // Calculate new position
        const newX = clientX - dragOffsetX;
        const newY = clientY - dragOffsetY + window.scrollY;

        // Convert to percentage for x
        const xPercent = (newX / window.innerWidth) * 100;

        // Clamp values
        const clampedX = Math.max(0, Math.min(xPercent, 100 - (200 / window.innerWidth * 100)));
        const clampedY = Math.max(0, newY);

        draggedNote.style.left = `${clampedX}%`;
        draggedNote.style.top = `${clampedY}px`;
    }

    /**
     * Handle drag end
     */
    function onDragEnd() {
        if (!draggedNote) return;

        const noteId = draggedNote.dataset.noteId;
        draggedNote.classList.remove('dragging');
        draggedNote.classList.add('dropped');

        // Get final position
        const xPercent = parseFloat(draggedNote.style.left);
        const yPixels = parseFloat(draggedNote.style.top);

        // Only save to Firebase if this is a saved note (has ID)
        if (noteId) {
            notesRef.child(noteId).update({
                x: xPercent,
                y: yPixels
            });
        }

        // Remove dropped class after animation
        const note = draggedNote;
        setTimeout(() => {
            note.classList.remove('dropped');
        }, 300);

        draggedNote = null;
    }

    /**
     * Delete a note (admin only)
     */
    function deleteNote(noteId) {
        if (!isAdmin()) return;

        if (confirm('Delete this note?')) {
            notesRef.child(noteId).remove();
        }
    }

    /**
     * Setup event listeners
     */
    function setupEvents() {
        // Add note button
        addBtn.addEventListener('click', createEditableNote);

        // Drag events on document
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchend', onDragEnd);

        // Escape to cancel editing
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && editingNote) {
                cancelEdit();
            }
        });
    }

    /**
     * Initialize
     */
    function init() {
        setupEvents();
        initFirebase();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
