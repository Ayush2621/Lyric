/* ==========================================================================
   1. CONFIGURATION & STATE
   ========================================================================== */
const YOUTUBE_API_KEY = "AIzaSyApMe9q_hGlgXF2V_d9tSvd0VWA4LDH6qU";
const PLAYLIST_STORAGE_KEY = "lyric_playlists_v6";

let player;
let currentVideoId = null;
let currentSongTitle = "Not Playing";
let currentSongArtist = "Select a song";
let currentSongCover = "";
let progressInterval;
let playlists = loadPlaylists();
let currentSearchItems = [];
let shuffleEnabled = false;
let repeatMode = "off"; // 'off', 'one', 'all'

// Context / queue
let currentContext = "search"; // 'search' or 'playlist'
let currentPlaylistName = null;

// Global playback queue
let playbackQueue = []; // [{id,title,artist,cover,sourceType,playlistName?}]
let playbackIndex = -1;
let queueType = null; // 'search' | 'playlist'
let queueSourceName = null; // playlist name if queueType === 'playlist'
let searchQueue = []; // normalized search queue

// Background Play State
let shouldBePlaying = false;
let keepAliveContext = null;
let keepAliveOscillator = null;
let backgroundWorker = null;

/* ==========================================================================
   2. DOM ELEMENTS
   ========================================================================== */
const searchInput = document.getElementById("searchInput");
const songListEl = document.getElementById("songList");
const categoriesGrid = document.getElementById("categoriesGrid");
const categoryNavHeader = document.getElementById("categoryNavHeader");
const btnBackToCategories = document.getElementById("btnBackToCategories");
const currentCategoryTitle = document.getElementById("currentCategoryTitle");

// Mini Player
const miniPlayer = document.getElementById("miniPlayer");
const miniTitle = document.getElementById("miniTitle");
const miniArtist = document.getElementById("miniArtist");
const miniCover = document.getElementById("miniCover");
const miniPlayToggle = document.getElementById("miniPlayToggle");
const miniPlayIcon = document.getElementById("miniPlayIcon");
const progressBar = document.getElementById("progressBar");
const progressContainer = document.getElementById("progressContainer");
const currentTimeDisplay = document.getElementById("currentTimeDisplay");
const durationDisplay = document.getElementById("durationDisplay");
const btnNext = document.getElementById("btnNext");
const btnPrev = document.getElementById("btnPrev");
const btnShuffle = document.getElementById("btnShuffle");
const btnRepeat = document.getElementById("btnRepeat");
const btnExpand = document.getElementById("btnExpand");

// Fullscreen Player
const fsModal = document.getElementById("fullScreenPlayer");
const fsClose = document.getElementById("fsClose");
const fsTitle = document.getElementById("fsTitle");
const fsArtist = document.getElementById("fsArtist");
const fsPlay = document.getElementById("fsPlay");
const fsPrev = document.getElementById("fsPrev");
const fsNext = document.getElementById("fsNext");
const fsShuffle = document.getElementById("fsShuffle");
const fsRepeat = document.getElementById("fsRepeat");
const fsProgress = document.getElementById("fsProgress");
const fsProgressWrap = document.getElementById("fsProgressWrap");
const fsCurrent = document.getElementById("fsCurrent");
const fsDuration = document.getElementById("fsDuration");
const fsDescription = document.getElementById("fsDescription");
const lyricsContent = document.getElementById("lyricsContent");
const fsTabs = document.querySelectorAll(".tab-btn");
const fsPanels = document.querySelectorAll(".fs-panel");

