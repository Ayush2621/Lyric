/* ==========================================================================
   1. CONFIGURATION & GLOBAL STATE
   ========================================================================== */
/* --- MULTIPLE YOUTUBE API KEYS WITH AUTO-SWITCH --- */
const YT_API_KEYS = [
  "AIzaSyCaFmBuGlPyXIvEddP0B5MVDiejERURLAE", // public key first
  "AIzaSyApMe9q_hGlgXF2V_d9tSvd0VWA4LDH6qU", // restricted key second
];
let activeApiIndex = 0;
function getActiveApiKey() {
  return YT_API_KEYS[activeApiIndex];
}
function rotateApiKey() {
  activeApiIndex = (activeApiIndex + 1) % YT_API_KEYS.length;
}

/* --- playlists + quota keys --- */
const PLAYLIST_STORAGE_KEY = "lyric_playlists_v6";
const MAX_SEARCHES_PER_DAY = 50;
const SEARCH_QUOTA_KEY = "yt_search_quota_v1";
const SEARCH_CACHE_KEY = "yt_search_cache_v1";

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

// Playback context
let currentContext = "search";       // 'search' | 'playlist'
let currentPlaylistName = null;      // which playlist is active

// Background play & Media Session State
let shouldBePlaying = false;
let silentAudio = null; // Replaces oscillator for better Lockscreen support

// Search cache (per device)
let searchCache = loadSearchCache();

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

/* quota UI element */
let searchQuotaLabel = null;

/* ==========================================================================
   3. BACKGROUND AUDIO & MEDIA SESSION FIX
   ========================================================================== */
// We use a silent MP3 loop. This "tricks" the OS into thinking a native audio 
// track is playing, which enables the Lockscreen UI and keeps the app alive in background.
const SILENT_MP3_B64 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAD9MYXZjNTguNTQuMTAwAAAAAAAAAAAA//OEAAAAAAABEAAAAQAABHHpAAAAAAAAAAAAAA";

function initSilentAudio() {
  if (silentAudio) return;
  
  silentAudio = new Audio(SILENT_MP3_B64);
  silentAudio.loop = true;
  silentAudio.volume = 0; // Silent
  silentAudio.autoplay = false;
  
  // Mobile browsers require user interaction to start audio. 
  // We attach a one-time listener to the document.
  const unlockAudio = () => {
    silentAudio.play().then(() => {
      silentAudio.pause(); // Immediately pause, we only play when video plays
      silentAudio.currentTime = 0;
    }).catch(e => console.log("Silent audio unlock failed yet", e));
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);
}

// Call this immediately
initSilentAudio();

function syncSilentAudio(isPlaying) {
  if (!silentAudio) initSilentAudio();
  if (isPlaying) {
    silentAudio.play().catch(e => console.error("Silent Audio Play Error:", e));
  } else {
    silentAudio.pause();
  }
}

// Ensure video resumes if paused by OS when switching apps
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (shouldBePlaying && player && player.getPlayerState && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      player.playVideo();
      syncSilentAudio(true);
    }
  }
});

/* ==========================================================================
   4. YOUTUBE IFRAME API
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
      onReady: () => { console.log("Player Ready"); }
    },
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    shouldBePlaying = true;
    updatePlayButtons(true);
    startProgressLoop();
    syncSilentAudio(true); // Keep alive
    updateMediaSession(currentSongTitle, currentSongArtist, currentSongCover);
    
    // Ensure media session state is playing
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }
    
  } else if (event.data === YT.PlayerState.PAUSED) {
    // If user didn't intentionally pause (e.g., backgrounding caused it), try to resume
    if (shouldBePlaying) {
        // Small delay to prevent conflict loop
        setTimeout(() => {
            if(shouldBePlaying) player.playVideo();
        }, 100);
    } else {
      updatePlayButtons(false);
      stopProgressLoop();
      syncSilentAudio(false);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
    }
  } else if (event.data === YT.PlayerState.ENDED) {
    stopProgressLoop();
    syncSilentAudio(false);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
    if (repeatMode === "one") {
      player.seekTo(0);
      player.playVideo();
    } else {
      playNextSong();
    }
  } else if (event.data === YT.PlayerState.BUFFERING) {
      // Keep silent audio playing during buffering to hold the lockscreen
      syncSilentAudio(true); 
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
      .active-song { border: 1px solid var(--accent); background: rgba(255,255,255,0.05); }
      .np-badge { display:inline-block;font-size:10px;padding:2px 6px;border-radius:999px;background:var(--accent);color:#000;margin-top:4px;}
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
   6. MEDIA SESSION (Lockscreen + Earphone Controls)
   ========================================================================== */
