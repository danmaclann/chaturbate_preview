// ==UserScript==
// @name         Chaturbate Hover Preview
// @namespace    https://github.com/danmaclann
// @version      1.004
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
        // Updated to support old selector, new testid selector, and the new FollowedDropdown image
        const img = container.querySelector('img.room_thumbnail, img[data-testid="room-card-image"], img.FollowedDropdown__room-image');
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

    function attachHoverEvents(card, containerNode, roomSlug) {
        if (!roomSlug) return;
        
        card.addEventListener('mouseenter', () => {
            hoverTimeout = setTimeout(async () => {
                if (currentContainer) cleanupPlayer();
                try {
                    const url = await getStreamUrl(roomSlug);
                    if (card.matches(':hover')) createVideoPlayer(containerNode, url);
                } catch (e) {}
            }, HOVER_DELAY);
        });

        card.addEventListener('mouseleave', () => cleanupPlayer());
    }

    function addListeners() {
        // Main page and generic room cards
        document.querySelectorAll('li.roomCard, li[data-testid="room-card"]').forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            const thumbContainer = card.querySelector('.room_thumbnail_container, [data-testid="room-card-image-anchor"]');
            if (!thumbContainer) return;

            const roomSlug = thumbContainer.getAttribute('data-room');
            attachHoverEvents(card, thumbContainer, roomSlug);
        });

        // NEW: Followed Dropdown list parsing
        document.querySelectorAll('div.FollowedDropdown__room').forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            const anchor = card.querySelector('a.FollowedDropdown__room-link');
            if (!anchor) return;

            // Extract username/room_slug directly from the href attribute since there's no data-room
            const href = anchor.getAttribute('href');
            if (!href) return;
            const roomSlug = href.replace(/\//g, ''); // Removes the slashes to get the plain string

            attachHoverEvents(card, anchor, roomSlug);
        });
    }

    function addFollowedListeners(panel) {
        panel.querySelectorAll('div.roomElement, li[data-testid="room-card"]').forEach(card => {
            if (card.dataset.previewBound) return;
            card.dataset.previewBound = 'true';

            const anchor = card.querySelector('a.roomElementAnchor[data-room], a[data-testid="room-card-image-anchor"][data-room]');
            if (!anchor) return;

            const roomSlug = anchor.getAttribute('data-room');
            attachHoverEvents(card, anchor, roomSlug);
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

    function checkPanelState() {
        const panel = document.querySelector('[data-testid="followed-rooms-list"], .FollowedDropdown__rooms');

        const isVisible = panel && panel.getBoundingClientRect().height > 0;

        if (isVisible && !isFollowedPanelOpen) {
            isFollowedPanelOpen = true;
            onFollowedPanelOpen(panel);
        } else if (!isVisible && isFollowedPanelOpen) {
            isFollowedPanelOpen = false;
            onFollowedPanelClose();
        }
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
        checkPanelState();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', () => {
        setTimeout(checkPanelState, 100);
    });

    addListeners();
    checkPanelState();

    log('Loaded (v1.004)');
})();