// Views & Modals
const navHome = document.getElementById("navHome");
const navLibrary = document.getElementById("navLibrary");
const navProfile = document.getElementById("navProfile");
const homeView = document.getElementById("homeView");
const libraryView = document.getElementById("libraryView");
const libraryList = document.getElementById("libraryList");
const modalBackdrop = document.getElementById("modalBackdrop");
const closeModalBtn = document.getElementById("closeModal");
const profileModal = document.getElementById("profileModal");
const addPlaylistModalBackdrop = document.getElementById("addPlaylistModalBackdrop");
const addPlaylistModal = document.getElementById("addPlaylistModal");
const addPlaylistList = document.getElementById("addPlaylistList");
const createPlaylistModalBackdrop = document.getElementById("createPlaylistModalBackdrop");
const createPlaylistModal = document.getElementById("createPlaylistModal");
const newPlaylistInput = document.getElementById("newPlaylistInput");
const createPlaylistConfirmBtn = document.getElementById("createPlaylistConfirmBtn");
const closeModalBtns = document.querySelectorAll(".modal-close-btn");

/* ==========================================================================
   3. BACKGROUND AUDIO HACK (Improved)
   ========================================================================== */
function initKeepAlive() {
  if (keepAliveContext) return;
  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;
    keepAliveContext = new AudioContext();

    // Silent oscillator
    keepAliveOscillator = keepAliveContext.createOscillator();
    const gainNode = keepAliveContext.createGain();
    gainNode.gain.value = 0.0001;

    keepAliveOscillator.connect(gainNode);
    gainNode.connect(keepAliveContext.destination);
    keepAliveOscillator.start();

    if (keepAliveContext.state === "suspended") {
      keepAliveContext.resume();
    }

    // Worker heartbeat
    if (!backgroundWorker) {
      const blob = new Blob(
        [`setInterval(() => { postMessage('tick'); }, 1000);`],
        { type: "application/javascript" }
      );
      backgroundWorker = new Worker(URL.createObjectURL(blob));
      backgroundWorker.onmessage = function () {
        if (
          keepAliveContext &&
          keepAliveContext.state === "suspended"
        ) {
          keepAliveContext.resume();
        }
        if (
          player &&
          shouldBePlaying &&
          player.getPlayerState &&
          player.getPlayerState() === 2
        ) {
          player.playVideo();
        }
      };
    }

    startBackgroundWatchdog();
  } catch (e) {
    console.error("Audio Hack Error:", e);
  }
}

function startBackgroundWatchdog() {
  if (window._bgWatchdog) return;
  window._bgWatchdog = setInterval(() => {
    try {
      if (!player || !player.getPlayerState) return;
      if (!shouldBePlaying) return;

      if (keepAliveContext && keepAliveContext.state === "suspended") {
        keepAliveContext.resume();
      }

      const state = player.getPlayerState();
      if (
        state === YT.PlayerState.PAUSED ||
        state === YT.PlayerState.ENDED ||
        state === YT.PlayerState.UNSTARTED ||
        state === YT.PlayerState.CUED
      ) {
        player.playVideo();
      }
    } catch (e) {
      console.log("Background watchdog error:", e);
    }
  }, 4000);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (keepAliveContext && keepAliveContext.state === "suspended") {
      keepAliveContext.resume();
    }
    if (
      player &&
      shouldBePlaying &&
      player.getPlayerState &&
      player.getPlayerState() !== YT.PlayerState.PLAYING
    ) {
      player.playVideo();
    }
  }
});

/* ==========================================================================
   4. YOUTUBE API SETUP
   ========================================================================== */
