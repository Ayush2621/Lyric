/* ==========================================================================
   1. CONFIGURATION & STATE
   ========================================================================== */
const YOUTUBE_API_KEY = "AIzaSyApMe9q_hGlgXF2V_d9tSvd0VWA4LDH6qU"; 
const PLAYLIST_STORAGE_KEY = 'lyric_playlists_v6';

let player; 
let currentVideoId = null;
let currentSongTitle = "Not Playing";
let currentSongArtist = "Select a song";
let currentSongCover = "";
let searchTimeout;
let progressInterval;
let playlists = loadPlaylists(); 
let currentSearchItems = [];
let shuffleEnabled = false;
let repeatMode = 'off'; // 'off', 'one', 'all'

// Background Play State
let shouldBePlaying = false; 
let keepAliveContext = null;
let keepAliveOscillator = null;
let backgroundWorker = null;

/* ==========================================================================
   2. DOM ELEMENTS
   ========================================================================== */
const searchInput = document.getElementById('searchInput');
const songListEl = document.getElementById('songList');
const categoriesGrid = document.getElementById('categoriesGrid');
const categoryNavHeader = document.getElementById('categoryNavHeader');
const btnBackToCategories = document.getElementById('btnBackToCategories');
const currentCategoryTitle = document.getElementById('currentCategoryTitle');

// Mini Player
const miniPlayer = document.getElementById('miniPlayer');
const miniTitle = document.getElementById('miniTitle');
const miniArtist = document.getElementById('miniArtist');
const miniCover = document.getElementById('miniCover');
const miniPlayToggle = document.getElementById('miniPlayToggle');
const miniPlayIcon = document.getElementById('miniPlayIcon'); 
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');
const btnNext = document.getElementById('btnNext');
const btnPrev = document.getElementById('btnPrev');
const btnShuffle = document.getElementById('btnShuffle');
const btnRepeat = document.getElementById('btnRepeat');
const btnExpand = document.getElementById('btnExpand');

// Fullscreen Player
const fsModal = document.getElementById('fullScreenPlayer');
const fsClose = document.getElementById('fsClose');
const fsTitle = document.getElementById('fsTitle');
const fsArtist = document.getElementById('fsArtist');
const fsPlay = document.getElementById('fsPlay');
const fsPrev = document.getElementById('fsPrev');
const fsNext = document.getElementById('fsNext');
const fsShuffle = document.getElementById('fsShuffle');
const fsRepeat = document.getElementById('fsRepeat');
const fsProgress = document.getElementById('fsProgress');
const fsProgressWrap = document.getElementById('fsProgressWrap');
const fsCurrent = document.getElementById('fsCurrent');
const fsDuration = document.getElementById('fsDuration');
const fsDescription = document.getElementById('fsDescription');
const lyricsContent = document.getElementById('lyricsContent');
const fsTabs = document.querySelectorAll('.tab-btn');
const fsPanels = document.querySelectorAll('.fs-panel');

// Views & Modals
const navHome = document.getElementById('navHome');
const navLibrary = document.getElementById('navLibrary');
const navProfile = document.getElementById('navProfile');
const homeView = document.getElementById('homeView');
const libraryView = document.getElementById('libraryView');
const libraryList = document.getElementById('libraryList');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeModalBtn = document.getElementById('closeModal');
const profileModal = document.getElementById('profileModal');
const addPlaylistModalBackdrop = document.getElementById('addPlaylistModalBackdrop');
const addPlaylistModal = document.getElementById('addPlaylistModal');
const addPlaylistList = document.getElementById('addPlaylistList');
const createPlaylistModalBackdrop = document.getElementById('createPlaylistModalBackdrop');
const createPlaylistModal = document.getElementById('createPlaylistModal');
const newPlaylistInput = document.getElementById('newPlaylistInput');
const createPlaylistConfirmBtn = document.getElementById('createPlaylistConfirmBtn');
const closeModalBtns = document.querySelectorAll('.modal-close-btn');

/* ==========================================================================
   3. BACKGROUND AUDIO HACK (The Fix)
   ========================================================================== */
