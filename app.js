'use strict';

(() => {
  const API = {
    audius: 'https://api.audius.co/v1',
    musicbrainz: 'https://musicbrainz.org/ws/2',
    appName: 'AngelMusicMiniApp'
  };
  const STORAGE_KEY = 'angel.library.v1';
  const tg = window.Telegram?.WebApp;
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const state = {
    page: 'home', searchType: 'tracks', searchTimer: null, searchAbort: null,
    library: loadLibrary(), activePlaylistId: null, queue: [], queueIndex: -1,
    currentTrack: null, isSeeking: false, lastMusicBrainzRequest: 0
  };

  function loadLibrary() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.playlists) && Array.isArray(saved.favorites)) return saved;
    } catch (error) { console.warn('Не удалось прочитать библиотеку:', error); }
    return { playlists: [
      { id: 'default-favorites', name: 'Избранное', tracks: [], system: true, art: 'blue' },
      { id: 'road', name: 'В дороге', tracks: [], art: 'sunset' },
      { id: 'summer', name: 'Лето', tracks: [], art: 'palm' },
      { id: 'night', name: 'Ночной город', tracks: [], art: 'city' }
    ], favorites: [] };
  }
  function saveLibrary() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.library)); }
    catch (error) { toast('Не удалось сохранить данные. Возможно, память браузера заполнена.'); console.error(error); }
  }
  function toast(message) {
    const node = $('toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
    try { tg?.HapticFeedback?.notificationOccurred('success'); } catch (_) {}
  }
  function escapeHTML(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function duration(seconds=0) { if (!Number.isFinite(Number(seconds))) return '—'; const n = Math.max(0, Math.floor(Number(seconds))); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; }
  function artFor(track) { return track.artwork || track.cover || ''; }
  function placeholder(art='') { return art || ''; }
  function safeImage(url, fallback='') { return /^https:\/\//i.test(url || '') ? url : fallback; }
  function makeTrack(raw, source='audius') {
    const user = raw.user || {};
    return {
      id: `${source}:${raw.id || raw.mbid || raw.title}`,
      source, sourceId: String(raw.id || raw.mbid || ''),
      title: raw.title || raw.name || 'Без названия',
      artist: raw.artist || raw.artist_name || user.name || raw['artist-credit']?.[0]?.name || 'Неизвестный исполнитель',
      duration: Number(raw.duration || 0), artwork: safeImage(raw.artwork?.['480x480'] || raw.artwork?.['150x150'] || raw.cover_art || raw.cover || ''),
      streamable: raw.is_streamable === true || raw.isStreamable === true,
      downloadable: raw.is_downloadable === true && !raw.is_download_gated && Boolean(raw.license),
      license: raw.license || '', permalink: raw.permalink || '',
      album: raw.album || raw.album_name || '',
      raw
    };
  }
  function switchPage(page) {
    state.page = page;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const map = {home:'homeView',search:'searchView',playlists:'playlistsView',favorites:'favoritesView'};
    $(map[page]).classList.add('active');
    $('backBtn').style.display = page === 'home' ? 'none' : 'block';
    $('topSpacer').style.display = page === 'home' ? 'block' : 'none';
    if (page === 'playlists') renderPlaylists();
    if (page === 'favorites') renderFavorites();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function trackRow(track, options={}) {
    const index = options.index ?? '';
    const canPlay = track.source === 'audius' && track.streamable;
    const image = artFor(track);
    return `<div class="track-row" data-track-id="${escapeHTML(track.id)}">
      ${image ? `<img class="cover" src="${escapeHTML(image)}" alt="" loading="lazy">` : `<div class="cover cover-placeholder">♫</div>`}
      <div class="track-info"><div class="track-title">${escapeHTML(track.title)}</div><div class="track-artist">${escapeHTML(track.artist)}${track.album ? ' · '+escapeHTML(track.album) : ''}</div></div>
      <span class="duration">${duration(track.duration)}</span>
      ${canPlay ? `<button class="more" data-action="play" title="Воспроизвести">▶</button>` : `<button class="more" data-action="source" title="Открыть источник">↗</button>`}
      <button class="more" data-action="menu" aria-label="Ещё">···</button>
    </div>`;
  }
  function renderPlaylistList() {
    const list = $('playlistList');
    const playlists = state.library.playlists.filter(p => !p.system);
    list.innerHTML = playlists.length ? playlists.map(p => `<button class="playlist-row" data-playlist="${escapeHTML(p.id)}"><div class="cover cover-placeholder" style="background:${artGradient(p.art)}">${artSymbol(p.art)}</div><div><div class="playlist-name">${escapeHTML(p.name)}</div><div class="sub">${p.tracks.length} трек${plural(p.tracks.length)}</div></div><span class="row-arrow">›</span></button>`).join('') : `<div class="empty"><strong>Пока нет плейлистов</strong>Нажми «+», чтобы создать первую подборку</div>`;
  }
  function plural(n) { const x=n%10,y=n%100; return x===1&&y!==11?'':'ов'; }
  function artGradient(kind) { return ({sunset:'radial-gradient(circle at 70% 28%,#ffad8d,transparent 38%),linear-gradient(140deg,#35204b,#bd667e)',palm:'radial-gradient(circle at 60% 70%,#e58ab1,transparent 40%),linear-gradient(140deg,#15294d,#7e3f82)',city:'radial-gradient(circle at 50% 30%,#6276bd,transparent 35%),linear-gradient(140deg,#101b3d,#633f7e)',blue:'linear-gradient(140deg,#152d70,#7956a6)'}[kind] || 'linear-gradient(140deg,#20366b,#7956a6)'); }
  function artSymbol(kind) { return ({sunset:'◉',palm:'♧',city:'▥',blue:'♫'}[kind] || '♫'); }
  function renderPlaylists() {
    renderPlaylistList();
    if (state.activePlaylistId) openPlaylist(state.activePlaylistId, false);
    else $('playlistDetail').classList.add('hidden');
  }
  function openPlaylist(id, scroll=true) {
    const playlist = state.library.playlists.find(p => p.id === id && !p.system); if (!playlist) return;
    state.activePlaylistId = id;
    const detail = $('playlistDetail'); detail.classList.remove('hidden');
    detail.innerHTML = `<div class="detail-top"><button class="text-btn" data-action="close-detail">‹</button><button class="text-btn" data-action="delete-playlist" data-id="${escapeHTML(id)}">▤ Удалить</button></div>
      <div class="detail-cover cover-placeholder" style="display:grid;place-items:center;font-size:70px;background:${artGradient(playlist.art)}">${artSymbol(playlist.art)}</div>
      <div class="detail-title">${escapeHTML(playlist.name)}</div><div class="detail-meta">${playlist.tracks.length} треков</div>
      <div class="controls"><button class="pill-btn primary" data-action="play-playlist">▶ Плей</button><button class="pill-btn" data-action="shuffle-playlist">⤨ Перемешать</button></div>
      <div class="track-list">${playlist.tracks.length ? playlist.tracks.map((t,i)=>trackRow(t,{index:i})).join('').replaceAll('data-track-id=', `data-playlist-context="${escapeHTML(id)}" data-track-id=`) : `<div class="empty">В этом плейлисте пока нет треков.<br>Найди музыку и добавь её через меню «···».</div>`}</div>`;
    if (scroll && window.innerWidth < 700) detail.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function renderFavorites() {
    const tracks = state.library.favorites;
    $('favoriteCount').textContent = `${tracks.length} трек${plural(tracks.length)}`;
    $('favoriteMeta').textContent = `${tracks.length} трек${plural(tracks.length)}`;
    $('favoriteTracks').innerHTML = tracks.length ? tracks.map(t=>trackRow(t)).join('') : `<div class="empty"><strong>Здесь пока пусто</strong>Добавляй понравившиеся треки через меню «···»</div>`;
  }
  function openModal() { $('modalInput').value=''; $('modalBackdrop').classList.add('open'); $('modalInput').focus(); }
  function closeModal() { $('modalBackdrop').classList.remove('open'); }
  function createPlaylist() {
    const name = $('modalInput').value.trim(); if (!name) return toast('Введи название плейлиста');
    if (state.library.playlists.some(p=>p.name.toLowerCase()===name.toLowerCase())) return toast('Плейлист с таким названием уже есть');
    const p={id:`pl-${Date.now()}`,name,tracks:[],art:['sunset','palm','city','blue'][state.library.playlists.length%4]};
    state.library.playlists.push(p); saveLibrary(); closeModal(); renderPlaylists(); openPlaylist(p.id); toast('Плейлист создан');
  }
  function deletePlaylist(id) {
    const p=state.library.playlists.find(x=>x.id===id); if (!p || p.system) return;
    if (!confirm(`Удалить плейлист «${p.name}»? Треки из каталога и избранного не удалятся.`)) return;
    state.library.playlists=state.library.playlists.filter(x=>x.id!==id); state.activePlaylistId=null; saveLibrary(); renderPlaylists(); toast('Плейлист удалён');
  }
  function findTrack(id) {
    const pools=[state.library.favorites,...state.library.playlists.map(p=>p.tracks),state.queue];
    for (const pool of pools) { const t=pool.find(x=>x.id===id); if(t)return t; }
    return state.searchResults?.find(x=>x.id===id) || null;
  }
  function addToFavorites(track) {
    if (state.library.favorites.some(t=>t.id===track.id)) { state.library.favorites=state.library.favorites.filter(t=>t.id!==track.id); toast('Удалено из любимого'); }
    else { state.library.favorites.unshift(track); toast('Добавлено в любимое'); }
    saveLibrary(); if(state.page==='favorites')renderFavorites();
  }
  function addToPlaylist(track,id) {
    const p=state.library.playlists.find(x=>x.id===id && !x.system); if(!p)return;
    if(p.tracks.some(t=>t.id===track.id)) return toast('Этот трек уже есть в плейлисте');
    p.tracks.push(track); saveLibrary(); renderPlaylists(); toast(`Добавлено в «${p.name}»`);
  }
  function showTrackMenu(track, playlistId=null) {
    const favorite = state.library.favorites.some(t=>t.id===track.id);
    const options = state.library.playlists.filter(p=>!p.system);
    const actions = [`1 — ${favorite?'Убрать из любимого':'Добавить в любимое'}`, ...options.map((p,i)=>`${i+2} — Добавить в «${p.name}»`)];
    let next = options.length + 2;
    const removeNumber = playlistId ? next++ : null;
    const downloadNumber = track.downloadable ? next++ : null;
    const openNumber = next;
    if (playlistId) actions.push(`${removeNumber} — Удалить из этого плейлиста`);
    if (track.downloadable) actions.push(`${downloadNumber} — Скачать (лицензия: ${track.license})`);
    actions.push(`${openNumber} — Открыть источник`);
    const choice = prompt(`Действия с «${track.title}»:\n${actions.join('\n')}\n\nВведи номер действия:`);
    if(choice===null)return; const n=Number(choice);
    if(n===1)addToFavorites(track);
    else if(n>=2&&n<options.length+2)addToPlaylist(track,options[n-2].id);
    else if(removeNumber!==null&&n===removeNumber){const p=state.library.playlists.find(x=>x.id===playlistId);if(p){p.tracks=p.tracks.filter(t=>t.id!==track.id);saveLibrary();renderPlaylists();toast('Трек удалён из плейлиста');}}
    else if(downloadNumber!==null&&n===downloadNumber)downloadTrack(track);
    else if(n===openNumber)openExternal(track);
    else toast('Неизвестное действие');
  }
  async function audiusSearch(query) {
    const url = new URL(`${API.audius}/tracks/search`); url.searchParams.set('query',query); url.searchParams.set('limit','25');
    const response=await fetch(url,{headers:{Accept:'application/json'}}); if(!response.ok)throw new Error(`Audius: HTTP ${response.status}`);
    const json=await response.json(); return (json.data||[]).filter(t=>!t.is_unlisted && !t.is_delete).map(t=>makeTrack(t,'audius'));
  }
  async function musicBrainzSearch(type,query,signal) {
    const wait = Math.max(0, 1100 - (Date.now() - state.lastMusicBrainzRequest));
    if (wait) await new Promise((resolve,reject)=>{ const timer=setTimeout(resolve,wait); signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true}); });
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    state.lastMusicBrainzRequest = Date.now();
    const entity = type==='albums'?'release-group':type==='artists'?'artist':'recording';
    const url=new URL(`${API.musicbrainz}/${entity}`); url.searchParams.set('query',query); url.searchParams.set('fmt','json'); url.searchParams.set('limit','15');
    const response=await fetch(url,{signal,headers:{Accept:'application/json'}}); if(!response.ok)throw new Error(`MusicBrainz: HTTP ${response.status}`);
    const json=await response.json();
    if(type==='artists')return (json.artists||[]).map(a=>({id:`mb-artist:${a.id}`,source:'musicbrainz',sourceId:a.id,title:a.name,artist:`${a.type||'Исполнитель'}${a.country?' · '+a.country:''}`,duration:0,artwork:'',streamable:false,permalink:`https://musicbrainz.org/artist/${a.id}`,raw:a}));
    if(type==='albums')return (json['release-groups']||[]).map(a=>({id:`mb-album:${a.id}`,source:'musicbrainz',sourceId:a.id,title:a.title,artist:(a['artist-credit']||[]).map(x=>x.name||x.artist?.name).join(', ')||'Неизвестный исполнитель',duration:0,artwork:'',streamable:false,permalink:`https://musicbrainz.org/release-group/${a.id}`,raw:a}));
    return (json.recordings||[]).map(a=>({id:`mb-recording:${a.id}`,source:'musicbrainz',sourceId:a.id,title:a.title,artist:(a['artist-credit']||[]).map(x=>x.name||x.artist?.name).join(', ')||'Неизвестный исполнитель',duration:a.length?Math.round(a.length/1000):0,artwork:'',streamable:false,permalink:`https://musicbrainz.org/recording/${a.id}`,raw:a}));
  }
  function renderSearchResults(items) {
    state.searchResults=items;
    $('searchResults').innerHTML=items.length?items.map(t=>trackRow(t)).join(''):`<div class="empty"><strong>Ничего не найдено</strong>Попробуй изменить запрос</div>`;
  }
  async function runSearch(query) {
    const q=query.trim(); if(!q){$('searchStatus').textContent='Введи название трека или исполнителя';$('searchResults').innerHTML='';return;}
    if(state.searchAbort)state.searchAbort.abort(); state.searchAbort=new AbortController();
    $('searchStatus').textContent='Ищем…'; $('searchResults').innerHTML='';
    try {
      let results;
      if(state.searchType==='tracks') {
        // Merge broad metadata search with playable Audius uploads; MusicBrainz rows are explicitly metadata-only.
        const [playable, catalog] = await Promise.all([audiusSearch(q), musicBrainzSearch('tracks',q,state.searchAbort.signal)]);
        const playableKeys = new Set(playable.map(t=>`${t.title.toLowerCase()}|${t.artist.toLowerCase()}`));
        results = [...playable, ...catalog.filter(t=>!playableKeys.has(`${t.title.toLowerCase()}|${t.artist.toLowerCase()}`))];
      } else results=await musicBrainzSearch(state.searchType,q,state.searchAbort.signal);
      $('searchStatus').textContent=results.length?`Найдено: ${results.length}. ${state.searchType==='tracks'?'Audius-версии можно слушать при наличии потока; остальные результаты — карточки каталога.':'Каталог и метаданные; прослушивание зависит от наличия версии в Audius.'}`:'По этому запросу ничего не найдено';
      renderSearchResults(results);
    } catch(error) {
      if(error.name==='AbortError')return;
      console.error(error); $('searchStatus').textContent='Не удалось выполнить поиск. Проверь подключение и попробуй ещё раз.';
      $('searchResults').innerHTML=`<div class="empty"><strong>Ошибка поиска</strong>${escapeHTML(error.message)}</div>`;
    }
  }
  function searchFromHome(value) { switchPage('search'); $('searchInput').value=value; runSearch(value); requestAnimationFrame(()=>$('searchInput').focus()); }
  async function playTrack(track, queue=null, index=0) {
    if(track.source!=='audius'||!track.streamable){toast('У этого результата нет доступного потока в Angel');return;}
    if(queue){state.queue=queue.slice();state.queueIndex=index;} else {state.queue=[track];state.queueIndex=0;}
    state.currentTrack=track;
    const streamUrl=`${API.audius}/tracks/${encodeURIComponent(track.sourceId)}/stream?app_name=${encodeURIComponent(API.appName)}`;
    audio.pause(); audio.src=streamUrl; audio.load();
    $('player').classList.add('visible'); $('playerTitle').textContent=track.title; $('playerArtist').textContent=track.artist;
    $('playerCover').src=artFor(track)||''; $('playerCover').style.visibility=artFor(track)?'visible':'hidden';
    updateMediaSession(track);
    try { await audio.play(); $('togglePlay').textContent='Ⅱ'; }
    catch(error) { console.error(error); toast('Не удалось запустить поток. Открой трек на Audius или попробуй другой.'); }
    try { tg?.HapticFeedback?.impactOccurred('light'); } catch (_) {}
  }
  function updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title, artist: track.artist, album: track.album || 'Angel',
        artwork: artFor(track) ? [{src: artFor(track), sizes: '480x480', type: 'image/jpeg'}] : []
      });
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => nextTrack(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(1));
    } catch (error) { console.warn('Media Session API:', error); }
  }
  function playCollection(tracks,shuffle=false) {
    const playable=tracks.filter(t=>t.source==='audius'&&t.streamable); if(!playable.length)return toast('В подборке пока нет доступных для воспроизведения треков');
    const queue=playable.slice(); if(shuffle)for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}
    playTrack(queue[0],queue,0);
  }
  function nextTrack(direction=1) {
    if(!state.queue.length)return; let next=state.queueIndex+direction;
    if(next<0)next=state.queue.length-1; if(next>=state.queue.length)next=0;
    playTrack(state.queue[next],state.queue,next);
  }
  function openExternal(track) {
    const url=track.permalink || (track.source==='audius'?`https://audius.co/search/${encodeURIComponent(track.title)}`:`https://musicbrainz.org/${track.sourceId}`);
    window.open(url,'_blank','noopener,noreferrer');
  }
  function downloadTrack(track) {
    if(!track.downloadable){toast('Скачивание не разрешено для этого трека или лицензия не указана');return;}
    const url=`${API.audius}/tracks/${encodeURIComponent(track.sourceId)}/download?app_name=${encodeURIComponent(API.appName)}`;
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.download='';document.body.appendChild(a);a.click();a.remove();
  }

  // UI events
  $('openPlaylists').addEventListener('click',()=>switchPage('playlists'));
  $('openFavorites').addEventListener('click',()=>switchPage('favorites'));
  $('backBtn').addEventListener('click',()=>switchPage('home'));
  $('globalSearch').addEventListener('focus',e=>searchFromHome(e.target.value));
  $('globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchFromHome(e.target.value)});
  $('searchInput').addEventListener('input',e=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>runSearch(e.target.value),450)});
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));tab.classList.add('active');state.searchType=tab.dataset.type;runSearch($('searchInput').value);
  }));
  $('createPlaylist').addEventListener('click',openModal);$('cancelModal').addEventListener('click',closeModal);$('confirmModal').addEventListener('click',createPlaylist);
  $('modalInput').addEventListener('keydown',e=>{if(e.key==='Enter')createPlaylist();if(e.key==='Escape')closeModal()});
  $('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop'))closeModal()});
  $('playFavorites').addEventListener('click',()=>playCollection(state.library.favorites));
  $('shuffleFavorites').addEventListener('click',()=>playCollection(state.library.favorites,true));
  $('togglePlay').addEventListener('click',async()=>{if(!audio.src)return;if(audio.paused){try{await audio.play()}catch(e){toast('Не удалось продолжить воспроизведение')} }else audio.pause()});
  $('prevTrack').addEventListener('click',()=>nextTrack(-1));$('nextTrack').addEventListener('click',()=>nextTrack(1));
  audio.addEventListener('play',()=>{$('togglePlay').textContent='Ⅱ';if('mediaSession' in navigator)navigator.mediaSession.playbackState='playing';});audio.addEventListener('pause',()=>{$('togglePlay').textContent='▶';if('mediaSession' in navigator)navigator.mediaSession.playbackState='paused';});
  audio.addEventListener('ended',()=>nextTrack(1));audio.addEventListener('timeupdate',()=>{if(audio.duration)$('progressFill').style.width=`${audio.currentTime/audio.duration*100}%`});
  audio.addEventListener('error',()=>{if(state.currentTrack)toast('Источник не смог отдать аудио. Попробуй другой трек.');});
  document.addEventListener('click',e=>{
    const playlist=e.target.closest('[data-playlist]');if(playlist){openPlaylist(playlist.dataset.playlist);return;}
    const row=e.target.closest('.track-row');
    if(row){const track=findTrack(row.dataset.trackId)||state.searchResults?.find(t=>t.id===row.dataset.trackId);if(!track)return;
      const action=e.target.closest('[data-action]')?.dataset.action;
      if(action==='play'){playTrack(track);return;} if(action==='source'){openExternal(track);return;} if(action==='menu'){showTrackMenu(track,row.dataset.playlistContext||null);return;}
      if(track.source==='audius'&&track.streamable)playTrack(track);else openExternal(track);return;
    }
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    if(action==='close-detail'){state.activePlaylistId=null;$('playlistDetail').classList.add('hidden');return;}
    if(action==='delete-playlist'){deletePlaylist(e.target.closest('[data-id]').dataset.id);return;}
    if(action==='play-playlist'||action==='shuffle-playlist'){
      const p=state.library.playlists.find(x=>x.id===state.activePlaylistId);if(p)playCollection(p.tracks,action==='shuffle-playlist');return;
    }
  });

  // Telegram Mini App integration: UI expansion only. No unverified initDataUnsafe authentication.
  try { if(tg){tg.ready();tg.expand();tg.setHeaderColor?.('#080b16');tg.setBackgroundColor?.('#080b16');} } catch(error){console.warn('Telegram WebApp SDK:',error);}
  saveLibrary();
})();