var tag = document.createElement("script");
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName("script")[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
  player = new YT.Player("youtube-player", {
    height: "100%",
    width: "100%",
    playerVars: {
      playsinline: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      origin: window.location.origin,
    },
    events: {
      onStateChange: onPlayerStateChange,
      onError: (e) => console.log("Player Error", e),
    },
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    updatePlayButtons(true);
    startProgressLoop();
    updateMediaSession(
      currentSongTitle,
      currentSongArtist,
      currentSongCover
    );
    initKeepAlive();
  } else if (event.data === YT.PlayerState.PAUSED) {
    if (shouldBePlaying) player.playVideo();
    else {
      updatePlayButtons(false);
      stopProgressLoop();
    }
  } else if (event.data === YT.PlayerState.ENDED) {
    stopProgressLoop();
    if (repeatMode === "one") {
      player.seekTo(0);
      player.playVideo();
    } else {
      // ✅ always go via queue
      playNextSong();
    }
  }
}

function updatePlayButtons(isPlaying) {
  const icon = isPlaying ? "⏸" : "▶";
  if (miniPlayIcon) {
    miniPlayIcon.innerHTML = isPlaying
      ? '<rect x="6" y="5" width="4" height="14" fill="white"/><rect x="14" y="5" width="4" height="14" fill="white"/>'
      : '<path d="M5 3v18l15-9L5 3z" fill="white"/>';
  }
  if (fsPlay) fsPlay.textContent = icon;
}

/* ==========================================================================
   5. PROGRESS & MARQUEE
   ========================================================================== */
function startProgressLoop() {
  stopProgressLoop();
  progressInterval = setInterval(() => {
    if (!player || !player.getCurrentTime) return;
    const curr = player.getCurrentTime();
    const dur = player.getDuration();
    if (dur > 0) {
      const pct = (curr / dur) * 100;
      progressBar.style.width = pct + "%";
      fsProgress.style.width = pct + "%";
      currentTimeDisplay.textContent = formatTime(curr);
      durationDisplay.textContent = formatTime(dur);
      fsCurrent.textContent = formatTime(curr);
      fsDuration.textContent = formatTime(dur);
    }
  }, 500);
}
function stopProgressLoop() {
  clearInterval(progressInterval);
}
function formatTime(sec) {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function setupMarqueeIfNeeded() {
  const marquee = document.getElementById("miniTitle");
  const wrap = document.querySelector(".marquee-wrap");
  if (!marquee || !wrap) return;

  if (!document.getElementById("marquee-style")) {
    const s = document.createElement("style");
    s.id = "marquee-style";
    s.innerHTML = `
      @keyframes marquee {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .marquee { display: inline-block; white-space: nowrap; }
    `;
    document.head.appendChild(s);
  }

  marquee.style.animation = "none";
  marquee.textContent = currentSongTitle || "Not Playing";

  requestAnimationFrame(() => {
    if (marquee.scrollWidth > wrap.clientWidth) {
      marquee.textContent =
        currentSongTitle + "   •   " + currentSongTitle;
      marquee.style.animation = "marquee 10s linear infinite";
    }
  });
}

/* ==========================================================================
   6. MEDIA SESSION
   ========================================================================== */
function updateMediaSession(title, artist, cover) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: [{ src: cover, sizes: "512x512", type: "image/jpeg" }],
    });
    navigator.mediaSession.setActionHandler("play", () => {
      shouldBePlaying = true;
      player.playVideo();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      shouldBePlaying = false;
      player.pauseVideo();
    });
    navigator.mediaSession.setActionHandler(
      "previoustrack",
      () => playPrevSong()
    );
    navigator.mediaSession.setActionHandler("nexttrack", () =>
      playNextSong()
    );
    navigator.mediaSession.setActionHandler("seekto", (details) =>
      player.seekTo(details.seekTime)
    );
  }
}

/* ==========================================================================
   7. LYRICS
   ========================================================================== */
fsTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    fsTabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    fsPanels.forEach((p) => (p.style.display = "none"));
    document.querySelector(`.fs-panel-${btn.dataset.tab}`).style.display =
      "block";
  });
});

async function updateLyrics(title, artist) {
  if (!lyricsContent) return;
  lyricsContent.innerHTML =
    '<div style="margin-top:20px;">Searching lyrics...</div>';
  const cleanTitle = title
    .replace(/\(.*\)|\[.*\]/g, "")
    .replace(/ft\.|feat\./gi, "")
    .trim();
  const cleanArtist = artist.replace(/ft\.|feat\./gi, "").trim();
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(
    cleanTitle + " " + cleanArtist
  )}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      lyricsContent.innerHTML = (data[0].plainLyrics || "Lyrics not found.")
        .replace(/\n/g, "<br>");
    } else {
      lyricsContent.innerHTML = "Lyrics not found.";
    }
  } catch (e) {
    lyricsContent.innerHTML = "Could not load lyrics.";
  }
}