function initKeepAlive() {
    if (keepAliveContext) return; 
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        keepAliveContext = new AudioContext();

        // Play silent sound to trick Android
        keepAliveOscillator = keepAliveContext.createOscillator();
        const gainNode = keepAliveContext.createGain();
        gainNode.gain.value = 0.0001; // Almost silent
        
        keepAliveOscillator.connect(gainNode);
        gainNode.connect(keepAliveContext.destination);
        keepAliveOscillator.start();
        
        if (keepAliveContext.state === 'suspended') {
            keepAliveContext.resume();
        }

        // Web Worker Heartbeat
        if (!backgroundWorker) {
            const blob = new Blob([`setInterval(() => { postMessage('tick'); }, 1000);`], { type: 'application/javascript' });
            backgroundWorker = new Worker(URL.createObjectURL(blob));
            backgroundWorker.onmessage = function(e) {
                if (keepAliveContext && keepAliveContext.state === 'suspended') keepAliveContext.resume();
                
                // Auto-Resume Logic: Force play if system paused it but we want it playing
                if(player && shouldBePlaying && player.getPlayerState() === 2) {
                    player.playVideo();
                }
            };
        }
    } catch (e) { console.error("Audio Hack Error:", e); }
}

/* ==========================================================================
   4. YOUTUBE API SETUP
   ========================================================================== */
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'playsinline': 1, 'controls': 0, 'modestbranding': 1,
            'rel': 0, 'showinfo': 0, 'iv_load_policy': 3,
            'origin': window.location.origin
        },
        events: {
            'onStateChange': onPlayerStateChange,
            'onError': (e) => console.log("Player Error", e)
        }
    });
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        updatePlayButtons(true);
        startProgressLoop();
        updateMediaSession(currentSongTitle, currentSongArtist, currentSongCover);
        initKeepAlive();
    } else if (event.data == YT.PlayerState.PAUSED) {
        if (shouldBePlaying) player.playVideo(); // Auto-resume logic
        else { updatePlayButtons(false); stopProgressLoop(); }
    } else if (event.data == YT.PlayerState.ENDED) {
        stopProgressLoop();
        if (repeatMode === 'one') {
            player.seekTo(0);
            player.playVideo();
        } else {
            playNextSong(); 
        }
    }
}

function updatePlayButtons(isPlaying) {
    const icon = isPlaying ? '⏸' : '▶';
    if(miniPlayIcon) miniPlayIcon.innerHTML = isPlaying 
        ? '<rect x="6" y="5" width="4" height="14" fill="white"/><rect x="14" y="5" width="4" height="14" fill="white"/>' 
        : '<path d="M5 3v18l15-9L5 3z" fill="white"/>';
    if(fsPlay) fsPlay.textContent = icon;
}

/* ==========================================================================
   5. PROGRESS BAR & MARQUEE
   ========================================================================== */
function startProgressLoop() {
    stopProgressLoop();
    progressInterval = setInterval(() => {
        if (!player || !player.getCurrentTime) return;
        const curr = player.getCurrentTime();
        const dur = player.getDuration();
        if (dur > 0) {
            const pct = (curr / dur) * 100;
            progressBar.style.width = pct + '%';
            fsProgress.style.width = pct + '%';
            currentTimeDisplay.textContent = formatTime(curr);
            durationDisplay.textContent = formatTime(dur);
            fsCurrent.textContent = formatTime(curr);
            fsDuration.textContent = formatTime(dur);
        }
    }, 500);
}
function stopProgressLoop() { clearInterval(progressInterval); }
function formatTime(sec) {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ✅ MARQUEE (Scrolling Text)
function setupMarqueeIfNeeded(){
    const marquee = document.getElementById('miniTitle');
    const wrap = document.querySelector('.marquee-wrap');
    if (!marquee || !wrap) return;
    
    // Inject CSS if missing
    if (!document.getElementById('marquee-style')) {
        const s = document.createElement('style');
        s.id = 'marquee-style';
        s.innerHTML = `@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } } .marquee { display: inline-block; white-space: nowrap; }`;
        document.head.appendChild(s);
    }
    
    marquee.style.animation = 'none';
    marquee.textContent = currentSongTitle || 'Not Playing';
    
    requestAnimationFrame(() => {
        if (marquee.scrollWidth > wrap.clientWidth) {
            marquee.textContent = currentSongTitle + "   •   " + currentSongTitle;
            marquee.style.animation = `marquee 10s linear infinite`;
        }
    });
}

/* ==========================================================================
   6. LOCK SCREEN CONTROLS
   ========================================================================== */
function updateMediaSession(title, artist, cover) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title, artist: artist, artwork: [ { src: cover, sizes: '512x512', type: 'image/jpeg' } ]
        });
        navigator.mediaSession.setActionHandler('play', () => { shouldBePlaying = true; player.playVideo(); });
        navigator.mediaSession.setActionHandler('pause', () => { shouldBePlaying = false; player.pauseVideo(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevSong());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
        navigator.mediaSession.setActionHandler('seekto', (details) => player.seekTo(details.seekTime));
    }
}

