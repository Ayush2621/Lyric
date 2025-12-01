/* ==========================================================================
   CONFIG & STATE
   ========================================================================== */
const YOUTUBE_API_KEY = "AIzaSyApMe9q_hGlgXF2V_d9tSvd0VWA4LDH6qU"; 
const PLAYLIST_STORAGE_KEY = 'lyric_playlists_v4';

let player; // YouTube Player Instance
let currentVideoId = null;
let currentSongTitle = "";
let currentSongArtist = "";
let currentSongCover = "";
let searchTimeout;
let progressInterval;
let playlists = loadPlaylists();
let currentSearchItems = [];
let shuffleEnabled = false;
let repeatMode = 'off';

/* ==========================================================================
   DOM ELEMENTS
   ========================================================================== */
const searchInput = document.getElementById('searchInput');
const songListEl = document.getElementById('songList');

// Categories
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

// Playlist Modals
const addPlaylistModalBackdrop = document.getElementById('addPlaylistModalBackdrop');
const addPlaylistModal = document.getElementById('addPlaylistModal');
const addPlaylistList = document.getElementById('addPlaylistList');
const createPlaylistModalBackdrop = document.getElementById('createPlaylistModalBackdrop');
const createPlaylistModal = document.getElementById('createPlaylistModal');
const newPlaylistInput = document.getElementById('newPlaylistInput');
const createPlaylistConfirmBtn = document.getElementById('createPlaylistConfirmBtn');
const closeModalBtns = document.querySelectorAll('.modal-close-btn');

/* ==========================================================================
   YOUTUBE API SETUP
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
            'playsinline': 1,
            'controls': 0, 
            'modestbranding': 1,
            'rel': 0,
            'showinfo': 0,
            'iv_load_policy': 3,
            'origin': window.location.origin
        },
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        updatePlayButtons(true);
        startProgressLoop();
        updateMediaSession(currentSongTitle, currentSongArtist, currentSongCover);
    } else if (event.data == YT.PlayerState.PAUSED) {
        updatePlayButtons(false);
        stopProgressLoop();
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
    if(miniPlayIcon) miniPlayIcon.innerHTML = isPlaying ? '<rect x="6" y="5" width="4" height="14" fill="white"/><rect x="14" y="5" width="4" height="14" fill="white"/>' : '<path d="M5 3v18l15-9L5 3z" fill="white"/>';
    if(fsPlay) fsPlay.textContent = icon;
}

/* ==========================================================================
   PROGRESS LOOP
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
            
            const cFmt = formatTime(curr);
            const dFmt = formatTime(dur);
            
            currentTimeDisplay.textContent = cFmt;
            durationDisplay.textContent = dFmt;
            fsCurrent.textContent = cFmt;
            fsDuration.textContent = dFmt;
        }
    }, 500);
}

function stopProgressLoop() {
    clearInterval(progressInterval);
}

function formatTime(sec) {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/* ==========================================================================
   MEDIA SESSION (LOCK SCREEN)
   ========================================================================== */
function updateMediaSession(title, artist, cover) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            artwork: [
                { src: cover, sizes: '512x512', type: 'image/jpeg' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', () => player.playVideo());
        navigator.mediaSession.setActionHandler('pause', () => player.pauseVideo());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevSong());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
        navigator.mediaSession.setActionHandler('seekto', (details) => player.seekTo(details.seekTime));
    }
}

/* ==========================================================================
   SEARCH & DATA
   ========================================================================== */
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

/* ==========================================================================
   PLAYER CONTROL
   ========================================================================== */
function playVideo(id, title, artist, cover) {
    currentVideoId = id;
    currentSongTitle = title;
    currentSongArtist = artist;
    currentSongCover = cover;

    if (player && player.loadVideoById) {
        player.loadVideoById(id);
    }

    miniTitle.textContent = title;
    miniArtist.textContent = artist;
    miniCover.style.backgroundImage = `url('${cover}')`;
    
    fsTitle.textContent = title;
    fsArtist.textContent = artist;
    if(fsDescription) fsDescription.textContent = "Playing via YouTube";
    
    if(lyricsContent) lyricsContent.textContent = "Lyrics feature coming soon...";

    miniPlayer.style.display = 'flex';
    openFullScreen(); 
    
    updateMediaSession(title, artist, cover);
}

function playNextSong() {
    if(currentSearchItems.length > 0) {
        const currentIndex = currentSearchItems.findIndex(item => item.id.videoId === currentVideoId);
        if(currentIndex >= 0 && currentIndex < currentSearchItems.length - 1) {
            const next = currentSearchItems[currentIndex + 1];
            playVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails.high.url);
        }
    }
}

function playPrevSong() {
    if(currentSearchItems.length > 0) {
        const currentIndex = currentSearchItems.findIndex(item => item.id.videoId === currentVideoId);
        if(currentIndex > 0) {
            const prev = currentSearchItems[currentIndex - 1];
            playVideo(prev.id.videoId, prev.snippet.title, prev.snippet.channelTitle, prev.snippet.thumbnails.high.url);
        }
    }
}

