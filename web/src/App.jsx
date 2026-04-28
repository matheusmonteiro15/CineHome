import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import * as Icons from 'lucide-react';

const API_BASE = `http://${window.location.hostname}:3001`;

export default function App() {
  const [media, setMedia] = useState([]);
  const [stats, setStats] = useState({ total: 0, movies: 0, series: 0, favorites: 0, watched_total: 0 });
  const [filter, setFilter] = useState('all'); // 'all', 'movie', 'series', 'favorite'
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid', 'list', 'compact'
  const [selectedMedia, setSelectedMedia] = useState(null); // Para ver episódios de uma série
  const [episodes, setEpisodes] = useState([]);
  const [hlsError, setHlsError] = useState(null);
  
  const [playingUrl, setPlayingUrl] = useState(null);
  const [playingName, setPlayingName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  // Estados de reprodução e seek
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [lastSeek, setLastSeek] = useState(0); // Onde o stream atual começou
  const [isDragging, setIsDragging] = useState(false);

  // ── Fetch Media & Stats ──
  const fetchData = useCallback(async () => {
    try {
      const isFav = filter === 'favorite';
      const type = (filter === 'movie' || filter === 'series') ? filter : 'all';
      
      const [mediaRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/media?type=${type}&favorite=${isFav}&search=${search}`),
        fetch(`${API_BASE}/api/stats`)
      ]);
      
      setMedia(await mediaRes.json());
      setStats(await statsRes.json());
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    }
  }, [filter, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Fetch Episodes when a series is selected ──
  useEffect(() => {
    if (selectedMedia && selectedMedia.type === 'series') {
      fetch(`${API_BASE}/api/media/${selectedMedia.id}/episodes`)
        .then(res => res.json())
        .then(setEpisodes);
    }
  }, [selectedMedia]);

  // ── HLS Player ──
  useEffect(() => {
    if (!playingUrl || !videoRef.current) return;
    const video = videoRef.current;
    
    const handleTimeUpdate = () => {
      if (!isDragging) {
        // O tempo real é o tempo do vídeo + o offset do seek inicial
        setCurrentTime(video.currentTime + lastSeek);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);

    if (playingUrl.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          manifestLoadingMaxRetry: 5,
          levelLoadingMaxRetry: 5,
        });
        hlsRef.current = hls;
        hls.loadSource(`${API_BASE}${playingUrl}`);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setHlsError(null);
          video.play();
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('HLS Fatal Error:', data.type);
            setHlsError(`Erro de conexão: ${data.type}`);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                break;
            }
          }
        });

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = `${API_BASE}${playingUrl}`;
        video.addEventListener('loadedmetadata', () => video.play());
      }
    } else {
      // Direct MP4
      video.src = `${API_BASE}${playingUrl}`;
      video.play();
    }

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playingUrl, lastSeek, isDragging]);

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e) => {
    const percent = e.target.value / 100;
    const newTime = percent * totalDuration;
    setCurrentTime(newTime);
  };

  const handleSeekCommit = (e) => {
    const percent = e.target.value / 100;
    const newTime = percent * totalDuration;
    playMedia(playingFile, playingName, newTime);
  };

  // ── Player Modal ──
  const renderPlayer = () => {
    if (!playingUrl) return null;
    return (
      <div className="player-modal">
        <div className="player-wrapper">
          <video 
            ref={videoRef} 
            crossOrigin="anonymous" 
            onClick={(e) => {
              if (videoRef.current.paused) videoRef.current.play();
              else videoRef.current.pause();
            }}
          />
          
          <div className="player-header-overlay">
            <button className="btn-close-player" onClick={() => { setPlayingUrl(null); setCurrentTime(0); setTotalDuration(0); setHlsError(null); }}>
               <Icons.ArrowLeft size={20} /> Sair
            </button>
            <span className="playing-title">{playingName}</span>
          </div>

          {hlsError && (
            <div className="player-error">
               <Icons.AlertTriangle size={32} color="var(--accent)" />
               <p>{hlsError}</p>
               <button onClick={() => playMedia(playingFile, playingName, currentTime)}>Tentar novamente</button>
            </div>
          )}

          <div className="custom-controls">
            <div className="duration-row">
              <span>{formatTime(currentTime)}</span>
              <input 
                type="range" 
                className="seek-bar"
                min="0" 
                max="100" 
                value={(currentTime / totalDuration) * 100 || 0}
                onMouseDown={() => setIsDragging(true)}
                onChange={handleSeek}
                onMouseUp={(e) => { setIsDragging(false); handleSeekCommit(e); }}
              />
              <span>{formatTime(totalDuration)}</span>
            </div>
            
            <div className="control-buttons">
              <button 
                className="btn-control" 
                onClick={() => {
                  if (videoRef.current.paused) videoRef.current.play();
                  else videoRef.current.pause();
                }}
              >
                {videoRef.current?.paused ? <Icons.Play fill="white" /> : <Icons.Pause fill="white" />}
              </button>
              
              <button className="btn-control" onClick={() => {
                const newTime = Math.max(0, currentTime - 10);
                playMedia(playingFile, playingName, newTime);
              }}>
                <Icons.RotateCcw size={20} />
              </button>

              <button className="btn-control" onClick={() => {
                const newTime = Math.min(totalDuration, currentTime + 10);
                playMedia(playingFile, playingName, newTime);
              }}>
                <Icons.RotateCw size={20} />
              </button>

              <div className="volume-control">
                <Icons.Volume2 size={20} />
                <input 
                  type="range" 
                  min="0" max="1" step="0.1" 
                  defaultValue="1"
                  onChange={(e) => videoRef.current.volume = e.target.value}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const [playingFile, setPlayingFile] = useState(null);

  const playMedia = async (fileObj, title, seek = 0) => {
    setLoading(true);
    setPlayingFile(fileObj);
    try {
      const res = await fetch(`${API_BASE}/api/stream?source=${fileObj.source_index}&path=${encodeURIComponent(fileObj.path)}&seek=${seek}`);
      const data = await res.json();
      
      setTotalDuration(data.duration || 0);
      setLastSeek(data.seek || 0);

      // Se for stream direto (MP4), setamos a URL bruta. 
      if (data.isDirect) {
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
        if (videoRef.current) {
          videoRef.current.src = `${API_BASE}${data.url}`;
          videoRef.current.play();
        }
      }
      setPlayingUrl(data.url);
      setPlayingName(title);
    } catch (err) {
      setError("Erro ao carregar vídeo.");
    } finally {
      setLoading(false);
    }
  };

  const handleRescan = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/rescan`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (e, id, currentFav) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/media/${id}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !currentFav })
    });
    fetchData();
  };

  const handleMediaClick = (m) => {
    if (m.type === 'series') {
      setSelectedMedia(m);
    } else {
      // É filme, busca o arquivo dele
      fetch(`${API_BASE}/api/media/${m.id}/episodes`)
        .then(res => res.json())
        .then(files => {
          if (files.length > 0) playMedia(files[0], m.title);
        });
    }
  };

  return (
    <div className="app-container">
      {renderPlayer()}
      <div className="bg-glow red" />
      <div className="bg-glow blue" />

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon"><Icons.Play fill="white" size={18} /></div>
          <h1 className="logo-text">CINE<span>HOME</span></h1>
        </div>

        <nav className="nav-menu">
           <div className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => { setFilter('all'); setSelectedMedia(null); }}>
            <div className="nav-link"><Icons.LayoutGrid size={18} /> Tudo</div>
            <span className="nav-counter">{stats.total}</span>
          </div>
          <div className={`nav-item ${filter === 'movie' ? 'active' : ''}`} onClick={() => { setFilter('movie'); setSelectedMedia(null); }}>
            <div className="nav-link"><Icons.Film size={18} /> Filmes</div>
            <span className="nav-counter">{stats.movies}</span>
          </div>
          <div className={`nav-item ${filter === 'series' ? 'active' : ''}`} onClick={() => { setFilter('series'); setSelectedMedia(null); }}>
            <div className="nav-link"><Icons.Tv size={18} /> Séries</div>
            <span className="nav-counter">{stats.series}</span>
          </div>
          <div className={`nav-item ${filter === 'favorite' ? 'active' : ''}`} onClick={() => { setFilter('favorite'); setSelectedMedia(null); }}>
            <div className="nav-link"><Icons.Star size={18} /> Favoritos</div>
            <span className="nav-counter">{stats.favorites}</span>
          </div>
        </nav>

        <div className="stats-section">
          <div className="stat-row"><span>Vistos:</span> <b>{stats.watched_total}</b></div>
          <div className="stat-row"><span>Disponíveis:</span> <b>{stats.total}</b></div>
          
          <button className="nav-item" style={{width: '100%', border: 'none', background: 'transparent', marginTop: '16px'}} onClick={handleRescan}>
            <div className="nav-link"><Icons.RefreshCw size={18} /> Escanear Mídia</div>
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">
        
        {selectedMedia ? (
          <div className="detail-view">
            <button className="btn-back" onClick={() => setSelectedMedia(null)}>
              <Icons.ArrowLeft size={18} /> Voltar para o catálogo
            </button>
            
            <div className="detail-header">
              <div className="poster-container" style={{position: 'relative'}}>
                <img src={selectedMedia.poster_path || 'https://via.placeholder.com/300x450?text=Sem+Poster'} className="detail-poster" />
                <button 
                  className="btn-edit-poster" 
                  onClick={async () => {
                    const newUrl = window.prompt("Cole o link (URL) da imagem do poster (Proporção 2:3 ideal):", selectedMedia.poster_path || "");
                    if (newUrl !== null) {
                      await fetch(`${API_BASE}/api/media/${selectedMedia.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ poster_path: newUrl })
                      });
                      setSelectedMedia({...selectedMedia, poster_path: newUrl});
                      fetchData();
                    }
                  }}
                  style={{
                    position: 'absolute', bottom: '10px', right: '10px', 
                    background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white',
                    padding: '8px', borderRadius: '50%', cursor: 'pointer'
                  }}
                >
                  <Icons.Edit2 size={16} />
                </button>
              </div>
              <div className="detail-info">
                <h2>{selectedMedia.title}</h2>
                <div className="star-rating" style={{marginBottom: '10px'}}>
                  <Icons.Star size={18} fill="currentColor" /> {selectedMedia.rating?.toFixed(1) || '0.0'}
                </div>
                <p className="detail-synopsis">{selectedMedia.overview}</p>
              </div>
            </div>

            <h3 style={{marginBottom: '20px'}}>Episódios ({episodes.length})</h3>
            <div className="episode-list">
              {episodes.map(ep => (
                <div key={ep.id} className="episode-item" onClick={() => playMedia(ep, `${selectedMedia.title} - S${ep.season}E${ep.episode}`)}>
                  <div className="episode-num">S{ep.season} E{ep.episode}</div>
                  <div className="episode-title">Episódio {ep.episode}</div>
                  {ep.watched === 1 && <Icons.CheckCircle size={18} color="#10b981" />}
                  <Icons.PlayCircle size={24} style={{marginLeft: 'auto'}} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="top-header">
              <div className="search-bar">
                <Icons.Search className="search-icon" size={18} />
                <input 
                  type="text" 
                  placeholder="Pesquisar em sua biblioteca..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="filter-controls">
                <div className="view-toggle">
                  <div className={`toggle-btn ${viewMode === 'compact' ? 'active' : ''}`} onClick={() => setViewMode('compact')}><Icons.LayoutGrid size={16} /></div>
                  <div className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}><Icons.Grid size={16} /></div>
                  <div className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}><Icons.List size={16} /></div>
                </div>
              </div>
            </div>

            <div className={`media-grid ${viewMode}`}>
              {media.map(m => (
                <div key={m.id} className="media-card" onClick={() => handleMediaClick(m)}>
                  <div className="poster-wrapper">
                    {m.poster_path ? (
                      <img src={m.poster_path} className="poster-img" loading="lazy" />
                    ) : (
                      <div className="poster-placeholder">
                        <Icons.Film size={40} />
                        <span style={{fontSize: '10px', marginTop: '10px'}}>{m.title}</span>
                      </div>
                    )}
                    
                    <div className="badge-group">
                      {m.year && <span className="badge type">{m.year}</span>}
                      <span className="badge quality">{m.type === 'series' ? 'SÉRIE' : 'FILME'}</span>
                    </div>

                    <div className={`favorite-btn ${m.is_favorite ? 'active' : ''}`} onClick={(e) => toggleFavorite(e, m.id, m.is_favorite)}>
                      <Icons.Star size={18} fill={m.is_favorite ? "currentColor" : "none"} />
                    </div>

                    <div className="hover-overlay">
                      <p className="synopsis">{m.overview}</p>
                      <button className="btn-play-card">
                        <Icons.Play size={16} fill="white" /> {m.type === 'series' ? 'Ver Episódios' : 'Assistir'}
                      </button>
                    </div>
                  </div>

                  <div className="media-info">
                    <h3 className="media-title">{m.title}</h3>
                    <div className="media-meta">
                      <div className="star-rating">
                        <Icons.Star size={12} fill="currentColor" /> {m.rating?.toFixed(1) || '0.0'}
                      </div>
                      {m.type === 'series' && <span>{m.item_count} ep.</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {media.length === 0 && (
              <div className="empty-state">
                <Icons.SearchX size={48} />
                <h2>Nenhum resultado encontrado</h2>
                <p>Tente ajustar sua busca ou filtros.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Loading ── */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p className="loading-text">Sincronizando metadados e preparando stream...</p>
        </div>
      )}
    </div>
  );
}
