'use strict';

const { logWarn } = require('../lib/logger.js');
const {
  normalizeSearchQuery,
  tokenizeSearchQuery
} = require('./searchCacheService.js');

const MAX_KNOWN_SONGS = 100;
const PRELOAD_HISTORY_ROWS = 250;
const MIN_LOCAL_QUERY_TOKENS = 2;

const knownSongs = new Map();
let warmed = false;

function normalizeSong(song) {
  if (!song || !song.videoId || !song.title) {
    return null;
  }

  return {
    videoId: String(song.videoId),
    title: String(song.title),
    author: {
      name: String(
        song.author?.name ||
        'Canción conocida'
      )
    },
    thumbnail:
      song.thumbnail
        ? String(song.thumbnail)
        : null,
    duration:
      song.duration ||
      null
  };
}

function rememberKnownSong(song, weight = 1) {
  const normalized = normalizeSong(song);

  if (!normalized) {
    return;
  }

  const current =
    knownSongs.get(normalized.videoId);

  knownSongs.set(
    normalized.videoId,
    {
      ...normalized,
      score:
        (current?.score || 0) +
        Math.max(Number(weight) || 1, 1),
      touchedAt: Date.now()
    }
  );

  if (knownSongs.size > MAX_KNOWN_SONGS) {
    const sorted =
      [...knownSongs.entries()]
        .sort((a, b) =>
          (b[1].score - a[1].score) ||
          (b[1].touchedAt - a[1].touchedAt)
        );

    knownSongs.clear();

    for (
      const [videoId, entry]
      of sorted.slice(0, MAX_KNOWN_SONGS)
    ) {
      knownSongs.set(videoId, entry);
    }
  }
}

function scoreKnownSong(song, query) {
  const queryTokens =
    tokenizeSearchQuery(query);

  if (
    queryTokens.length <
    MIN_LOCAL_QUERY_TOKENS
  ) {
    return 0;
  }

  const titleTokens =
    new Set(
      tokenizeSearchQuery(song.title)
    );

  const matched =
    queryTokens.filter(
      (token) =>
        titleTokens.has(token)
    ).length;

  const coverage =
    matched /
    queryTokens.length;

  if (
    matched < 2 ||
    coverage < 0.75
  ) {
    return 0;
  }

  const normalizedTitle =
    normalizeSearchQuery(song.title);

  const normalizedQuery =
    normalizeSearchQuery(query);

  let score =
    coverage * 100;

  if (
    normalizedTitle.includes(
      normalizedQuery
    )
  ) {
    score += 40;
  }

  score += Math.min(
    Number(song.score) || 0,
    20
  );

  return score;
}

function searchKnownSongs(query, limit = 10) {
  return [...knownSongs.values()]
    .map((song) => ({
      song,
      score:
        scoreKnownSong(
          song,
          query
        )
    }))
    .filter(
      (entry) =>
        entry.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      Math.min(
        Math.max(
          Number(limit) || 10,
          1
        ),
        10
      )
    )
    .map(
      (entry) => ({
        videoId:
          entry.song.videoId,
        title:
          entry.song.title,
        author:
          entry.song.author,
        thumbnail:
          entry.song.thumbnail,
        duration:
          entry.song.duration
      })
    );
}

async function warmKnownSongs() {
  if (warmed) {
    return;
  }

  warmed = true;

  try {
    const { prisma } =
      require('../db.js');

    const rows =
      await prisma.songHistory.findMany({
        orderBy: {
          playedAt: 'desc'
        },
        take:
          PRELOAD_HISTORY_ROWS,
        select: {
          videoId: true,
          title: true,
          thumbnail: true
        }
      });

    const frequencies =
      new Map();

    for (const row of rows) {
      const count =
        (frequencies.get(
          row.videoId
        ) || 0) + 1;

      frequencies.set(
        row.videoId,
        count
      );

      rememberKnownSong(
        row,
        count
      );
    }
  } catch (error) {
    warmed = false;

    logWarn('No se pudo precargar el catalogo caliente de canciones', {
      event:
        'known_songs_warm_error',
      error:
        error?.message ||
        String(error)
    });
  }
}

function clearKnownSongsForTests() {
  knownSongs.clear();
  warmed = false;
}

module.exports = {
  warmKnownSongs,
  rememberKnownSong,
  searchKnownSongs,
  clearKnownSongsForTests,
  MAX_KNOWN_SONGS,
  PRELOAD_HISTORY_ROWS,
  MIN_LOCAL_QUERY_TOKENS
};