/* ==========================================================================
   8. CORE PLAYBACK: VIDEO + QUEUE
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

  miniPlayer.style.display = "flex";
  openFullScreen();
  initKeepAlive();

  // refresh highlight in playlist view
  if (queueType === "playlist" && queueSourceName) {
    setTimeout(() => openPlaylistDetail(queueSourceName), 0);
  }
}

/* ====== QUEUE HELPERS ==================================================== */
function playFromQueue(index) {
  if (!playbackQueue.length) return;
  if (index < 0) index = 0;
  if (index >= playbackQueue.length) index = playbackQueue.length - 1;
  playbackIndex = index;
  const s = playbackQueue[playbackIndex];
  if (!s) return;
  playVideo(s.id, s.title, s.artist, s.cover);
}

function startSearchQueueFromIndex(index) {
  if (!searchQueue.length) return;
  queueType = "search";
  queueSourceName = null;
  currentContext = "search";
  currentPlaylistName = null;
  playbackQueue = searchQueue.slice();
  playFromQueue(index);
}

function startPlaylistQueueFromIndex(name, index) {
  const list = playlists[name];
  if (!list || !list.length) return;
  queueType = "playlist";
  queueSourceName = name;
  currentContext = "playlist";
  currentPlaylistName = name;
  playbackQueue = list.slice();
  playFromQueue(index);
}

function syncQueueToPlaylist(name) {
  if (queueType === "playlist" && queueSourceName === name) {
    const list = playlists[name];
    playbackQueue = list.slice();
    playbackIndex = list.findIndex((s) => s.id === currentVideoId);
    if (playbackIndex === -1) playbackIndex = 0;
  }
}

/* ====== NEXT / PREV using QUEUE ========================================= */
function playNextSong() {
  if (!playbackQueue.length) return;

  if (shuffleEnabled) {
    playbackIndex = Math.floor(Math.random() * playbackQueue.length);
    playFromQueue(playbackIndex);
    return;
  }

  if (playbackIndex < playbackQueue.length - 1) {
    playbackIndex++;
    playFromQueue(playbackIndex);
  } else {
    if (repeatMode === "all") {
      playbackIndex = 0;
      playFromQueue(playbackIndex);
    } else {
      // end of queue, no repeat-all → just stop
      shouldBePlaying = false;
    }
  }
}

function playPrevSong() {
  if (!playbackQueue.length) return;
  if (playbackIndex > 0) {
    playbackIndex--;
    playFromQueue(playbackIndex);
  }
}

window.togglePlay = () => {
  if (!player || !player.getPlayerState) return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    shouldBePlaying = false;
    player.pauseVideo();
  } else {
    shouldBePlaying = true;
    player.playVideo();
    if (keepAliveContext && keepAliveContext.state === "suspended") {
      keepAliveContext.resume();
    }
  }
};

/* ====== PLAYER BUTTONS =================================================== */
if (miniPlayToggle)
  miniPlayToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
if (fsPlay) fsPlay.addEventListener("click", togglePlay);
if (fsNext) fsNext.addEventListener("click", playNextSong);
if (btnNext)
  btnNext.addEventListener("click", (e) => {
    e.stopPropagation();
    playNextSong();
  });
if (fsPrev) fsPrev.addEventListener("click", playPrevSong);
if (btnPrev)
  btnPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    playPrevSong();
  });

if (btnShuffle)
  btnShuffle.addEventListener("click", () => {
    shuffleEnabled = !shuffleEnabled;
    btnShuffle.classList.toggle("active", shuffleEnabled);
    if (fsShuffle) fsShuffle.classList.toggle("active", shuffleEnabled);
  });