function updateMediaSession(title, artist, cover) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      artwork: [
        { src: cover, sizes: "96x96", type: "image/jpeg" },
        { src: cover, sizes: "128x128", type: "image/jpeg" },
        { src: cover, sizes: "192x192", type: "image/jpeg" },
        { src: cover, sizes: "256x256", type: "image/jpeg" },
        { src: cover, sizes: "384x384", type: "image/jpeg" },
        { src: cover, sizes: "512x512", type: "image/jpeg" },
      ],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      shouldBePlaying = true;
      syncSilentAudio(true);
      if (player && player.playVideo) player.playVideo();
      navigator.mediaSession.playbackState = "playing";
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      shouldBePlaying = false;
      syncSilentAudio(false);
      if (player && player.pauseVideo) player.pauseVideo();
      navigator.mediaSession.playbackState = "paused";
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      playPrevSong();
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      playNextSong();
    });

    navigator.mediaSession.setActionHandler("seekto", (details) => {
        if(player && player.seekTo) {
             player.seekTo(details.seekTime);
        }
    });

    try {
      navigator.mediaSession.setActionHandler("stop", () => {
        shouldBePlaying = false;
        syncSilentAudio(false);
        if (player && player.stopVideo) player.stopVideo();
        navigator.mediaSession.playbackState = "none";
      });
    } catch (e) {
      // some browsers don't support 'stop'
    }
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
   8. CORE PLAYBACK
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
  
  // Important: Update media session immediately so lockscreen updates
  updateMediaSession(title, artist, cover);
  syncSilentAudio(true);

  miniPlayer.style.display = "flex";
  openFullScreen();
  
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }

  if (currentContext === "playlist" && currentPlaylistName) {
    setTimeout(() => openPlaylistDetail(currentPlaylistName), 0);
  }
}

function playNextSong() {
  if (
    currentContext === "playlist" &&
    currentPlaylistName &&
    playlists[currentPlaylistName]
  ) {
    const list = playlists[currentPlaylistName];
    if (!list || list.length === 0) return;

    const idx = list.findIndex((s) => s.id === currentVideoId);
    if (idx >= 0 && idx < list.length - 1) {
      const next = list[idx + 1];
      playVideo(next.id, next.title, next.artist, next.cover);
      return;
    } else if (repeatMode === "all" && list.length > 0) {
      const next = list[0];
      playVideo(next.id, next.title, next.artist, next.cover);
      return;
    }
    return;
  }

  if (currentSearchItems.length > 0) {
    if (shuffleEnabled) {
      const randIdx = Math.floor(Math.random() * currentSearchItems.length);
      const item = currentSearchItems[randIdx];
      playVideo(
        item.id.videoId,
        item.snippet.title,
        item.snippet.channelTitle,
        item.snippet.thumbnails.high.url
      );
    } else {
      const idx = currentSearchItems.findIndex(
        (x) => x.id.videoId === currentVideoId
      );
      if (idx >= 0 && idx < currentSearchItems.length - 1) {
        const item = currentSearchItems[idx + 1];
        playVideo(
          item.id.videoId,
          item.snippet.title,
          item.snippet.channelTitle,
          item.snippet.thumbnails.high.url
        );
      } else if (repeatMode === "all") {
        const item = currentSearchItems[0];
        playVideo(
          item.id.videoId,
          item.snippet.title,
          item.snippet.channelTitle,
          item.snippet.thumbnails.high.url
        );
      }
    }
  }
}

function playPrevSong() {
  if (
    currentContext === "playlist" &&
    currentPlaylistName &&
    playlists[currentPlaylistName]
  ) {
    const list = playlists[currentPlaylistName];
    if (!list || list.length === 0) return;
    const idx = list.findIndex((s) => s.id === currentVideoId);
    if (idx > 0) {
      const prev = list[idx - 1];
      playVideo(prev.id, prev.title, prev.artist, prev.cover);
      return;
    }
    return;
  }

  if (currentSearchItems.length > 0) {
    const idx = currentSearchItems.findIndex(
      (x) => x.id.videoId === currentVideoId
    );
    if (idx > 0) {
      const item = currentSearchItems[idx - 1];
      playVideo(
        item.id.videoId,
        item.snippet.title,
        item.snippet.channelTitle,
        item.snippet.thumbnails.high.url
      );
    }
  }
}