/* ==========================================================================
   7. LYRICS LOGIC
   ========================================================================== */
fsTabs.forEach(btn => {
    btn.addEventListener('click', () => {
        fsTabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        fsPanels.forEach(p => p.style.display = 'none');
        document.querySelector(`.fs-panel-${btn.dataset.tab}`).style.display = 'block';
    });
});

async function updateLyrics(title, artist) {
    if(!lyricsContent) return;
    lyricsContent.innerHTML = '<div style="margin-top:20px;">Searching lyrics...</div>';
    const cleanTitle = title.replace(/\(.*\)|\[.*\]/g, "").replace(/ft\.|feat\./gi, "").trim();
    const cleanArtist = artist.replace(/ft\.|feat\./gi, "").trim();
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + " " + cleanArtist)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.length > 0) lyricsContent.innerHTML = (data[0].plainLyrics || "Lyrics not found.").replace(/\n/g, '<br>');
        else lyricsContent.innerHTML = "Lyrics not found.";
    } catch (e) { lyricsContent.innerHTML = "Could not load lyrics."; }
}

/* ==========================================================================
   8. PLAYER CONTROL
   ========================================================================== */
function playVideo(id, title, artist, cover) {
    currentVideoId = id;
    currentSongTitle = title;
    currentSongArtist = artist;
    currentSongCover = cover;
    shouldBePlaying = true; 

    if (player && player.loadVideoById) {
        player.loadVideoById(id);
    }

    miniTitle.textContent = title;
    miniArtist.textContent = artist;
    miniCover.style.backgroundImage = `url('${cover}')`;
    
    fsTitle.textContent = title;
    fsArtist.textContent = artist;
    
    setupMarqueeIfNeeded();
    updateLyrics(title, artist);
    updateMediaSession(title, artist, cover);

    miniPlayer.style.display = 'flex';
    openFullScreen(); 
    initKeepAlive();
}

function playNextSong() {
    let pool = currentSearchItems;
    if(pool.length > 0) {
        if(shuffleEnabled) {
            const randIdx = Math.floor(Math.random() * pool.length);
            const next = pool[randIdx];
            playVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails.high.url);
        } else {
            const currentIndex = pool.findIndex(item => item.id.videoId === currentVideoId);
            if(currentIndex >= 0 && currentIndex < pool.length - 1) {
                const next = pool[currentIndex + 1];
                playVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails.high.url);
            } else if (repeatMode === 'all') {
                const next = pool[0];
                playVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails.high.url);
            }
        }
    }
}

function playPrevSong() {
    let pool = currentSearchItems;
    const currentIndex = pool.findIndex(item => item.id.videoId === currentVideoId);
    if(currentIndex > 0) {
        const prev = pool[currentIndex - 1];
        playVideo(prev.id.videoId, prev.snippet.title, prev.snippet.channelTitle, prev.snippet.thumbnails.high.url);
    }
}

window.togglePlay = () => {
    if(!player) return;
    if(player.getPlayerState() === YT.PlayerState.PLAYING) {
        shouldBePlaying = false; 
        player.pauseVideo();
    } else {
        shouldBePlaying = true; 
        player.playVideo();
        if (keepAliveContext && keepAliveContext.state === 'suspended') keepAliveContext.resume();
    }
}