if (fsShuffle)
  fsShuffle.addEventListener("click", () => {
    shuffleEnabled = !shuffleEnabled;
    fsShuffle.classList.toggle("active", shuffleEnabled);
    if (btnShuffle) btnShuffle.classList.toggle("active", shuffleEnabled);
  });

function toggleRepeat() {
  if (repeatMode === "off") repeatMode = "all";
  else if (repeatMode === "all") repeatMode = "one";
  else repeatMode = "off";

  const icon = repeatMode === "one" ? "🔂" : "🔁";
  const color = repeatMode === "off" ? "var(--text)" : "var(--accent)";

  if (btnRepeat) {
    btnRepeat.innerHTML = icon;
    btnRepeat.style.color = color;
  }
  if (fsRepeat) {
    fsRepeat.innerHTML = icon;
    fsRepeat.style.color = color;
  }
}
if (btnRepeat) btnRepeat.addEventListener("click", toggleRepeat);
if (fsRepeat) fsRepeat.addEventListener("click", toggleRepeat);

/* ====== FULLSCREEN / SEEK =============================================== */
function openFullScreen() {
  fsModal.style.display = "flex";
}
function closeFullScreen() {
  fsModal.style.display = "none";
}
miniPlayer.addEventListener("click", (e) => {
  if (!e.target.closest("button")) openFullScreen();
});
if (fsClose) fsClose.addEventListener("click", closeFullScreen);
if (btnExpand)
  btnExpand.addEventListener("click", (e) => {
    e.stopPropagation();
    openFullScreen();
  });

fsModal.addEventListener("click", (e) => {
  if (e.target === fsModal || e.target.id === "fsBackdrop") closeFullScreen();
});

function seek(e, el) {
  if (!player || !player.getDuration) return;
  const rect = el.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.seekTo(player.getDuration() * pct);
}
if (progressContainer)
  progressContainer.addEventListener("click", (e) =>
    seek(e, progressContainer)
  );
if (fsProgressWrap)
  fsProgressWrap.addEventListener("click", (e) =>
    seek(e, fsProgressWrap)
  );

/* ==========================================================================
   9. PLAYLISTS (DATA + UI + TOUCH REORDER)
   ========================================================================== */
function loadPlaylists() {
  try {
    return (
      JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY)) || {
        "My Favorites": [],
      }
    );
  } catch (e) {
    return { "My Favorites": [] };
  }
}
function savePlaylists() {
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
}

let songToAdd = null;

window.showAddPlaylistModal = (id, title, artist, cover) => {
  songToAdd = { id, title, artist, cover };
  if (!addPlaylistList) return;
  addPlaylistList.innerHTML = "";
  const names = Object.keys(playlists).sort();
  names.forEach((name) => {
    const item = document.createElement("div");
    item.className = "modal-playlist-item";
    item.style.padding = "10px";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
    item.innerHTML = `
      <span>${name} (${playlists[name].length})</span> 
      <button class="btn-circle small" style="width:30px;height:30px;">+</button>`;
    item
      .querySelector("button")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        addToPlaylist(name, songToAdd);
      });
    addPlaylistList.appendChild(item);
  });
  const createNew = document.createElement("div");
  createNew.style.padding = "15px 10px";
  createNew.style.textAlign = "center";
  createNew.innerHTML = `<button class="btn-primary" style="width:100%">Create New Playlist</button>`;
  createNew
    .querySelector("button")
    .addEventListener("click", () =>
      openModal(createPlaylistModalBackdrop)
    );
  addPlaylistList.appendChild(createNew);
  openModal(addPlaylistModalBackdrop);
};

function addToPlaylist(playlistName, song) {
  if (!playlists[playlistName]) playlists[playlistName] = [];
  const exists = playlists[playlistName].find((s) => s.id === song.id);
  if (!exists) {
    playlists[playlistName].push(song);
    savePlaylists();
    alert(`Added to ${playlistName}`);
    closeModal(addPlaylistModalBackdrop);
  } else {
    alert("Already in playlist");
  }
}