window.togglePlay = () => {
    if(!player) return;
    if(player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
}

if(miniPlayToggle) miniPlayToggle.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
if(fsPlay) fsPlay.addEventListener('click', togglePlay);
if(fsNext) fsNext.addEventListener('click', playNextSong);
if(fsPrev) fsPrev.addEventListener('click', playPrevSong);

function openFullScreen() {
    fsModal.style.display = 'flex';
}
function closeFullScreen() {
    fsModal.style.display = 'none';
}

miniPlayer.addEventListener('click', (e) => {
    if(e.target.closest('button')) return;
    openFullScreen();
});
if(fsClose) fsClose.addEventListener('click', closeFullScreen);
if(btnExpand) btnExpand.addEventListener('click', (e) => { e.stopPropagation(); openFullScreen(); });

function seek(e, el) {
    if(!player) return;
    const rect = el.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    player.seekTo(player.getDuration() * pct);
}
if(progressContainer) progressContainer.addEventListener('click', (e) => seek(e, progressContainer));
if(fsProgressWrap) fsProgressWrap.addEventListener('click', (e) => seek(e, fsProgressWrap));

/* ==========================================================================
   PLAYLISTS
   ========================================================================== */
function loadPlaylists() {
    const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { "My Favorites": [] };
}
function savePlaylists() {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
}

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
        
        const count = playlists[name].length;
        item.innerHTML = `<span>${name} (${count} songs)</span> <button class="btn-circle small" style="width:30px;height:30px;">+</button>`;
        
        item.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            addToPlaylist(name, songToAdd);
        });
        
        addPlaylistList.appendChild(item);
    });
    
    const createNew = document.createElement('div');
    createNew.style.padding = "15px 10px";
    createNew.style.textAlign = "center";
    createNew.innerHTML = `<button class="btn-primary" style="width:100%">Create New Playlist</button>`;
    createNew.querySelector('button').addEventListener('click', () => {
        openModal(createPlaylistModalBackdrop);
    });
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
    } else {
        alert("Already in playlist");
    }
}

function createNewPlaylist(name) {
    if(playlists[name]) {
        alert("Playlist exists");
        return;
    }
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
    
    if(names.length === 0) {
        libraryList.innerHTML = '<div class="empty">No playlists.</div>';
        return;
    }
    
    names.forEach(name => {
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.innerHTML = `
            <div class="thumb">${name.substring(0,2).toUpperCase()}</div>
            <div class="playlist-name">${name}</div>
            <div style="font-size:12px; color:#888">${playlists[name].length} songs</div>
        `;
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
    if(songs.length === 0) {
        libraryList.innerHTML += '<div class="empty">Empty playlist.</div>';
        return;
    }
    
    songs.forEach(item => {
        const div = document.createElement('div');
        div.className = 'song';
        div.innerHTML = `
            <div class="cover" style="background-image: url('${item.cover}')"></div>
            <div class="meta">
                <div class="name">${item.title}</div>
                <div class="artist">${item.artist}</div>
            </div>
            <button class="btn-circle small" onclick="event.stopPropagation(); removeFromPlaylist('${name}', '${item.id}')">🗑</button>
        `;
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
   NAV & MODAL LOGIC (Backdrop Click Fix)
   ========================================================================== */
function setActiveView(view) {
    homeView.style.display = 'none';
    libraryView.style.display = 'none';
    navHome.classList.remove('active');
    navLibrary.classList.remove('active');
    navProfile.classList.remove('active');
    
    if(view === 'home') {
        homeView.style.display = 'block';
        navHome.classList.add('active');
        if(songListEl.innerHTML === '') {
             categoriesGrid.style.display = 'grid';
             songListEl.style.display = 'none';
        }
    } else if (view === 'library') {
        libraryView.style.display = 'block';
        navLibrary.classList.add('active');
        renderLibrary();
    }
}

navHome.addEventListener('click', () => setActiveView('home'));
navLibrary.addEventListener('click', () => setActiveView('library'));

// Profile Modal
navProfile.addEventListener('click', () => {
    openModal(profileModal.parentElement);
    navProfile.classList.add('active');
});

// MODAL UTILS
function openModal(el) { el.style.display = 'flex'; }
function closeModal(el) { el.style.display = 'none'; }

// Close button listeners
closeModalBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        closeModal(e.target.closest('.modal-backdrop'));
    });
});

if(closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        closeModal(modalBackdrop);
        if(homeView.style.display === 'block') navHome.classList.add('active');
        else navLibrary.classList.add('active');
    });
}

// *** CLICKING BACKDROP CLOSES MODAL ***
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
        // Close only if clicking the dark background, not the modal itself
        if(e.target === backdrop) {
            closeModal(backdrop);
        }
    });
});

// Search Debounce
let timeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const q = e.target.value.trim();
    if(q.length > 0) {
        categoriesGrid.style.display = 'none';
        songListEl.style.display = 'flex';
        timeout = setTimeout(() => searchYouTube(q), 1000);
    } else {
        categoriesGrid.style.display = 'grid';
        songListEl.style.display = 'none';
    }
});

// Global Trigger for Carousel
window.triggerSearch = (artist) => {
    searchInput.value = artist;
    categoriesGrid.style.display = 'none';
    songListEl.style.display = 'flex';
    searchYouTube(artist);
}

// Init
renderCategories();