// UI Listeners
if(miniPlayToggle) miniPlayToggle.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
if(fsPlay) fsPlay.addEventListener('click', togglePlay);
if(fsNext) fsNext.addEventListener('click', playNextSong);
if(btnNext) btnNext.addEventListener('click', (e) => { e.stopPropagation(); playNextSong(); });
if(fsPrev) fsPrev.addEventListener('click', playPrevSong);
if(btnPrev) btnPrev.addEventListener('click', (e) => { e.stopPropagation(); playPrevSong(); });

// ✅ SHUFFLE & REPEAT
if(btnShuffle) btnShuffle.addEventListener('click', () => {
    shuffleEnabled = !shuffleEnabled;
    btnShuffle.classList.toggle('active', shuffleEnabled);
    if(fsShuffle) fsShuffle.classList.toggle('active', shuffleEnabled);
});
if(fsShuffle) fsShuffle.addEventListener('click', () => {
    shuffleEnabled = !shuffleEnabled;
    fsShuffle.classList.toggle('active', shuffleEnabled);
    if(btnShuffle) btnShuffle.classList.toggle('active', shuffleEnabled);
});

function toggleRepeat() {
    if(repeatMode === 'off') repeatMode = 'all';
    else if(repeatMode === 'all') repeatMode = 'one';
    else repeatMode = 'off';
    
    const icon = repeatMode === 'one' ? '🔂' : '🔁';
    const color = repeatMode === 'off' ? 'var(--text)' : 'var(--accent)';
    
    if(btnRepeat) { btnRepeat.innerHTML = icon; btnRepeat.style.color = color; }
    if(fsRepeat) { fsRepeat.innerHTML = icon; fsRepeat.style.color = color; }
}
if(btnRepeat) btnRepeat.addEventListener('click', toggleRepeat);
if(fsRepeat) fsRepeat.addEventListener('click', toggleRepeat);

// Fullscreen & Backdrop
function openFullScreen() { fsModal.style.display = 'flex'; }
function closeFullScreen() { fsModal.style.display = 'none'; }

miniPlayer.addEventListener('click', (e) => {
    if(!e.target.closest('button')) openFullScreen();
});
if(fsClose) fsClose.addEventListener('click', closeFullScreen);
if(btnExpand) btnExpand.addEventListener('click', (e) => { e.stopPropagation(); openFullScreen(); });

// ✅ BACKDROP CLOSING FIX
fsModal.addEventListener('click', (e) => { 
    if(e.target === fsModal || e.target.id === 'fsBackdrop') closeFullScreen(); 
});

function seek(e, el) {
    if(!player) return;
    const rect = el.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    player.seekTo(player.getDuration() * pct);
}
if(progressContainer) progressContainer.addEventListener('click', (e) => seek(e, progressContainer));
if(fsProgressWrap) fsProgressWrap.addEventListener('click', (e) => seek(e, fsProgressWrap));

/* ==========================================================================
   9. PLAYLISTS
   ========================================================================== */
function loadPlaylists() {
    try { return JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY)) || { "My Favorites": [] }; }
    catch(e) { return { "My Favorites": [] }; }
}
function savePlaylists() { localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists)); }

let songToAdd = null;

window.showAddPlaylistModal = (id, title, artist, cover) => {
    songToAdd = { id, title, artist, cover };
    if(!addPlaylistList) return;
    addPlaylistList.innerHTML = '';
    const names = Object.keys(playlists).sort();
    names.forEach(name => {
        const item = document.createElement('div');
        item.className = 'modal-playlist-item';
        item.style.padding = "10px";
        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        item.innerHTML = `<span>${name} (${playlists[name].length})</span> <button class="btn-circle small" style="width:30px;height:30px;">+</button>`;
        item.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); addToPlaylist(name, songToAdd); });
        addPlaylistList.appendChild(item);
    });
    const createNew = document.createElement('div');
    createNew.style.padding = "15px 10px";
    createNew.style.textAlign = "center";
    createNew.innerHTML = `<button class="btn-primary" style="width:100%">Create New Playlist</button>`;
    createNew.querySelector('button').addEventListener('click', () => { openModal(createPlaylistModalBackdrop); });
    addPlaylistList.appendChild(createNew);
    openModal(addPlaylistModalBackdrop);
}

