// ==UserScript==
// @name         Chaturbate Hover Preview
// @namespace    https://github.com/danmaclann
// @version      1.0
// @license      MIT
// @description  Replaces the card image with a stream.
// @author       danmaclann
// @match        https://chaturbate.com/
// @match        https://chaturbate.com/female-cams/
// @match        https://chaturbate.com/couple-cams/
// @match        https://chaturbate.com/male-cams/
// @match        https://chaturbate.com/trans-cams/
// @require      https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js
// @run-at       document-idle
// @downloadURL  https://github.com/danmaclann/chaturbate_preview/raw/refs/heads/main/chaturbate_preview.user.js
// @updateURL    https://github.com/danmaclann/chaturbate_preview/raw/refs/heads/main/chaturbate_preview.user.js
// @icon         https://web.static.mmcdn.com/favicons/favicon.ico
// ==/UserScript==

(function() {
    'use strict';

    // === CONFIGURATION ===
    const DEBUG = false;         // Set to true for console logs
    const VIDEO_SCALE = 1.0;     // 1.0 = Exact fit. 1.2 = Zoomed in 20%.
    const HOVER_DELAY = 400;     // Delay before loading
    // =====================

    let currentPlayer = null;
    let currentContainer = null;
    let originalImage = null;
    let hoverTimeout = null;

    function log(...args) { if (DEBUG) console.log('[CB-PREVIEW]', ...args); }

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    async function getStreamUrl(roomSlug) {
        log(`Fetching: ${roomSlug}`);
        const csrftoken = getCookie('csrftoken');
        if (!csrftoken) throw new Error('No CSRF token');

        const formData = new URLSearchParams();
        formData.append('room_slug', roomSlug);
        formData.append('bandwidth', 'high');

        try {
            const response = await fetch('/get_edge_hls_url_ajax/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrftoken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const data = await response.json();
            if (data.url) return data.url;
            throw new Error('No URL');
        } catch (error) {
            log('Fetch failed', error);
            throw error;
        }
    }

    function createVideoPlayer(container, m3u8Url) {
        const img = container.querySelector('img.room_thumbnail');
        if (!img) return;

        // 1. LOCK DIMENSIONS: Get the exact current size of the image
        const width = img.clientWidth;
        const height = img.clientHeight;

        originalImage = img.cloneNode(true);
        currentContainer = container;

        // Save original overflow style to restore later
        container.dataset.originalOverflow = container.style.overflow || '';

        const video = document.createElement('video');

        // 2. APPLY DIMENSIONS: Force video to be exactly that size
        video.style.width = `${width}px`;
        video.style.height = `${height}px`;

        // 3. SCALING: Only affects the video content
        video.style.objectFit = 'cover';
        if (VIDEO_SCALE !== 1.0) {
            video.style.transform = `scale(${VIDEO_SCALE})`;
            video.style.transformOrigin = 'center center';
            // Clip the container so zoomed video doesn't bleed out
            container.style.overflow = 'hidden';
        }

        video.className = img.className; // Keep rounded corners/borders
        video.style.display = 'block';
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;

        img.replaceWith(video);

        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hls.loadSource(m3u8Url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            hls.on(Hls.Events.ERROR, (e, data) => { if (data.fatal) cleanupPlayer(); });
            currentPlayer = hls;
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = m3u8Url;
            video.addEventListener('loadedmetadata', () => video.play());
        }
    }

    function cleanupPlayer() {
        if (hoverTimeout) clearTimeout(hoverTimeout);
        if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }

        if (currentContainer && originalImage) {
            const video = currentContainer.querySelector('video');
            if (video) video.replaceWith(originalImage);

            // Restore original overflow (important!)
            currentContainer.style.overflow = currentContainer.dataset.originalOverflow;

            currentContainer = null;
            originalImage = null;
        }
    }

    function addListeners() {
        const cards = document.querySelectorAll('li.roomCard');
        cards.forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            const thumbContainer = card.querySelector('.room_thumbnail_container');
            if (!thumbContainer) return;

            const roomSlug = thumbContainer.getAttribute('data-room');
            if (!roomSlug) return;

            card.addEventListener('mouseenter', () => {
                hoverTimeout = setTimeout(async () => {
                    if (currentContainer) cleanupPlayer();
                    try {
                        const url = await getStreamUrl(roomSlug);
                        // Check if mouse is still hovering THIS card
                        if (card.matches(':hover')) createVideoPlayer(thumbContainer, url);
                    } catch (e) {}
                }, HOVER_DELAY);
            });

            card.addEventListener('mouseleave', () => cleanupPlayer());
        });
    }

    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                shouldUpdate = true;
                break;
            }
        }
        if (shouldUpdate) addListeners();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    addListeners();
    log('Loaded (Stable v7.0)');
})();