window.togglePlay = () => {
  if (!player || !player.getPlayerState) return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    shouldBePlaying = false;
    player.pauseVideo();
    syncSilentAudio(false);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "paused";
    }
  } else {
    shouldBePlaying = true;
    player.playVideo();
    syncSilentAudio(true);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }
  }
};

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

/* ==========================================================================
   9. FULLSCREEN & SEEK + PRO VIDEO LOOK
   ========================================================================== */
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

// ===== Smooth scrubbing / seeking (mini player + fullscreen) =====
function getClientXFromEvent(e) {
  if (e.touches && e.touches.length) return e.touches[0].clientX;
  if (e.changedTouches && e.changedTouches.length)
    return e.changedTouches[0].clientX;
  return e.clientX;
}

function scrubToPosition(e, el) {
  if (!player || !player.getDuration) return;
  const rect = el.getBoundingClientRect();
  const clientX = getClientXFromEvent(e);
  let pct = (clientX - rect.left) / rect.width;
  if (pct < 0) pct = 0;
  if (pct > 1) pct = 1;

  const dur = player.getDuration();
  if (dur && dur > 0) {
    player.seekTo(dur * pct, true);
  }
}

// Attach “Spotify-like” scrub behavior to a progress element
function attachScrubber(el) {
  if (!el) return;
  let isScrubbing = false;

  const onMove = (e) => {
    if (!isScrubbing) return;
    e.preventDefault();
    scrubToPosition(e, el);
  };

  const endScrub = (e) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", endScrub);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", endScrub);
    document.removeEventListener("touchcancel", endScrub);
  };

  const startScrub = (e) => {
    if (!player || !player.getDuration) return;
    isScrubbing = true;
    e.preventDefault();
    scrubToPosition(e, el);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", endScrub);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", endScrub);
    document.addEventListener("touchcancel", endScrub);
  };

  el.addEventListener("mousedown", startScrub);
  el.addEventListener("touchstart", startScrub, { passive: false });

  // Still allow simple tap seek
  el.addEventListener("click", (e) => {
    scrubToPosition(e, el);
  });
}

// Mini player line
if (typeof progressContainer !== "undefined" && progressContainer) {
  attachScrubber(progressContainer);
}

// Fullscreen line
if (typeof fsProgressWrap !== "undefined" && fsProgressWrap) {
  attachScrubber(fsProgressWrap);
}


/* --- Inject "pro" styles for fullscreen video section --- */
(function injectFsVideoStyles() {
  if (document.getElementById("fs-video-style")) return;
  const s = document.createElement("style");
  s.id = "fs-video-style";
  s.innerHTML = `
    #fullScreenPlayer {
      align-items: stretch;
    }
    #fullScreenPlayer .fs-content,
    #fullScreenPlayer .fs-main {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    #fullScreenPlayer #youtube-player {
      width: 100%;
      max-width: 700px;
      margin: 0 auto 12px auto;
      aspect-ratio: 16 / 9;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      background: #000;
    }
    #fullScreenPlayer .fs-top-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
  `;
  document.head.appendChild(s);
})();