function addToPlaylist(playlistName, song) {
    if(!playlists[playlistName]) playlists[playlistName] = [];
    const exists = playlists[playlistName].find(s => s.id === song.id);
    if(!exists) {
        playlists[playlistName].push(song);
        savePlaylists();
        alert(`Added to ${playlistName}`);
        closeModal(addPlaylistModalBackdrop);
    } else { alert("Already in playlist"); }
}

function createNewPlaylist(name) {
    if(playlists[name]) { alert("Playlist exists"); return; }
    playlists[name] = [];
    if(songToAdd) playlists[name].push(songToAdd);
    savePlaylists();
    closeModal(createPlaylistModalBackdrop);
    closeModal(addPlaylistModalBackdrop);
    alert(`Created ${name}`);
    if(libraryView.style.display === 'block') renderLibrary();
}

if(createPlaylistConfirmBtn) {
    createPlaylistConfirmBtn.addEventListener('click', () => {
        const name = newPlaylistInput.value.trim();
        if(name) createNewPlaylist(name);
    });
}

function renderLibrary() {
    libraryList.innerHTML = '';
    const names = Object.keys(playlists);
    if(names.length === 0) { libraryList.innerHTML = '<div class="empty">No playlists.</div>'; return; }
    names.forEach(name => {
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.innerHTML = `<div class="thumb">${name.substring(0,2).toUpperCase()}</div><div class="playlist-name">${name}</div><div style="font-size:12px; color:#888">${playlists[name].length} songs</div>`;
        div.addEventListener('click', () => openPlaylistDetail(name));
        libraryList.appendChild(div);
    });
}

function openPlaylistDetail(name) {
    libraryList.innerHTML = '';
    const header = document.createElement('div');
    header.style.marginBottom = '20px';
    header.innerHTML = `<button class="btn-circle small" id="backToLib">←</button> <span style="font-size:20px; font-weight:bold; margin-left:10px;">${name}</span>`;
    libraryList.appendChild(header);
    document.getElementById('backToLib').addEventListener('click', renderLibrary);
    const songs = playlists[name];
    if(songs.length === 0) { libraryList.innerHTML += '<div class="empty">Empty playlist.</div>'; return; }
    songs.forEach(item => {
        const div = document.createElement('div');
        div.className = 'song';
        div.innerHTML = `<div class="cover" style="background-image: url('${item.cover}')"></div><div class="meta"><div class="name">${item.title}</div><div class="artist">${item.artist}</div></div><button class="btn-circle small" onclick="event.stopPropagation(); removeFromPlaylist('${name}', '${item.id}')">🗑</button>`;
        div.onclick = () => playVideo(item.id, item.title, item.artist, item.cover);
        libraryList.appendChild(div);
    });
}

window.removeFromPlaylist = (name, id) => {
    playlists[name] = playlists[name].filter(s => s.id !== id);
    savePlaylists();
    openPlaylistDetail(name);
}

/* ==========================================================================
   10. NAV & SEARCH
   ========================================================================== */
function setActiveView(view) {
    homeView.style.display = 'none'; libraryView.style.display = 'none'; navHome.classList.remove('active'); navLibrary.classList.remove('active'); navProfile.classList.remove('active');
    if(view === 'home') { homeView.style.display = 'block'; navHome.classList.add('active'); if(songListEl.innerHTML === '') { categoriesGrid.style.display = 'grid'; songListEl.style.display = 'none'; } }
    else if (view === 'library') { libraryView.style.display = 'block'; navLibrary.classList.add('active'); renderLibrary(); }
}
navHome.addEventListener('click', () => setActiveView('home'));
navLibrary.addEventListener('click', () => setActiveView('library'));
navProfile.addEventListener('click', () => { openModal(profileModal.parentElement); navProfile.classList.add('active'); });

