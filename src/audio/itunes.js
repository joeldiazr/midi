// Búsqueda en el catálogo de Apple (iTunes Search API): pública, sin llave, con vistas previas de 30 s.
function storeCountry() {
  const lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';
  const m = lang.match(/-([A-Za-z]{2})$/);
  return (m ? m[1] : 'US').toLowerCase();
}

let ctrl = null;
export async function searchSongs(term) {
  if (ctrl) ctrl.abort();
  ctrl = new AbortController();
  const q = term.trim();
  if (!q) return [];
  const run = async (country) => {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=14&country=${country}`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return (j.results || []).filter((x) => x.previewUrl).map((x) => ({
      id: x.trackId,
      title: x.trackName,
      artist: x.artistName,
      album: x.collectionName,
      year: x.releaseDate ? x.releaseDate.slice(0, 4) : '',
      art: x.artworkUrl100 ? x.artworkUrl100.replace('100x100bb', '600x600bb') : '',
      thumb: x.artworkUrl100 || '',
      preview: x.previewUrl,
      url: x.trackViewUrl,
      genre: x.primaryGenreName,
    }));
  };
  const cc = storeCountry();
  let res = await run(cc);
  if (!res.length && cc !== 'us') res = await run('us');
  return res;
}
