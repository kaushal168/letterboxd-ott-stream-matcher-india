import { db } from "@/lib/db";
import { DEFAULT_REGION, TMDB_IMAGE_BASE_URL, CACHE_TTL_MS } from "@/lib/constants";
import { MovieItem } from "@/types";

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const TMDB_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  // TV specific genres
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
};

interface RawProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

interface RegionWatchProviders {
  flatrate?: RawProvider[];
  rent?: RawProvider[];
  buy?: RawProvider[];
}

/**
 * Consolidates fragmented TMDB provider identities in India (like Ads or Amazon Channels)
 * into their canonical master names for a cleaner UI filter bar.
 */
export function normalizeProviderName(name: string): string {
  const lower = name.toLowerCase().trim();

  if (lower.includes("prime video")) return "Amazon Prime Video";

  if (lower.includes("lionsgate")) return "Lionsgate Play";
  if (lower.includes("mubi")) return "MUBI";
  if (lower.includes("crunchyroll")) return "Crunchyroll";
  if (lower.includes("sony pictures") || lower.includes("sonypictures")) return "Sony LIV";
  if (lower.includes("apple tv")) return "Apple TV";
  
  if (lower.includes("hotstar") || lower.includes("jio")) return "JioHotstar";

  return name;
}

/**
 * Transforms raw TMDB provider object into a formatted list,
 * actively de-duplicating channels resolved by `normalizeProviderName`.
 */
function formatProviders(rawList?: RawProvider[]) {
  if (!rawList || !Array.isArray(rawList)) return [];
  
  const seen = new Set<string>();
  const normalized: Array<{ id: number; name: string; logoUrl: string }> = [];

  for (const p of rawList) {
    const canonicalName = normalizeProviderName(p.provider_name);
    if (!seen.has(canonicalName)) {
      seen.add(canonicalName);
      normalized.push({
        id: p.provider_id,
        name: canonicalName,
        logoUrl: p.logo_path ? `${TMDB_IMAGE_BASE_URL}${p.logo_path}` : "",
      });
    }
  }

  return normalized;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      
      if (response.status === 429) {
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      
      return response;
    } catch (error: any) {
      if (i === retries - 1) throw error;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1))); 
    }
  }
  throw new Error(`Fetch failed after retries: ${url}`);
}

/**
 * Searches TMDB for a movie or TV show.
 * Combines Movie and TV results BEFORE finding the best match to prevent 
 * loose movie matches from overriding exact TV matches.
 */