/* ==========================================================================
   10. PLAYLISTS (UP/DOWN)
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

function openPlaylistDetail(name) {
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

  songs.forEach((item) => {
    const isActive =
      currentContext === "playlist" &&
      currentPlaylistName === name &&
      currentVideoId === item.id;

    const div = document.createElement("div");
    div.className = "song playlist-song" + (isActive ? " active-song" : "");
    div.innerHTML = `
      <div class="cover" style="background-image: url('${item.cover}')"></div>
      <div class="meta">
        <div class="name">${item.title}</div>
        <div class="artist">${item.artist}</div>
        ${isActive ? '<div class="np-badge">Now Playing</div>' : ""}
      </div>
      <div class="controls">
        <button class="btn-circle small" onclick="event.stopPropagation(); moveSongUp('${name}','${item.id}')">↑</button>
        <button class="btn-circle small" onclick="event.stopPropagation(); moveSongDown('${name}','${item.id}')">↓</button>
        <button class="btn-circle small" onclick="event.stopPropagation(); removeFromPlaylist('${name}','${item.id}')">🗑</button>
      </div>
    `;

    div.addEventListener("click", () => {
      currentContext = "playlist";
      currentPlaylistName = name;
      playVideo(item.id, item.title, item.artist, item.cover);
    });

    libraryList.appendChild(div);
  });
}

window.moveSongUp = (name, id) => {
  const list = playlists[name];
  if (!list) return;
  const idx = list.findIndex((s) => s.id === id);
  if (idx > 0) {
    const [song] = list.splice(idx, 1);
    list.splice(idx - 1, 0, song);
    savePlaylists();
    openPlaylistDetail(name);
  }
};

window.moveSongDown = (name, id) => {
  const list = playlists[name];
  if (!list) return;
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0 && idx < list.length - 1) {
    const [song] = list.splice(idx, 1);
    list.splice(idx + 1, 0, song);
    savePlaylists();
    openPlaylistDetail(name);
  }
};

window.removeFromPlaylist = (name, id) => {
  playlists[name] = playlists[name].filter((s) => s.id !== id);
  savePlaylists();
  openPlaylistDetail(name);
};

/* ==========================================================================
   11. NAVIGATION & MODALS
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
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

/* ==========================================================================
   12. SEARCH QUOTA + CACHE HELPERS
   ========================================================================== */
function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getQuotaState() {
  try {
    const raw = localStorage.getItem(SEARCH_QUOTA_KEY);
    const today = getTodayStr();
    if (!raw) return { date: today, count: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== today) return { date: today, count: 0 };
    if (typeof parsed.count !== "number") return { date: today, count: 0 };
    return parsed;
  } catch (e) {
    return { date: getTodayStr(), count: 0 };
  }
}

function canUseSearchQuota() {
  const state = getQuotaState();
  return state.count < MAX_SEARCHES_PER_DAY;
}

function consumeSearchQuota() {
  const state = getQuotaState();
  const updated = { date: state.date, count: state.count + 1 };
  try {
    localStorage.setItem(SEARCH_QUOTA_KEY, JSON.stringify(updated));
  } catch (_) {}
}

function loadSearchCache() {
  try {
    const raw = localStorage.getItem(SEARCH_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (e) {
    return {};
  }
}
function saveSearchCache() {
  try {
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(searchCache));
  } catch (_) {}
}

function setupQuotaUI() {
  if (!searchInput) return;
  let container = searchInput.parentElement || homeView || document.body;

  let el = document.getElementById("searchQuotaInfo");
  if (!el) {
    el = document.createElement("div");
    el.id = "searchQuotaInfo";
    el.style.fontSize = "11px";
    el.style.opacity = "0.8";
    el.style.marginTop = "4px";
    el.style.display = "flex";
    el.style.justifyContent = "space-between";
    el.style.gap = "8px";
    el.style.alignItems = "center";
    container.appendChild(el);
  }
  searchQuotaLabel = el;
  updateQuotaUI();
}

function updateQuotaUI() {
  if (!searchQuotaLabel) return;
  const state = getQuotaState();
  const used = state.count;
  const left = Math.max(0, MAX_SEARCHES_PER_DAY - used);

  searchQuotaLabel.innerHTML = `
    <span>Daily search limit: <strong>${MAX_SEARCHES_PER_DAY}</strong></span>
    <span>Used: <strong>${used}</strong> &nbsp;|&nbsp; Left: <strong>${left}</strong></span>
  `;
}

/* ==========================================================================
   13. SEARCH & CATEGORIES (with limit + multi-key)
   ========================================================================== */
let searchTimeout;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();

  if (q.length === 0) {
    categoriesGrid.style.display = "grid";
    songListEl.style.display = "none";
    return;
  }

  categoriesGrid.style.display = "none";
  songListEl.style.display = "flex";

  if (q.length < 3) {
    songListEl.innerHTML =
      '<div class="empty">Type at least 3 characters to search.</div>';
    return;
  }

  // "Complete search" only: wait 1.5s after user finishes typing
  searchTimeout = setTimeout(() => searchYouTube(q), 1500);
});

window.triggerSearch = (artist) => {
  searchInput.value = artist;
  categoriesGrid.style.display = "none";
  songListEl.style.display = "flex";
  searchYouTube(artist);
};

