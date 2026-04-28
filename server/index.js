require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const db = require('./database');

const app = express();
app.use(express.json()); // Habilitar JSON para POSTs
app.use(cors());

const PORT = process.env.PORT || 3001;

// CHAVE DO TMDB (Lida do .env)
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ============================================================
// MÚLTIPLAS PASTAS DE MÍDIA (Lidas do .env)
// ============================================================
const MEDIA_SOURCES = (process.env.MEDIA_SOURCES || '').split(',').map(s => s.trim()).filter(s => s !== '');

const HLS_OUTPUT = path.join(__dirname, 'public', 'hls');

// Ensure directories exist
MEDIA_SOURCES.forEach(src => {
    if (!fs.existsSync(src)) {
        console.warn(`⚠️ Pasta não encontrada: ${src}`);
    }
});
if (!fs.existsSync(HLS_OUTPUT)) fs.mkdirSync(HLS_OUTPUT, { recursive: true });

// Serve HLS files
app.use('/hls', express.static(HLS_OUTPUT, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        else if (filePath.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));

// Serve custom posters
app.use('/posters', express.static(path.join(__dirname, 'public', 'posters')));

// ============================================================
// HELPERS DE METADADOS (Regex)
// ============================================================
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.webm'];
const SUBTITLE_EXTENSIONS = ['.srt'];

// Lógica para detectar se é Série ou Filme e extrair info
const parseFileName = (fileName) => {
    let name = fileName.replace(/\.[^/.]+$/, ""); // remove extensão
    
    // Limpeza de "lixo" comum em nomes de arquivos (termos técnicos)
    const junkTerms = [
        /10bit/gi, /x265/gi, /x264/gi, /h265/gi, /h264/gi, /hevc/gi, /psa/gi, /yts/gi, /yify/gi,
        /brrip/gi, /bluray/gi, /webrip/gi, /web-dl/gi, /6ch/gi, /aac/gi, /dual/gi, /audio/gi,
        /rzerox/gi, /1080p/gi, /720p/gi, /2160p/gi, /4k/gi, /multi/gi, /remastered/gi
    ];
    
    let cleanName = name;
    junkTerms.forEach(term => { cleanName = cleanName.replace(term, ''); });
    cleanName = cleanName.replace(/[.(_-]/g, ' ').trim();

    // Regex para Séries: Nome da Série S01E01
    const seriesMatch = name.match(/(.*)[ .sS]([0-9]{1,2})[eE]([0-9]{1,2})/i);
    // Regex para Qualidade
    const qualityMatch = name.match(/(4[kK]|2160[pP]|1080[pP]|720[pP])/i);
    // Regex para Ano
    const yearMatch = name.match(/\b(19|20)\d{2}\b/);
    // Regex para Formato
    const formatMatch = name.match(/(BluRay|WEBRip|BDRip|WEB-DL)/i);

    if (seriesMatch) {
        let seriesTitle = seriesMatch[1];
        junkTerms.forEach(term => { seriesTitle = seriesTitle.replace(term, ''); });
        seriesTitle = seriesTitle.replace(/[._-]/g, ' ').trim();

        return {
            type: 'series',
            title: seriesTitle,
            season: parseInt(seriesMatch[2]),
            episode: parseInt(seriesMatch[3]),
            quality: qualityMatch ? qualityMatch[0].toUpperCase() : '1080P',
            year: yearMatch ? parseInt(yearMatch[0]) : null,
            format: formatMatch ? formatMatch[0] : 'BluRay'
        };
    }

    // Para filmes, tentamos pegar o título antes do ano ou das especificações
    let movieTitle = cleanName;
    if (yearMatch) {
        const parts = cleanName.split(yearMatch[0]);
        if (parts[0].trim().length > 0) movieTitle = parts[0].trim();
    }

    return {
        type: 'movie',
        title: movieTitle,
        quality: qualityMatch ? qualityMatch[0].toUpperCase() : '1080P',
        year: yearMatch ? parseInt(yearMatch[0]) : null,
        format: formatMatch ? formatMatch[0] : 'BluRay'
    };
};

// Remove accents and lowercase for search
const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ============================================================
// TMDB INTEGRATION
// ============================================================
const fetchTMDB = async (type, title, year) => {
    if (!TMDB_API_KEY) return null;
    try {
        const query = encodeURIComponent(title);
        // Para séries, o TMDB usa first_air_date_year em vez de year
        const yearParam = year ? (type === 'series' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
        const url = `https://api.themoviedb.org/3/search/${type === 'series' ? 'tv' : 'movie'}?api_key=${TMDB_API_KEY}&query=${query}${yearParam}&language=pt-BR`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            return {
                tmdb_id: result.id,
                poster_path: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
                backdrop_path: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
                overview: result.overview,
                rating: result.vote_average,
                title: result.title || result.name
            };
        }
    } catch (e) {
        console.error('⚠️ Erro ao buscar no TMDB:', e.message);
    }
    return null;
};

// ============================================================
// SCANNER & SYNC
// ============================================================
const scanMedia = async () => {
    console.log('🔍 Iniciando scan de mídia...');
    let totalAdded = 0;

    for (let i = 0; i < MEDIA_SOURCES.length; i++) {
        const source = MEDIA_SOURCES[i];
        if (!fs.existsSync(source)) continue;

        const allVideos = findAllVideos(source);

        for (const video of allVideos) {
            try {
                const meta = parseFileName(video.name);

                // 1. Verificar se o ARQUIVO específico já está no banco usando o caminho relativo
                const relativePath = path.relative(source, video.fullPath);
                const existingFile = await db.get('SELECT id FROM files WHERE path = ?', [relativePath]);
                if (existingFile) continue;

                // 2. Tentar encontrar a mídia (Filme/Série) por título ou por TMDB_ID
                let mediaId;

                // Buscar metadados no TMDB primeiro para ter o ID real
                const tmdbMeta = await fetchTMDB(meta.type, meta.title, meta.year);

                let existingMedia;
                if (tmdbMeta && tmdbMeta.tmdb_id) {
                    existingMedia = await db.get('SELECT id FROM media WHERE tmdb_id = ?', [tmdbMeta.tmdb_id]);
                }

                if (!existingMedia) {
                    existingMedia = await db.get('SELECT id FROM media WHERE title = ? AND type = ?', [meta.title, meta.type]);
                }

                if (existingMedia) {
                    mediaId = existingMedia.id;
                } else {
                    const result = await db.run(`
                        INSERT INTO media (type, title, year, poster_path, backdrop_path, overview, rating, tmdb_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        meta.type,
                        tmdbMeta?.title || meta.title,
                        meta.year,
                        tmdbMeta?.poster_path || null,
                        tmdbMeta?.backdrop_path || null,
                        tmdbMeta?.overview || 'Sem sinopse disponível.',
                        tmdbMeta?.rating || 0,
                        tmdbMeta?.tmdb_id || null
                    ]);
                    mediaId = result.id;
                    totalAdded++;
                }

                // 3. Cadastrar o Arquivo vinculado à mídia encontrada/criada
                await db.run(`
                    INSERT INTO files (media_id, source_index, path, season, episode)
                    VALUES (?, ?, ?, ?, ?)
                `, [mediaId, i, path.relative(source, video.fullPath), meta.season || null, meta.episode || null]);

            } catch (err) {
                console.error(`⚠️ Erro ao processar arquivo: ${video.name}`, err.message);
                // Continua para o próximo arquivo mesmo se um der erro
            }
        }
    }

    // ── Lógica de Limpeza (Remover o que não existe mais) ──
    try {
        const dbFiles = await db.all('SELECT id, path, source_index FROM files');
        for (const f of dbFiles) {
            const absolutePath = path.join(MEDIA_SOURCES[f.source_index], f.path);
            if (!fs.existsSync(absolutePath)) {
                console.log(`🗑️ Removendo arquivo inexistente: ${f.path}`);
                await db.run('DELETE FROM files WHERE id = ?', [f.id]);
            }
        }

        // Remover mídias que ficaram sem nenhum arquivo (ex: uma série onde todos eps foram apagados)
        await db.run('DELETE FROM media WHERE id NOT IN (SELECT DISTINCT media_id FROM files)');
        
    } catch (err) {
        console.error('⚠️ Erro durante a limpeza:', err.message);
    }

    console.log(`✅ Scan finalizado. ${totalAdded} novas mídias catalogadas.`);
};

// API para forçar scan manual
app.post('/api/rescan', async (req, res) => {
    try {
        await scanMedia();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List files in a directory (only videos and folders)
const listDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return [];
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    return items
        .map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            ext: path.extname(item.name).toLowerCase(),
        }))
        .filter(item => item.isDirectory || VIDEO_EXTENSIONS.includes(item.ext));
};

// Recursively find all video files in a directory
const findAllVideos = (dirPath, results = []) => {
    if (!fs.existsSync(dirPath)) return results;
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
                findAllVideos(fullPath, results);
            } else if (VIDEO_EXTENSIONS.includes(path.extname(item.name).toLowerCase())) {
                results.push({
                    name: item.name,
                    fullPath: fullPath,
                    folder: path.basename(dirPath),
                });
            }
        }
    } catch (e) { /* skip inaccessible folders */ }
    return results;
};

// Find SRT subtitle files for a video
const findSubtitles = (videoFullPath) => {
    const dir = path.dirname(videoFullPath);
    const baseName = path.basename(videoFullPath, path.extname(videoFullPath));
    const subtitles = [];

    if (!fs.existsSync(dir)) return subtitles;

    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.toLowerCase().endsWith('.srt')) continue;
        if (!file.startsWith(baseName)) continue;

        // Extract language from filename: "Movie.pt.srt" -> "pt", "Movie.srt" -> "default"
        const withoutExt = file.slice(0, -4); // remove .srt
        const afterBase = withoutExt.slice(baseName.length); // ".pt" or ""
        let lang = 'Legenda';

        if (afterBase.startsWith('.') && afterBase.length > 1) {
            const code = afterBase.slice(1); // "pt", "en", "pt-br", etc.
            const langMap = {
                'pt': 'Português', 'pt-br': 'Português (BR)', 'por': 'Português',
                'en': 'English', 'eng': 'English',
                'es': 'Español', 'spa': 'Español',
                'fr': 'Français', 'fre': 'Français',
                'de': 'Deutsch', 'ger': 'Deutsch',
                'it': 'Italiano', 'ita': 'Italiano',
                'ja': '日本語', 'jpn': '日本語',
                'ko': '한국어', 'kor': '한국어',
            };
            lang = langMap[code.toLowerCase()] || code;
        }

        subtitles.push({
            label: lang,
            file: file,
            fullPath: path.join(dir, file),
        });
    }

    return subtitles;
};

// Convert SRT to WebVTT
const srtToVtt = (srtContent) => {
    let vtt = 'WEBVTT\n\n';
    // Replace comma with dot in timestamps, remove sequence numbers
    const lines = srtContent.replace(/\r\n/g, '\n').split('\n');
    let result = [];

    for (const line of lines) {
        if (/^\d+$/.test(line.trim())) continue; // Skip sequence numbers
        if (line.includes('-->')) {
            result.push(line.replace(/,/g, '.')); // Fix timestamp format
        } else {
            result.push(line);
        }
    }

    return vtt + result.join('\n');
};

// Recursively delete directory contents safely
const clearDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    clearDir(fullPath);
                    fs.rmdirSync(fullPath);
                } else {
                    fs.unlinkSync(fullPath);
                }
            } catch (e) { /* skip locked file */ }
        }
    } catch (e) { }
};

// ============================================================
// API: List Media (Grouped)
// ============================================================
app.get('/api/media', async (req, res) => {
    try {
        const { type, favorite, search, sort } = req.query;
        let query = `
            SELECT m.*, 
            (SELECT COUNT(*) FROM files f WHERE f.media_id = m.id) as item_count,
            (SELECT COUNT(*) FROM files f WHERE f.media_id = m.id AND f.watched = 1) as watched_count
            FROM media m
            WHERE 1=1
        `;
        const params = [];

        if (type && type !== 'all') {
            query += ' AND m.type = ?';
            params.push(type);
        }
        if (favorite === 'true') {
            query += ' AND m.is_favorite = 1';
        }
        if (search) {
            query += ' AND m.title LIKE ?';
            params.push(`%${search}%`);
        }

        // Ordenação
        let orderBy = 'm.title ASC';
        if (sort === 'year') orderBy = 'm.year DESC';
        if (sort === 'rating') orderBy = 'm.rating DESC';
        if (sort === 'newest') orderBy = 'm.created_at DESC';

        query += ` ORDER BY ${orderBy}`;

        const rows = await db.all(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: List Episodes (for Series Detail)
// ============================================================
app.get('/api/media/:id/episodes', async (req, res) => {
    try {
        const episodes = await db.all('SELECT * FROM files WHERE media_id = ? ORDER BY season ASC, episode ASC', [req.params.id]);
        res.json(episodes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: Stats (Sidebar)
// ============================================================
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN type = 'movie' THEN 1 ELSE 0 END) as movies,
                SUM(CASE WHEN type = 'series' THEN 1 ELSE 0 END) as series,
                SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as favorites,
                (SELECT COUNT(*) FROM files WHERE watched = 1) as watched_total
            FROM media
        `);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: Update Media Metadata (Manual Poster/Title/etc)
// ============================================================
app.patch('/api/media/:id', async (req, res) => {
    try {
        const { poster_path, title, overview } = req.body;
        const fields = [];
        const params = [];

        if (poster_path !== undefined) { fields.push('poster_path = ?'); params.push(poster_path); }
        if (title !== undefined) { fields.push('title = ?'); params.push(title); }
        if (overview !== undefined) { fields.push('overview = ?'); params.push(overview); }

        if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

        params.push(req.params.id);
        await db.run(`UPDATE media SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: Toggle Favorite
// ============================================================
app.post('/api/media/:id/favorite', async (req, res) => {
    try {
        const { favorite } = req.body;
        await db.run('UPDATE media SET is_favorite = ? WHERE id = ?', [favorite ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: Update Progress / Mark Watched
// ============================================================
app.post('/api/files/:id/status', async (req, res) => {
    try {
        const { watched, progress } = req.body;
        await db.run(`
            UPDATE files 
            SET watched = ?, progress = ?, last_played = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [watched ? 1 : 0, progress || 0, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API: Subtitles — list available SRTs for a video
// ============================================================
app.get('/api/subtitles', (req, res) => {
    const sourceIndex = parseInt(req.query.source);
    const relativePath = decodeURIComponent(req.query.path || '');

    if (isNaN(sourceIndex) || sourceIndex >= MEDIA_SOURCES.length) {
        return res.status(400).json({ error: 'Source inválido' });
    }

    const fullPath = path.join(MEDIA_SOURCES[sourceIndex], relativePath);
    const subs = findSubtitles(fullPath);

    res.json(subs.map(s => ({
        label: s.label,
        file: s.file,
    })));
});

// ============================================================
// API: Serve a specific subtitle as WebVTT
// ============================================================
app.get('/api/subtitle', (req, res) => {
    const sourceIndex = parseInt(req.query.source);
    const relativePath = decodeURIComponent(req.query.path || '');
    const srtFile = decodeURIComponent(req.query.file || '');

    if (isNaN(sourceIndex) || sourceIndex >= MEDIA_SOURCES.length) {
        return res.status(400).json({ error: 'Source inválido' });
    }

    const videoDir = path.dirname(path.join(MEDIA_SOURCES[sourceIndex], relativePath));
    const srtPath = path.join(videoDir, srtFile);

    if (!fs.existsSync(srtPath)) {
        return res.status(404).json({ error: 'Legenda não encontrada' });
    }

    try {
        // Tenta UTF-8 primeiro
        let srtContent = fs.readFileSync(srtPath, 'utf-8');

        // Se tem caractere de substituição (�), o arquivo não é UTF-8 → relê como Latin-1
        if (srtContent.includes('\uFFFD') || srtContent.includes('�')) {
            srtContent = fs.readFileSync(srtPath, 'latin1');
        }

        // Remove BOM se existir
        if (srtContent.charCodeAt(0) === 0xFEFF) {
            srtContent = srtContent.slice(1);
        }

        const vttContent = srtToVtt(srtContent);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(vttContent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obter duração do vídeo em segundos usando ffprobe
const getVideoDuration = (filePath) => {
    return new Promise((resolve) => {
        // -v error: silencia avisos
        // -select_streams v:0: foca no primeiro stream de vídeo
        // -show_entries format=duration: pega a duração total
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        exec(cmd, (err, stdout) => {
            if (err) {
                console.error(`⚠️ Erro ao obter duração: ${err.message}`);
                resolve(0);
            } else {
                const duration = parseFloat(stdout);
                resolve(isNaN(duration) ? 0 : duration);
            }
        });
    });
};

// ============================================================
// API: Stream video
// ============================================================
let currentProcess = null;

app.get('/api/stream', async (req, res) => {
    const sourceIndex = parseInt(req.query.source);
    const rawPath = req.query.path;
    const seek = parseFloat(req.query.seek || 0);

    if (!rawPath || isNaN(sourceIndex) || sourceIndex >= MEDIA_SOURCES.length) {
        return res.status(400).json({ error: 'Parâmetros inválidos' });
    }

    const decodedPath = decodeURIComponent(rawPath);
    const fullPath = path.join(MEDIA_SOURCES[sourceIndex], decodedPath);

    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    // Obter duração (Plex style: rápida e necessária para a barra de progresso)
    const duration = await getVideoDuration(fullPath);

    // ── Lógica de Direct Stream (Para MP4/WebM nativo) ──
    const ext = path.extname(fullPath).toLowerCase();
    const isNative = ['.mp4', '.webm'].includes(ext);

    if (isNative && seek === 0) {
        return res.json({
            url: `/api/raw?source=${sourceIndex}&path=${rawPath}`,
            source: sourceIndex,
            path: decodedPath,
            duration,
            isDirect: true
        });
    }

    // ── HLS Transcoding + Seeking ──
    if (currentProcess) {
        try { 
            // No Windows, taskkill é mais eficiente para encerrar a árvore de processos
            exec(`taskkill /pid ${currentProcess.pid} /f /t`, (err) => {
                if (err) console.log('Processo já encerrado ou erro ao matar.');
            });
        } catch (e) { }
    }

    // Aguardar um pouco para garantir liberação de arquivos
    await new Promise(r => setTimeout(r, 500));

    clearDir(HLS_OUTPUT);
    if (!fs.existsSync(HLS_OUTPUT)) fs.mkdirSync(HLS_OUTPUT, { recursive: true });

    const outputPlaylist = path.join(HLS_OUTPUT, 'index.m3u8');
    
    // Fast Seek: colocar -ss ANTES do -i
    const args = [];
    if (seek > 0) args.push('-ss', seek.toString());
    args.push('-i', fullPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-hls_time', '10', '-hls_list_size', '0',
        '-f', 'hls', '-y',
        outputPlaylist
    );

    console.log(`📡 Iniciando FFmpeg (Seek: ${seek}s)...`);
    const ffmpegProcess = spawn('ffmpeg', args);
    currentProcess = ffmpegProcess;

    // Redirecionar logs para o console para debugar
    ffmpegProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // Mostrar apenas erros críticos ou mensagens de início para não sujar o log demais
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal')) {
            console.error(`🔴 FFmpeg stderr: ${msg}`);
        } else if (msg.toLowerCase().includes('opening')) {
            console.log(`📂 FFmpeg abrindo: ${msg.trim()}`);
        }
    });

    ffmpegProcess.stdout.on('data', (data) => {
        console.log(`🟢 FFmpeg info: ${data}`);
    });

    let hasResponded = false;

    ffmpegProcess.on('error', (err) => {
        console.error(`❌ Erro FFmpeg: ${err.message}`);
        if (!hasResponded) { hasResponded = true; res.status(500).json({ error: 'Erro no stream' }); }
    });

    // Poll for playlist
    let attempts = 0;
    const checkPlaylist = setInterval(() => {
        attempts++;
        if (fs.existsSync(outputPlaylist)) {
            const content = fs.readFileSync(outputPlaylist, 'utf8');
            if (content.includes('.ts') || content.includes('.m4s')) {
                clearInterval(checkPlaylist);
                if (!hasResponded) {
                    hasResponded = true;
                    res.json({
                        url: `/hls/index.m3u8?t=${Date.now()}`,
                        source: sourceIndex,
                        path: decodedPath,
                        duration,
                        seek
                    });
                }
            }
        }
        if (attempts >= 60) {
            clearInterval(checkPlaylist);
            if (!hasResponded) { hasResponded = true; res.status(500).json({ error: 'Timeout' }); }
        }
    }, 500);
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║       🎬 CineHome Streaming 🎬       ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Servidor: http://localhost:${PORT}     ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');

    let totalFiles = 0;
    MEDIA_SOURCES.forEach((src, i) => {
        if (fs.existsSync(src)) {
            const videos = findAllVideos(src);
            totalFiles += videos.length;
            console.log(`📂 Fonte ${i + 1}: ${src}`);
            console.log(`   → ${videos.length} vídeo(s) encontrado(s)`);
        } else {
            console.log(`⚠️ Fonte ${i + 1}: ${src} (NÃO ENCONTRADA)`);
        }
    });
    console.log(`\n🎬 Total: ${totalFiles} vídeo(s) disponíveis\n`);

    // Iniciar Scan automático na inicialização (após o banco estar pronto)
    db.initPromise
        .then(() => scanMedia())
        .catch(err => console.error('Erros no scan inicial:', err));
});
