// ==UserScript==
// @name         Chaturbate Hover Preview
// @namespace    https://github.com/danmaclann
// @version      1.003
// @license      MIT
// @description  Replaces the card image with a stream.
// @author       danmaclann
// @match        https://chaturbate.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js
// @run-at       document-idle
// @downloadURL  https://github.com/danmaclann/chaturbate_preview/raw/refs/heads/main/chaturbate_preview.user.js
// @updateURL    https://github.com/danmaclann/chaturbate_preview/raw/refs/heads/main/chaturbate_preview.user.js
// @icon         https://web.static.mmcdn.com/favicons/favicon.ico
// ==/UserScript==

(function() {
    'use strict';

    // === CONFIGURATION ===
    const DEBUG = false;
    const VIDEO_SCALE = 1.0;
    const HOVER_DELAY = 400;
    // =====================

    let currentPlayer = null;
    let currentContainer = null;
    let originalImage = null;
    let hoverTimeout = null;
    let followedPanelObserver = null;
    let isFollowedPanelOpen = false; // State tracker

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
    }

    function createVideoPlayer(container, m3u8Url) {
        // Updated to support both old and new image selectors
        const img = container.querySelector('img.room_thumbnail, img[data-testid="room-card-image"]');
        if (!img) return;

        const width = img.clientWidth;
        const height = img.clientHeight;

        originalImage = img.cloneNode(true);
        currentContainer = container;

        container.dataset.originalOverflow = container.style.overflow || '';

        const video = document.createElement('video');
        video.style.width = `${width}px`;
        video.style.height = `${height}px`;
        video.style.objectFit = 'cover';

        if (VIDEO_SCALE !== 1.0) {
            video.style.transform = `scale(${VIDEO_SCALE})`;
            video.style.transformOrigin = 'center center';
            container.style.overflow = 'hidden';
        }

        video.className = img.className;
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
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }

        if (currentContainer && originalImage) {
            const video = currentContainer.querySelector('video');
            if (video) video.replaceWith(originalImage);
            currentContainer.style.overflow = currentContainer.dataset.originalOverflow || '';
            currentContainer = null;
            originalImage = null;
        }
    }

    function addListeners() {
        // Updated to target both old and new list classes/data-testids
        document.querySelectorAll('li.roomCard, li[data-testid="room-card"]').forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            // Updated thumbnail container selector
            const thumbContainer = card.querySelector('.room_thumbnail_container, [data-testid="room-card-image-anchor"]');
            if (!thumbContainer) return;

            const roomSlug = thumbContainer.getAttribute('data-room');
            if (!roomSlug) return;

            card.addEventListener('mouseenter', () => {
                hoverTimeout = setTimeout(async () => {
                    if (currentContainer) cleanupPlayer();
                    try {
                        const url = await getStreamUrl(roomSlug);
                        if (card.matches(':hover')) createVideoPlayer(thumbContainer, url);
                    } catch (e) {}
                }, HOVER_DELAY);
            });

            card.addEventListener('mouseleave', () => cleanupPlayer());
        });
    }

    function addFollowedListeners(panel) {
        // Updated followed panel card selectors
        panel.querySelectorAll('div.roomElement, li[data-testid="room-card"]').forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            // Updated anchor selector
            const anchor = card.querySelector('a.roomElementAnchor[data-room], a[data-testid="room-card-image-anchor"][data-room]');
            if (!anchor) return;

            const roomSlug = anchor.getAttribute('data-room');
            if (!roomSlug) return;

            card.addEventListener('mouseenter', () => {
                hoverTimeout = setTimeout(async () => {
                    if (currentContainer) cleanupPlayer();
                    try {
                        const url = await getStreamUrl(roomSlug);
                        if (card.matches(':hover')) createVideoPlayer(anchor, url);
                    } catch (e) {}
                }, HOVER_DELAY);
            });

            card.addEventListener('mouseleave', () => cleanupPlayer());
        });
    }

    function onFollowedPanelOpen(panel) {
        log('Followed panel opened');
        addFollowedListeners(panel);

        if (followedPanelObserver) followedPanelObserver.disconnect();
        followedPanelObserver = new MutationObserver(() => addFollowedListeners(panel));
        followedPanelObserver.observe(panel, { childList: true, subtree: true });
    }

    function onFollowedPanelClose() {
        log('Followed panel closed');
        cleanupPlayer();
        if (followedPanelObserver) {
            followedPanelObserver.disconnect();
            followedPanelObserver = null;
        }
    }

    // --- NEW: Bulletproof State Checker ---
    function checkPanelState() {
        const panel = document.querySelector('[data-testid="followed-rooms-list"]');

        // Checks if the panel actually exists AND has physical dimensions (handles 'display: none')
        const isVisible = panel && panel.getBoundingClientRect().height > 0;

        if (isVisible && !isFollowedPanelOpen) {
            isFollowedPanelOpen = true;
            onFollowedPanelOpen(panel);
        } else if (!isVisible && isFollowedPanelOpen) {
            isFollowedPanelOpen = false;
            onFollowedPanelClose();
        }
    }

    // Main observer just handles generic page loads and triggers the state check
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                shouldUpdate = true;
                break;
            }
        }
        if (shouldUpdate) addListeners();

        // Evaluate final DOM state after any mutation finishes
        checkPanelState();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Catch clicks (like clicking off the menu) that hide it without a DOM mutation
    document.addEventListener('click', () => {
        // 100ms delay allows React's click handlers to process and hide the menu first
        setTimeout(checkPanelState, 100);
    });

    addListeners();
    checkPanelState(); // Run once on startup just in case

    log('Loaded (v1.003)');
})();