const musicCategories = [
  { id: "bollywood",  name: "Bollywood Bangers",  color: "linear-gradient(135deg, #FF416C, #FF4B2B)", query: "Latest Bollywood Party Songs" },
  { id: "sufi",       name: "Sufi Soul",          color: "linear-gradient(135deg, #11998e, #38ef7d)", query: "Best Sufi Songs" },
  { id: "hiphop",     name: "Desi Hip-Hop",       color: "linear-gradient(135deg, #f12711, #f5af19)", query: "Indian Hip Hop Songs" },
  { id: "retro",      name: "Retro Classics",     color: "linear-gradient(135deg, #8E2DE2, #4A00E0)", query: "Old Hindi Retro Songs" },
  { id: "monsoon",    name: "Monsoon Melodies",   color: "linear-gradient(135deg, #2193b0, #6dd5ed)", query: "Indian Monsoon Lofi Music" },
  { id: "devotional", name: "Divine Devotion",    color: "linear-gradient(135deg, #FF8008, #FFC837)", query: "Morning Bhakti Songs" },
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

/* --- multi-key + quota + cache search (fixed rotation) --- */
async function searchYouTube(query) {
  const trimmed = query.trim();
  if (!trimmed) return;

  const keyStr = trimmed.toLowerCase();
  const today = getTodayStr();

  // 1) cache first
  const cached = searchCache[keyStr];
  if (cached && cached.date === today && Array.isArray(cached.items)) {
    currentSearchItems = cached.items;
    renderSongs(cached.items);
    return;
  }

  // 2) daily quota check
  if (!canUseSearchQuota()) {
    const state = getQuotaState();
    const used = state.count;
    songListEl.innerHTML =
      `<div class="empty">You reached today's search limit (${used}/${MAX_SEARCHES_PER_DAY}). You can still play from playlists and already loaded songs.</div>`;
    updateQuotaUI();
    return;
  }

  // consume 1 slot for this "complete search"
  consumeSearchQuota();
  updateQuotaUI();

  songListEl.innerHTML = '<div class="empty">Loading...</div>';

  const buildUrl = (apiKey) =>
    `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      trimmed
    )}&type=video&videoCategoryId=10&maxResults=25&key=${apiKey}`;

  let lastError = null;

  // Try each key in order
  for (let i = 0; i < YT_API_KEYS.length; i++) {
    const apiKey = YT_API_KEYS[i];
    try {
      const res = await fetch(buildUrl(apiKey));

      if (!res.ok) {
        // HTTP error (403 etc)
        try {
          const errData = await res.json();
          console.error("YouTube HTTP error with key index", i, errData);
          lastError = errData;
        } catch (e) {
          console.error("YouTube HTTP error with key index", i, res.status);
          lastError = { status: res.status };
        }
        continue;
      }

      const data = await res.json();

      if (data.error) {
        console.error("YouTube API error with key index", i, data.error);
        lastError = data.error;
        continue;
      }

      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        activeApiIndex = i; // remember which key worked last
        currentSearchItems = data.items;
        searchCache[keyStr] = { date: today, items: data.items };
        saveSearchCache();
        renderSongs(data.items);
        return;
      } else {
        lastError = { message: "No items returned", keyIndex: i };
        continue;
      }
    } catch (e) {
      console.error("YouTube fetch error with key index", i, e);
      lastError = e;
      continue;
    }
  }

  console.error("YouTube API error (all keys failed):", lastError);
  songListEl.innerHTML =
    '<div class="empty">Search unavailable right now. Please try again later.</div>';
}

function renderSongs(items) {
  songListEl.innerHTML = "";
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

    const div = document.createElement("div");
    div.className = "song";
    div.innerHTML = `
      <div class="cover" style="background-image: url('${thumb}')"></div>
      <div class="meta">
        <div class="name">${title}</div>
        <div class="artist">${channel}</div>
      </div>
      <div class="controls">
        <button class="btn-circle small" style="font-size:16px"
          onclick="event.stopPropagation(); showAddPlaylistModal('${id}','${title.replace(
      /'/g,
      "\\'"
    )}','${channel.replace(/'/g, "\\'")}','${thumbHigh}')">＋</button>
      </div>
    `;

    div.addEventListener("click", () => {
      currentContext = "search";
      currentPlaylistName = null;
      playVideo(id, title, channel, thumbHigh);
    });

    songListEl.appendChild(div);
  });
}

/* ==========================================================================
   14. INIT
   ========================================================================== */
renderCategories();
setupQuotaUI();
updateQuotaUI();