async function searchTmdb(title: string, targetYear?: number) {
  const findBestMatch = (results: any[], type?: 'movie' | 'tv') => {
    const valid = results.filter(r => (type ? r.media_type === type : (r.media_type === 'movie' || r.media_type === 'tv')));
    if (valid.length === 0) return null;

    const searchTitle = title.toLowerCase();

    if (!targetYear) {
      const exactTitle = valid.find(r => (r.title || r.name || '').toLowerCase() === searchTitle);
      return exactTitle || valid[0];
    }

    // 1. STRICT MATCH: Exact Title AND Exact/Close Year (+/- 1)
    const exactTitleMatch = valid.find(r => {
      const t = (r.title || r.name || '').toLowerCase();
      if (t !== searchTitle) return false;
      
      const yStr = r.media_type === 'tv' || r.first_air_date ? r.first_air_date : r.release_date;
      const y = yStr ? parseInt(yStr.split("-")[0], 10) : null;
      return y !== null && Math.abs(y - targetYear) <= 1;
    });
    if (exactTitleMatch) return exactTitleMatch;

    // 2. LOOSE MATCH: Exact Year (Title might be slightly different in TMDB)
    const exactYear = valid.find(r => {
      const yStr = r.media_type === 'tv' || r.first_air_date ? r.first_air_date : r.release_date;
      return yStr && parseInt(yStr.split("-")[0], 10) === targetYear;
    });
    if (exactYear) return exactYear;

    // 3. LOOSE MATCH: Close Year (+/- 1)
    const closeYear = valid.find(r => {
      const yStr = r.media_type === 'tv' || r.first_air_date ? r.first_air_date : r.release_date;
      return yStr && Math.abs(parseInt(yStr.split("-")[0], 10) - targetYear) <= 1;
    });
    if (closeYear) return closeYear;

    // 4. Fallback to the top popularity result
    return valid[0];
  };

  let bestMatch = null;

  if (targetYear) {
    let combinedResults: any[] = [];

    // Fetch movies
    const movieRes = await fetchWithRetry(`${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${targetYear}`);
    const movieData = await movieRes.json();
    if (movieData.results?.length > 0) {
      movieData.results.forEach((r: any) => r.media_type = 'movie');
      combinedResults = [...combinedResults, ...movieData.results];
    }

    // Fetch TV shows
    const tvRes = await fetchWithRetry(`${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&first_air_date_year=${targetYear}`);
    const tvData = await tvRes.json();
    if (tvData.results?.length > 0) {
      tvData.results.forEach((r: any) => r.media_type = 'tv');
      combinedResults = [...combinedResults, ...tvData.results];
    }

    // Sort by popularity so the best strict match wins
    combinedResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    if (combinedResults.length > 0) {
      bestMatch = findBestMatch(combinedResults);
    }
  }

  if (!bestMatch) {
    const multiRes = await fetchWithRetry(`${TMDB_BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`);
    const data = await multiRes.json();
    bestMatch = findBestMatch(data.results);
  }

  if (bestMatch) {
    const isTv = bestMatch.media_type === 'tv';
    const releaseYearStr = isTv ? bestMatch.first_air_date : bestMatch.release_date;
    const releaseYear = releaseYearStr ? parseInt(releaseYearStr.split("-")[0], 10) : targetYear;
    
    const mappedGenres = (bestMatch.genre_ids || [])
      .map((id: number) => TMDB_GENRES[id])
      .filter(Boolean);

    return {
      tmdbId: isTv ? -bestMatch.id : bestMatch.id,
      title: isTv ? bestMatch.name : bestMatch.title,
      year: releaseYear,
      rating: bestMatch.vote_average ?? 0,
      popularity: bestMatch.popularity ?? 0,
      posterUrl: bestMatch.poster_path ? `${TMDB_IMAGE_BASE_URL}${bestMatch.poster_path}` : null,
      language: bestMatch.original_language || null,
      genres: mappedGenres
    };
  }

  return null;
}

/**
 * Fetches watch provider data. 
 * Positive IDs query /movie, Negative IDs query /tv endpoints.
 */
async function fetchTmdbProviders(tmdbId: number, region: string = DEFAULT_REGION) {
  const mediaType = tmdbId < 0 ? 'tv' : 'movie';
  const actualId = Math.abs(tmdbId);
  
  const url = `${TMDB_BASE_URL}/${mediaType}/${actualId}/watch/providers?api_key=${TMDB_API_KEY}`;
  
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    return { flatrate: [], rent: [], buy: [] };
  }

  const data = await res.json();
  const regionData: RegionWatchProviders = data.results?.[region] || {};

  return {
    flatrate: formatProviders(regionData.flatrate),
    rent: formatProviders(regionData.rent),
    buy: formatProviders(regionData.buy),
  };
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

/**
 * Resolves a single movie: checks Turso cache first, fetches missing/stale data from TMDB,
 * and updates Turso.
 */