function createNewPlaylist(name) {
  if (playlists[name]) {
    alert("Playlist exists");
    return;
  }
  playlists[name] = [];
  if (songToAdd) playlists[name].push(songToAdd);
  savePlaylists();
  closeModal(createPlaylistModalBackdrop);
  closeModal(addPlaylistModalBackdrop);
  alert(`Created ${name}`);
  if (libraryView.style.display === "block") renderLibrary();
}

if (createPlaylistConfirmBtn) {
  createPlaylistConfirmBtn.addEventListener("click", () => {
    const name = newPlaylistInput.value.trim();
    if (name) createNewPlaylist(name);
  });
}

function renderLibrary() {
  libraryList.innerHTML = "";
  const names = Object.keys(playlists);
  if (names.length === 0) {
    libraryList.innerHTML = '<div class="empty">No playlists.</div>';
    return;
  }
  names.forEach((name) => {
    const div = document.createElement("div");
    div.className = "playlist-card";
    div.innerHTML = `
      <div class="thumb">${name.substring(0, 2).toUpperCase()}</div>
      <div class="playlist-name">${name}</div>
      <div style="font-size:12px; color:#888">${playlists[name].length} songs</div>`;
    div.addEventListener("click", () => openPlaylistDetail(name));
    libraryList.appendChild(div);
  });
}

