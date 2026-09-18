// Canonical YouTube URL handling for the Contextual Help video library.
//
// WHY THIS IS THE ONLY PARSER
//   A help video is stored as whatever link the Super Admin pasted — the same
//   video reaches us as youtube.com/watch?v=, youtu.be/, /shorts/ or /embed/.
//   Every consumer (the drawer's player, the "Watch on YouTube" link, the admin
//   thumbnail) needs the SAME id out of those four shapes, so the extraction
//   lives here and the API hands the derived URLs to the client already built.
//   The React side never parses a link and never holds a YouTube URL template.
//
// A video id is exactly 11 chars of the URL-safe base64 alphabet. Anything else
// is rejected rather than guessed at — a half-parsed id renders as a dead
// player, which is worse than an honest "add a valid YouTube link" error.

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Path prefixes that carry the id as the NEXT segment: /shorts/<id>, /embed/<id>,
// /live/<id>, /v/<id>, /e/<id>.
const ID_BEARING_PREFIXES = ['shorts', 'embed', 'live', 'v', 'e'];

// Host check is exact-or-subdomain. `endsWith('.youtube.com')` needs the leading
// dot, so a look-alike like "evil-youtube.com" or "youtube.com.attacker.net"
// does not match.
const isYouTubeHost = (host) =>
    host === 'youtube.com' ||
    host === 'youtu.be' ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube.com') ||
    host.endsWith('.youtube-nocookie.com');

/**
 * Extract the 11-character video id from any common YouTube link shape.
 * Returns null for anything that is not a YouTube video URL.
 */
const parseYouTubeId = (raw) => {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;

    // A bare id pasted on its own is accepted — admins copy these out of
    // Studio all the time.
    if (VIDEO_ID_RE.test(value)) return value;

    let url;
    try {
        // Links are routinely pasted without a scheme ("youtu.be/abc"). Adding
        // https here only affects parsing; nothing is ever fetched.
        url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!isYouTubeHost(host)) return null;

    const segments = url.pathname.split('/').filter(Boolean);

    // youtu.be/<id> — the id is the whole path.
    if (host === 'youtu.be') {
        return VIDEO_ID_RE.test(segments[0] || '') ? segments[0] : null;
    }

    // youtube.com/watch?v=<id> (also /watch_popup, and the ?v= form some
    // playlists use).
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    // youtube.com/shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
    if (segments.length >= 2 && ID_BEARING_PREFIXES.includes(segments[0].toLowerCase())) {
        return VIDEO_ID_RE.test(segments[1]) ? segments[1] : null;
    }

    return null;
};

// Privacy-enhanced host: nothing is written to the viewer's YouTube cookie
// until they actually press play. `rel=0` keeps the end-screen suggestions
// inside the same channel. Autoplay is deliberately absent — the drawer must
// never start a video on its own.
const buildEmbedUrl = (videoId) =>
    `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;

const buildWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

// i.ytimg.com serves thumbnails without loading the player, so the drawer shows
// a poster frame with zero third-party JS until the user clicks.
const buildThumbnailUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/**
 * Everything a client needs for one video, derived from the stored link.
 * Returns null when the link is not a usable YouTube video.
 */
const describeYouTubeUrl = (raw) => {
    const videoId = parseYouTubeId(raw);
    if (!videoId) return null;
    return {
        videoId,
        embedUrl: buildEmbedUrl(videoId),
        watchUrl: buildWatchUrl(videoId),
        thumbnailUrl: buildThumbnailUrl(videoId)
    };
};

module.exports = {
    VIDEO_ID_RE,
    parseYouTubeId,
    buildEmbedUrl,
    buildWatchUrl,
    buildThumbnailUrl,
    describeYouTubeUrl
};
