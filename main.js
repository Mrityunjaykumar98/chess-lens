import './style.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';

// --- State ---
const state = {
    username: '',
    games: [],
    currentView: 'games',
    review: {
        chess: new Chess(),
        cg: null,
        history: [],
        currentPly: 0,
        fens: [],
        currentGame: null,
    },
    engine: {
        worker: null,
        eval: 0,
        depth: 0,
        bestMove: ''
    }
};

// --- DOM Elements ---
const DOM = {
    navDashboard: document.getElementById('nav-dashboard'),
    navGames: document.getElementById('nav-games'),
    viewGames: document.getElementById('view-games'),
    viewReview: document.getElementById('view-review'),
    pageTitle: document.getElementById('page-title'),
    usernameInput: document.getElementById('username-input'),
    fetchBtn: document.getElementById('fetch-btn'),
    gamesTbody: document.getElementById('games-tbody'),
    tableSummary: document.getElementById('table-summary'),
    boardWrap: document.getElementById('chessground'),
    blackInfo: document.getElementById('black-info'),
    whiteInfo: document.getElementById('white-info'),

    // Review specific
    movesList: document.getElementById('moves-list'),
    btnStart: document.getElementById('btn-start'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnEnd: document.getElementById('btn-end'),
    evalFill: document.getElementById('eval-fill'),
    evalScore: document.getElementById('eval-score'),
    bestMoveContainer: document.getElementById('best-move'),
};

// --- Engine Service ---
function initEngine() {
    if (state.engine.worker) return;
    state.engine.worker = new Worker('/stockfish.js');
    state.engine.worker.onmessage = (e) => {
        const line = e.data;
        if (typeof line !== 'string') return;

        // Parse evaluation
        if (line.startsWith('info depth')) {
            const depthMatch = line.match(/depth (\d+)/);
            const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
            const boundMatch = line.match(/(upperbound|lowerbound)/);
            const pvMatch = line.match(/ pv (.+)/);

            if (depthMatch) state.engine.depth = parseInt(depthMatch[1]);

            // Ignore upper/lower bounds as they aren't exact evals
            if (scoreMatch && !boundMatch) {
                const type = scoreMatch[1];
                let val = parseInt(scoreMatch[2]);

                // Invert eval if it's black to move
                const fen = state.review.fens[state.review.currentPly];
                const isBlackToMove = fen ? fen.split(' ')[1] === 'b' : false;
                if (isBlackToMove) val = -val;

                if (type === 'cp') {
                    state.engine.eval = (val / 100).toFixed(2);
                } else if (type === 'mate') {
                    state.engine.eval = `M${Math.abs(val)}`;
                }
            }

            if (pvMatch) {
                state.engine.bestMove = pvMatch[1].split(' ')[0];
            }

            updateEngineUI();
        }
    };
    state.engine.worker.postMessage('uci');
}

function analyzePosition() {
    if (!state.engine.worker) return;
    state.engine.worker.postMessage('stop');
    const fen = state.review.fens[state.review.currentPly];
    if (!fen) return;
    state.engine.worker.postMessage(`position fen ${fen}`);
    state.engine.worker.postMessage('go depth 16');

    // reset UI instantly
    DOM.bestMoveContainer.textContent = 'Thinking...';
}

function updateEngineUI() {
    let scoreText = state.engine.eval;
    if (!scoreText.toString().startsWith('M') && scoreText > 0) scoreText = '+' + scoreText;

    DOM.evalScore.textContent = scoreText;
    DOM.bestMoveContainer.textContent = `Depth: ${state.engine.depth} | Best: ${state.engine.bestMove}`;

    // Update Evaluation Bar Height (white on bottom, black on top)
    let percentage = 50;
    if (scoreText.toString().startsWith('M')) {
        // Mate
        percentage = parseInt(scoreText.toString().substring(1)) > 0 ? 100 : 0;
    } else {
        // Convert centipawns to percentage. e.g. eval +2.00 is heavily favored White
        // A classic formula: 50 + 50 * (2 / Math.PI) * Math.atan(eval / 4)
        const scoreNum = parseFloat(state.engine.eval);
        percentage = 50 + 50 * (2 / Math.PI) * Math.atan(scoreNum / 4);
        percentage = Math.max(0, Math.min(100, percentage));
    }

    DOM.evalFill.style.height = `${percentage}%`;
    DOM.evalFill.style.backgroundColor = percentage > 50 ? '#ffffff' : '#B0B0B0';
}


// --- API Service ---
const ChessAPI = {
    async fetchGames(username) {
        try {
            // 1. Get archives
            const archiveRes = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
            if (!archiveRes.ok) throw new Error('User not found or API error');
            const archiveData = await archiveRes.json();

            const archives = archiveData.archives;
            if (!archives || archives.length === 0) return [];

            // 2. Fetch last 2 months of games to get 'recent' (approx 50-100 games)
            const games = [];
            const monthsToFetch = archives.slice(-2).reverse(); // Last 2 items

            for (const url of monthsToFetch) {
                const res = await fetch(url);
                const data = await res.json();
                games.push(...data.games);
            }

            // Sort recent first
            return games.sort((a, b) => b.end_time - a.end_time);

        } catch (e) {
            console.error(e);
            alert('Error fetching games. Check console.');
            return [];
        }
    }
};

// --- UI Rendering ---
function switchView(viewName) {
    state.currentView = viewName;
    DOM.viewGames.classList.add('hidden');
    DOM.viewGames.classList.remove('active');
    DOM.viewReview.classList.add('hidden');
    DOM.viewReview.classList.remove('active');

    if (viewName === 'games') {
        DOM.viewGames.classList.add('active');
        DOM.viewGames.classList.remove('hidden');
        DOM.navGames.classList.add('active');
        DOM.pageTitle.textContent = `Chess history of ${state.username || 'user'}`;
    } else if (viewName === 'review') {
        DOM.viewReview.classList.add('active');
        DOM.viewReview.classList.remove('hidden');
        DOM.pageTitle.textContent = 'Match Review';
        DOM.navGames.classList.remove('active');
    }
}

function renderGames() {
    DOM.gamesTbody.innerHTML = '';

    if (state.games.length === 0) {
        DOM.gamesTbody.innerHTML = `<tr class="empty-state"><td colspan="6">No games found or enter username to fetch.</td></tr>`;
        DOM.tableSummary.textContent = `Showing 0 games`;
        return;
    }

    const displayGames = state.games.slice(0, 50); // Show max 50 recent games
    DOM.tableSummary.textContent = `Showing 1-${displayGames.length} of ${state.games.length} games`;

    displayGames.forEach(game => {
        const isWhite = game.white.username.toLowerCase() === state.username.toLowerCase();
        const resultDetails = getResultDetails(game, isWhite);

        // Format Date
        const endDate = new Date(game.end_time * 1000);
        const dateStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </td>
      <td>${dateStr}</td>
      <td>
        <div class="player-row">
          <div class="color-indicator color-white"></div>
          <strong>${game.white.username}</strong> <span class="rating">(${game.white.rating})</span>
        </div>
        <div class="player-row">
          <div class="color-indicator color-black"></div>
          <span>${game.black.username}</span> <span class="rating">(${game.black.rating})</span>
        </div>
      </td>
      <td>
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="badge-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        ${game.time_class}
      </td>
      <td>
        <span class="badge badge-${resultDetails.cssClass}">
          ${resultDetails.icon}
          ${resultDetails.text}
        </span>
      </td>
    `;
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline review-btn';
        btn.textContent = 'Review';
        // Pass the game index to easily retrieve it later
        btn.dataset.index = state.games.indexOf(game);

        const td = document.createElement('td');
        td.appendChild(btn);
        tr.appendChild(td);

        DOM.gamesTbody.appendChild(tr);
    });

    // Attach event listeners to review buttons
    document.querySelectorAll('.review-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const gameIndex = parseInt(e.target.dataset.index);
            const game = state.games[gameIndex];
            startReview(game);
        });
    });
}

function getResultDetails(game, isWhite) {
    const result = isWhite ? game.white.result : game.black.result;

    if (result === 'win') {
        return {
            text: 'Win',
            cssClass: 'win',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
        };
    } else if (result === 'agreed' || result === 'repetition' || result === 'stalemate' || result === 'insufficient' || result === 'timevsinsufficient') {
        return {
            text: 'Draw',
            cssClass: 'draw',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>'
        };
    } else {
        // resign, checkmated, timeout, abandoned, etc
        return {
            text: 'Loss',
            cssClass: 'loss',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
        };
    }
}

// --- Review Feature ---
function startReview(game) {
    switchView('review');

    state.review.currentGame = game;

    // 1. Setup Chess logic
    state.review.chess.loadPgn(game.pgn);
    state.review.history = state.review.chess.history({ verbose: true });
    // Reset to beginning of game per user request
    state.review.currentPly = 0;

    // Create an array to track FENs
    state.review.fens = [];
    const tempChess = new Chess();
    state.review.fens.push(tempChess.fen());
    for (const move of state.review.history) {
        tempChess.move(move);
        state.review.fens.push(tempChess.fen());
    }

    // 2. Setup Board
    if (!state.review.cg) {
        state.review.cg = Chessground(DOM.boardWrap, {
            viewOnly: true,
            animation: { enabled: true, duration: 200 }
        });
    }

    updateBoardState();
    renderMovesList();

    // NOTE: Stockfish WebWorker integration goes here
    initEngine();
    analyzePosition();

    // Update Player Info UI
    updatePlayerInfo(game);
}

function updatePlayerInfo(game) {
    // Top is Black, Bottom is White by default
    DOM.blackInfo.innerHTML = `
        <div class="player-avatar black"></div>
        <span class="player-name">${game.black.username}</span>
        <span class="player-rating">(${game.black.rating})</span>
    `;

    DOM.whiteInfo.innerHTML = `
        <div class="player-avatar white"></div>
        <span class="player-name">${game.white.username}</span>
        <span class="player-rating">(${game.white.rating})</span>
    `;
}

function updateBoardState() {
    const ply = state.review.currentPly;
    const fen = state.review.fens[ply];

    // Get last move
    let lastMove = null;
    if (ply > 0) {
        const move = state.review.history[ply - 1];
        lastMove = [move.from, move.to];
    }

    state.review.cg.set({
        fen: fen,
        lastMove: lastMove,
        drawable: { autoShapes: [] } // Clear arrows on move
    });

    // Analyze with engine
    analyzePosition();

    // Highlight current move in list
    document.querySelectorAll('.move-ply').forEach(el => el.classList.remove('active'));
    if (ply > 0) {
        const moveEl = document.getElementById(`move-ply-${ply}`);
        if (moveEl) {
            moveEl.classList.add('active');
            moveEl.scrollIntoView({ block: 'nearest' });
        }
    }
}

function renderMovesList() {
    DOM.movesList.innerHTML = '';
    const history = state.review.history;

    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const wMove = history[i];
        const bMove = history[i + 1];

        // Inject custom styling
        DOM.movesList.innerHTML += `
            <div class="move-num">${moveNum}.</div>
            <div class="move-ply w-move" id="move-ply-${i + 1}" data-ply="${i + 1}">${wMove.san}</div>
            ${bMove ? `<div class="move-ply b-move" id="move-ply-${i + 2}" data-ply="${i + 2}">${bMove.san}</div>` : '<div></div>'}
        `;
    }

    // Attach click listeners to moves
    document.querySelectorAll('.move-ply').forEach(el => {
        el.addEventListener('click', (e) => {
            state.review.currentPly = parseInt(e.target.dataset.ply);
            updateBoardState();
        });
    });
}

// --- Event Listeners ---
DOM.fetchBtn.addEventListener('click', async () => {
    const username = DOM.usernameInput.value.trim();
    if (!username) return;

    state.username = username;
    DOM.fetchBtn.textContent = 'Loading...';
    DOM.fetchBtn.disabled = true;

    state.games = await ChessAPI.fetchGames(username);

    DOM.fetchBtn.textContent = 'Fetch';
    DOM.fetchBtn.disabled = false;

    switchView('games');
    renderGames();
});

// Board Navigation
DOM.btnStart.addEventListener('click', () => { state.review.currentPly = 0; updateBoardState(); });
DOM.btnPrev.addEventListener('click', () => { if (state.review.currentPly > 0) { state.review.currentPly--; updateBoardState(); } });
DOM.btnNext.addEventListener('click', () => { if (state.review.currentPly < state.review.history.length) { state.review.currentPly++; updateBoardState(); } });
DOM.btnEnd.addEventListener('click', () => { state.review.currentPly = state.review.history.length; updateBoardState(); });

document.addEventListener('keydown', (e) => {
    if (state.currentView === 'review') {
        if (e.key === 'ArrowLeft') DOM.btnPrev.click();
        if (e.key === 'ArrowRight') DOM.btnNext.click();
    }
});

// Navigation menu
DOM.navGames.addEventListener('click', (e) => {
    e.preventDefault();
    switchView('games');
});
DOM.navDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    // Usually Dashboard goes to a different view, let's keep it simple
    alert('Dashboard summary feature pending');
});

// Setup default scaffold files mapping
// Replaces the old main.js entirely

