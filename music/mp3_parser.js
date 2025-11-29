// FINAL CLEAN + METADATA + OLD FORMAT SAFE PARSER
// --------------------------------------------------

const fs = require("fs").promises;
const path = require("path");
const mm = require("music-metadata");

// Input / Output
const INPUT_DIR = "./";
const OUTPUT_FILE = "songs_db_output.js";

// UI Colors
const COLORS = [
    "#ef4444", "#f97316", "#06b6d4",
    "#7c3aed", "#22c55e", "#60a5fa", "#fb7185"
];
const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// ----- CLEAN SHORT TITLE (UI ONLY) -----
function extractShortTitle(name) {
    return name
        .replace(/Official|Full Video|Full Song|VIDEO|AUDIO|HD|HQ/gi, "")
        .replace(/\(.*?\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/[_\-|¦]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// ----- OLD FORMAT NAME PRESERVED -----
function originalBase(name) {
    return name;
}

// ----- Smart split for fallback -----
function smartSplit(name) {
    const seps = [" - ", " – ", " — ", "¦", "|", ":", ";"];
    for (const s of seps) {
        if (name.includes(s)) {
            return name.split(s);
        }
    }
    return [name];
}

// ----- Fallback Artist/Title detection -----
function fallbackArtistTitle(baseName) {
    const parts = smartSplit(baseName).map(p => p.trim()).filter(Boolean);

    if (parts.length === 1) {
        return { artist: "Unknown Artist", title: parts[0] };
    }

    // Simple safest fallback: part1 = title, part2 = artist
    return {
        title: parts[0],
        artist: parts[1] || "Unknown Artist"
    };
}

// ----- SRC FORMAT (old working system) -----
function oldFormatSrc(file) {
    return "music/" + encodeURIComponent(file);
}

// --------------------------------------------------

async function run() {
    const files = await fs.readdir(INPUT_DIR);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith(".mp3"));

    let id = 1;
    const songs = [];

    for (const file of mp3Files) {
        const base = path.basename(file, ".mp3");

        let metadataArtist = null;
        let metadataTitle = null;

        // Try reading metadata
        try {
            const metadata = await mm.parseFile(path.join(INPUT_DIR, file));
            metadataArtist = metadata.common.artist || null;
            metadataTitle = metadata.common.title || null;
        } catch (e) {
            metadataArtist = null;
            metadataTitle = null;
        }

        // Fallback system
        const fallback = fallbackArtistTitle(base);

        const finalArtist = metadataArtist || fallback.artist || "Unknown Artist";
        const finalTitle = metadataTitle || fallback.title || base;

        // Build entry
        songs.push({
            id: id.toString(),

            // UI Title (short clean)
            name: extractShortTitle(finalTitle),

            // Real Artist
            artist: finalArtist,

            // Old format correct src (unchanged)
            src: oldFormatSrc(file),

            // Color
            color: pickColor(),

            // OPTIONAL: store original name for debugging if needed
            _original: originalBase(base)
        });

        id++;
    }

    // Write output file
    const output = 
`/* AUTO GENERATED songsDB */
const songsDB = ${JSON.stringify(songs, null, 4)};
`;

    await fs.writeFile(OUTPUT_FILE, output, "utf8");
    console.log("✔ DONE — songs_db_output.js READY!");
}

run();