// Inject styles for playlist drag + Now Playing badge
function ensurePlaylistStyles() {
  if (document.getElementById("playlist-style")) return;
  const s = document.createElement("style");
  s.id = "playlist-style";
  s.innerHTML = `
    .playlist-song { cursor: grab; }
    .playlist-song.dragging { opacity: .6; }
    .playlist-song .drag-handle { cursor: grab; opacity: .7; font-size:18px; padding-left:8px; }
    .playlist-song.active-song {
      border: 1px solid var(--accent);
      background: rgba(255,255,255,0.04);
    }
    .np-badge {
      display: inline-block;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--accent);
      color: #000;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(s);
}

function openPlaylistDetail(name) {
  ensurePlaylistStyles();

  libraryList.innerHTML = "";
  const header = document.createElement("div");
  header.style.marginBottom = "20px";
  header.innerHTML = `
    <button class="btn-circle small" id="backToLib">←</button> 
    <span style="font-size:20px; font-weight:bold; margin-left:10px;">${name}</span>`;
  libraryList.appendChild(header);
  document
    .getElementById("backToLib")
    .addEventListener("click", renderLibrary);

  const songs = playlists[name];
  if (!songs || songs.length === 0) {
    libraryList.innerHTML += '<div class="empty">Empty playlist.</div>';
    return;
  }

  songs.forEach((item, idx) => {
    const isActive =
      queueType === "playlist" &&
      queueSourceName === name &&
      currentVideoId === item.id;

    const div = document.createElement("div");
    div.className =
      "song playlist-song" + (isActive ? " active-song" : "");
    div.dataset.id = item.id;
    div.dataset.index = String(idx);

    div.innerHTML = `
      <div class="cover" style="background-image: url('${item.cover}')"></div>
      <div class="meta">
        <div class="name">${item.title}</div>
        <div class="artist">${item.artist}</div>
        ${isActive ? '<div class="np-badge">Now Playing</div>' : ""}
      </div>
      <div class="controls">
        <span class="drag-handle">⋮⋮</span>
        <button class="btn-circle small" onclick="event.stopPropagation(); removeFromPlaylist('${name}', '${item.id}')">🗑</button>
      </div>
    `;

    // Tap ⇒ start playlist queue from this index
    div.addEventListener("click", () => {
      startPlaylistQueueFromIndex(name, idx);
    });

    libraryList.appendChild(div);
  });

  initPlaylistReorder(name);
}

function initPlaylistReorder(name) {
  const items = Array.from(
    libraryList.querySelectorAll(".playlist-song")
  );
  if (!items.length) return;

  let draggingId = null;

  function startDrag(item, event) {
    if (!event.target.closest(".drag-handle")) return;
    draggingId = item.dataset.id;
    item.classList.add("dragging");

    if (navigator.vibrate) {
      try {
        navigator.vibrate(15);
      } catch (_) {}
    }
  }

  function finishDrag(pointerY) {
    if (!draggingId) return;
    const list = playlists[name];
    if (!list) return;

    const all = Array.from(
      libraryList.querySelectorAll(".playlist-song")
    );
    let targetEl = null;
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (pointerY >= rect.top && pointerY <= rect.bottom) {
        targetEl = el;
        break;
      }
    }

    all.forEach((el) => el.classList.remove("dragging"));

    if (!targetEl) {
      draggingId = null;
      return;
    }

    const targetId = targetEl.dataset.id;
    if (targetId === draggingId) {
      draggingId = null;
      return;
    }

    const fromIndex = list.findIndex((s) => s.id === draggingId);
    const toIndex = list.findIndex((s) => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      draggingId = null;
      return;
    }

    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    savePlaylists();
    draggingId = null;

    // Sync queue if this playlist is playing
    syncQueueToPlaylist(name);
    openPlaylistDetail(name);
  }

  function onTouchStart(e) {
    startDrag(e.currentTarget, e);
  }
  function onTouchEnd(e) {
    const touch =
      e.changedTouches && e.changedTouches[0];
    if (touch) finishDrag(touch.clientY);
  }
  function onMouseDown(e) {
    startDrag(e.currentTarget, e);
    function onMouseUp(ev) {
      finishDrag(ev.clientY);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mouseup", onMouseUp);
  }

  items.forEach((item) => {
    item.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    item.addEventListener("touchend", onTouchEnd);
    item.addEventListener("mousedown", onMouseDown);
  });
}

window.removeFromPlaylist = (name, id) => {
  playlists[name] = playlists[name].filter((s) => s.id !== id);
  savePlaylists();
  syncQueueToPlaylist(name);
  openPlaylistDetail(name);
};

/* ==========================================================================
   10. NAV & SEARCH
   ========================================================================== */
function setActiveView(view) {
  homeView.style.display = "none";
  libraryView.style.display = "none";
  navHome.classList.remove("active");
  navLibrary.classList.remove("active");
  navProfile.classList.remove("active");

  if (view === "home") {
    homeView.style.display = "block";
    navHome.classList.add("active");
    if (songListEl.innerHTML === "") {
      categoriesGrid.style.display = "grid";
      songListEl.style.display = "none";
    }
  } else if (view === "library") {
    libraryView.style.display = "block";
    navLibrary.classList.add("active");
    renderLibrary();
  }
}
navHome.addEventListener("click", () => setActiveView("home"));
navLibrary.addEventListener("click", () => setActiveView("library"));
navProfile.addEventListener("click", () => {
  openModal(profileModal.parentElement);
  navProfile.classList.add("active");
});

function openModal(el) {
  el.style.display = "flex";
}
function closeModal(el) {
  el.style.display = "none";
}
closeModalBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    closeModal(e.target.closest(".modal-backdrop"));
  });
});
if (closeModalBtn) {
  closeModalBtn.addEventListener("click", () => {
    closeModal(modalBackdrop);
    if (homeView.style.display === "block")
      navHome.classList.add("active");
    else navLibrary.classList.add("active");
  });
}
document
  .querySelectorAll(".modal-backdrop")
  .forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closeModal(backdrop);
      }
    });
  });

let timeout;
searchInput.addEventListener("input", (e) => {
  clearTimeout(timeout);
  const q = e.target.value.trim();
  if (q.length > 0) {
    categoriesGrid.style.display = "none";
    songListEl.style.display = "flex";
    timeout = setTimeout(() => searchYouTube(q), 1000);
  } else {
    categoriesGrid.style.display = "grid";
    songListEl.style.display = "none";
  }
});

window.triggerSearch = (artist) => {
  searchInput.value = artist;
  categoriesGrid.style.display = "none";
  songListEl.style.display = "flex";
  searchYouTube(artist);
};

const musicCategories = [
  {
    id: "trending",
    name: "Trending Now",
    color: "#E91E63",
    query: "Trending Music",
  },
  {
    id: "hindi",
    name: "Top Hindi",
    color: "#9C27B0",
    query: "Latest Hindi Songs",
  },
  {
    id: "telugu",
    name: "Top Telugu",
    color: "#3F51B5",
    query: "Latest Telugu Songs",
  },
  {
    id: "tamil",
    name: "Top Tamil",
    color: "#009688",
    query: "Latest Tamil Songs",
  },
  {
    id: "english",
    name: "Top English",
    color: "#FF9800",
    query: "Top Global Hits",
  },
  {
    id: "lofi",
    name: "Lofi Beats",
    color: "#607D8B",
    query: "Lofi Hip Hop",
  },
];

function renderCategories() {
  if (!categoriesGrid) return;
  categoriesGrid.innerHTML = "";
  musicCategories.forEach((cat) => {
    const div = document.createElement("div");
    div.className = "category-card";
    div.style.background = cat.color;
    div.innerHTML = `
      <div class="category-card-content">
        <div class="category-name">${cat.name}</div>
      </div>`;
    div.onclick = () => openCategory(cat);
    categoriesGrid.appendChild(div);
  });
}

function openCategory(cat) {
  categoriesGrid.style.display = "none";
  songListEl.style.display = "flex";
  categoryNavHeader.style.display = "flex";
  currentCategoryTitle.textContent = cat.name;
  searchYouTube(cat.query);
}

if (btnBackToCategories) {
  btnBackToCategories.addEventListener("click", () => {
    categoriesGrid.style.display = "grid";
    songListEl.style.display = "none";
    categoryNavHeader.style.display = "none";
  });
}

async function searchYouTube(query) {
  songListEl.innerHTML = '<div class="empty">Loading...</div>';
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
    query
  )}&type=video&videoCategoryId=10&maxResults=25&key=${YOUTUBE_API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.items) {
      currentSearchItems = data.items;
      renderSongs(data.items);
    } else {
      songListEl.innerHTML =
        '<div class="empty">No results found.</div>';
    }
  } catch (e) {
    console.error(e);
    songListEl.innerHTML =
      '<div class="empty">Check your internet connection.</div>';
  }
}

function renderSongs(items) {
  songListEl.innerHTML = "";
  searchQueue = [];

  items.forEach((item) => {
    const id = item.id.videoId;
    const parser = new DOMParser();
    const titleRaw = item.snippet.title;
    const title = parser.parseFromString(
      titleRaw,
      "text/html"
    ).body.textContent;
    const channel = item.snippet.channelTitle;
    const thumb = item.snippet.thumbnails.default.url;
    const thumbHigh = item.snippet.thumbnails.high.url;

    searchQueue.push({
      id,
      title,
      artist: channel,
      cover: thumbHigh,
      sourceType: "search",
    });
  });

  searchQueue.forEach((song, index) => {
    const original = items[index];
    const thumbSmall = original.snippet.thumbnails.default.url;

    const div = document.createElement("div");
    div.className = "song";
    div.innerHTML = `
      <div class="cover" style="background-image: url('${thumbSmall}')"></div>
      <div class="meta">
        <div class="name">${song.title}</div>
        <div class="artist">${song.artist}</div>
      </div>
      <div class="controls">
        <button class="btn-circle small" style="font-size:16px"
          onclick="event.stopPropagation(); showAddPlaylistModal('${song.id}', '${song.title.replace(
      /'/g,
      "\\'"
    )}', '${song.artist.replace(/'/g, "\\'")}', '${song.cover}')">＋</button>
      </div>
    `;

    div.addEventListener("click", () => {
      startSearchQueueFromIndex(index);
    });

    songListEl.appendChild(div);
  });
}

renderCategories();