function openModal(el) { el.style.display = 'flex'; }
function closeModal(el) { el.style.display = 'none'; }
closeModalBtns.forEach(btn => { btn.addEventListener('click', (e) => { closeModal(e.target.closest('.modal-backdrop')); }); });
if(closeModalBtn) { closeModalBtn.addEventListener('click', () => { closeModal(modalBackdrop); if(homeView.style.display === 'block') navHome.classList.add('active'); else navLibrary.classList.add('active'); }); }
document.querySelectorAll('.modal-backdrop').forEach(backdrop => { backdrop.addEventListener('click', (e) => { if(e.target === backdrop) { closeModal(backdrop); } }); });

let timeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const q = e.target.value.trim();
    if(q.length > 0) { categoriesGrid.style.display = 'none'; songListEl.style.display = 'flex'; timeout = setTimeout(() => searchYouTube(q), 1000); }
    else { categoriesGrid.style.display = 'grid'; songListEl.style.display = 'none'; }
});

window.triggerSearch = (artist) => { 
    searchInput.value = artist; 
    categoriesGrid.style.display = 'none'; 
    songListEl.style.display = 'flex'; 
    searchYouTube(artist); 
}

const musicCategories = [
    { id: 'trending', name: 'Trending Now', color: '#E91E63', query: 'Trending Music' },
    { id: 'hindi', name: 'Top Hindi', color: '#9C27B0', query: 'Latest Hindi Songs' },
    { id: 'telugu', name: 'Top Telugu', color: '#3F51B5', query: 'Latest Telugu Songs' },
    { id: 'tamil', name: 'Top Tamil', color: '#009688', query: 'Latest Tamil Songs' },
    { id: 'english', name: 'Top English', color: '#FF9800', query: 'Top Global Hits' },
    { id: 'lofi', name: 'Lofi Beats', color: '#607D8B', query: 'Lofi Hip Hop' }
];

function renderCategories() {
    if(!categoriesGrid) return;
    categoriesGrid.innerHTML = '';
    musicCategories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'category-card';
        div.style.background = cat.color;
        div.innerHTML = `<div class="category-card-content"><div class="category-name">${cat.name}</div></div>`;
        div.onclick = () => openCategory(cat);
        categoriesGrid.appendChild(div);
    });
}

function openCategory(cat) {
    categoriesGrid.style.display = 'none';
    songListEl.style.display = 'flex';
    categoryNavHeader.style.display = 'flex';
    currentCategoryTitle.textContent = cat.name;
    searchYouTube(cat.query);
}

if(btnBackToCategories){
    btnBackToCategories.addEventListener('click', () => {
        categoriesGrid.style.display = 'grid';
        songListEl.style.display = 'none';
        categoryNavHeader.style.display = 'none';
    });
}

async function searchYouTube(query) {
    songListEl.innerHTML = '<div class="empty">Loading...</div>';
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=25&key=${YOUTUBE_API_KEY}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.items) {
            currentSearchItems = data.items;
            renderSongs(data.items);
        } else {
            songListEl.innerHTML = '<div class="empty">No results found.</div>';
        }
    } catch (e) {
        console.error(e);
        songListEl.innerHTML = '<div class="empty">Check your internet connection.</div>';
    }
}

function renderSongs(items) {
    songListEl.innerHTML = '';
    items.forEach(item => {
        const id = item.id.videoId;
        const parser = new DOMParser();
        const titleRaw = item.snippet.title;
        const title = parser.parseFromString(titleRaw, 'text/html').body.textContent;
        const channel = item.snippet.channelTitle;
        const thumb = item.snippet.thumbnails.default.url; 
        const thumbHigh = item.snippet.thumbnails.high.url;

        const div = document.createElement('div');
        div.className = 'song';
        div.innerHTML = `
            <div class="cover" style="background-image: url('${thumb}')"></div>
            <div class="meta">
                <div class="name">${title}</div>
                <div class="artist">${channel}</div>
            </div>
            <div class="controls">
                <button class="btn-circle small" style="font-size:16px" onclick="event.stopPropagation(); showAddPlaylistModal('${id}', '${title.replace(/'/g, "\\'")}', '${channel.replace(/'/g, "\\'")}', '${thumbHigh}')">＋</button>
            </div>
        `;
        div.onclick = () => playVideo(id, title, channel, thumbHigh);
        songListEl.appendChild(div);
    });
}

renderCategories();