export async function getOrFetchMovie(
  title: string,
  year?: number,
  region: string = DEFAULT_REGION
): Promise<MovieItem | null> {
  const now = Date.now();

  let querySql = `
    SELECT 
      m.tmdb_id, m.title, m.year, m.poster_url, m.rating, m.popularity, m.language, m.genres,
      sp.providers_json, sp.updated_at
    FROM movies m
    LEFT JOIN streaming_providers sp 
      ON m.tmdb_id = sp.tmdb_id AND sp.region = ?
    WHERE LOWER(m.title) = LOWER(?)
  `;
  const queryArgs: (string | number)[] = [region, title];

  if (year) {
    querySql += ` AND (m.year = ? OR m.year = ? OR m.year = ?)`;
    queryArgs.push(year, year - 1, year + 1);
  }
  querySql += ` LIMIT 1`;

  const cached = await db.execute({ sql: querySql, args: queryArgs });

  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    const tmdbId = Number(row.tmdb_id);
    const movieTitle = String(row.title);
    const movieYear = row.year ? Number(row.year) : undefined;
    const posterUrl = row.poster_url ? String(row.poster_url) : null;
    const updatedAt = row.updated_at ? Number(row.updated_at) : 0;
    const rating = row.rating ? Number(row.rating) : 0;
    const popularity = row.popularity ? Number(row.popularity) : 0;
    
    // Safely parse new database columns
    const language = row.language ? String(row.language) : undefined;
    let genres: string[] = [];
    if (row.genres) {
      try { genres = JSON.parse(String(row.genres)); } catch (e) {}
    }

    const isFresh = now - updatedAt < CACHE_TTL_MS;

    if (row.providers_json && isFresh) {
      return {
        tmdbId,
        title: movieTitle,
        year: movieYear,
        posterUrl,
        rating,
        popularity,
        language,
        genres,
        providers: JSON.parse(String(row.providers_json)),
      };
    }

    const freshProviders = await fetchTmdbProviders(tmdbId, region);

    await db.execute({
      sql: `
        INSERT INTO streaming_providers (tmdb_id, region, providers_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tmdb_id, region) DO UPDATE SET
          providers_json = excluded.providers_json,
          updated_at = excluded.updated_at
      `,
      args: [tmdbId, region, JSON.stringify(freshProviders), now],
    });

    return {
      tmdbId,
      title: movieTitle,
      year: movieYear,
      posterUrl,
      rating,
      popularity,
      providers: freshProviders,
    };
  }

  const tmdbMovie = await searchTmdb(title, year);
  if (!tmdbMovie) return null;

  const providers = await fetchTmdbProviders(tmdbMovie.tmdbId, region);

  await db.batch([
    {
      sql: `
        INSERT INTO movies (tmdb_id, title, year, poster_url, rating, popularity, language, genres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmdb_id) DO UPDATE SET
          title = excluded.title,
          year = excluded.year,
          poster_url = excluded.poster_url,
          rating = excluded.rating,
          popularity = excluded.popularity,
          language = excluded.language,
          genres = excluded.genres
      `,
      args: [
        tmdbMovie.tmdbId, 
        tmdbMovie.title, 
        tmdbMovie.year ?? null, 
        tmdbMovie.posterUrl,
        tmdbMovie.rating ?? 0,
        tmdbMovie.popularity ?? 0,
        tmdbMovie.language || null,
        tmdbMovie.genres?.length ? JSON.stringify(tmdbMovie.genres) : null
      ],
    },
    {
      sql: `
        INSERT INTO streaming_providers (tmdb_id, region, providers_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tmdb_id, region) DO UPDATE SET
          providers_json = excluded.providers_json,
          updated_at = excluded.updated_at
      `,
      args: [tmdbMovie.tmdbId, region, JSON.stringify(providers), now],
    },
  ]);

  return {
    ...tmdbMovie,
    providers,
  };
}

/**
 * Resolves a batch of scraped movies using parallel chunking.
 * Processes 10 movies concurrently to drastically speed up TMDB fetches.
 */
export async function getOrFetchMovieBatch(
  movies: Array<{ title: string; year?: number }>,
  region: string = DEFAULT_REGION
): Promise<MovieItem[]> {
  const results: MovieItem[] = [];
  
  // CHUNK AT 10: Ensures safe TCP handshaking and protects against TMDB API bursts.
  const chunks = chunkArray(movies, 10);

  for (const chunk of chunks) {
    const chunkPromises = chunk.map(async (movie) => {
      try {
        return await getOrFetchMovie(movie.title, movie.year, region);
      } catch (error) {
        console.error(`Skipping ${movie.title} due to network error:`, error);
        return null;
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    
    for (const item of chunkResults) {
      if (item) results.push(item);
    }
  }

  return results;
}