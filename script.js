/* =====================
   漢字読みかるた - script
   ===================== */

// --- 定数・状態 ---
const FILE_MAP = {
  "1nen": "１年.json",
  "2nen_1": "２年➀.json",
  "2nen_2": "２年➁.json",
  "3nen_1": "３年➀.json",
  "3nen_2": "３年➁.json",
  "4nen_1": "４年➀.json",
  "4nen_2": "４年➁.json",
  "5nen_1": "５年➀.json",
  "5nen_2": "５年➁.json",
  "6nen_1": "６年➀.json",
  "6nen_2": "６年➁.json"
};

let questionsAll = [];        // 読み込んだ全問題（{kanji, reading}）
let questionsInPlay = [];     // 今回プレイ分（5/10/15）
let remaining = [];           // まだ残っている問題
let current = null;           // 現在の問題（{kanji, reading}）
let voiceList = [];           // 利用可能な日本語音声
let selectedVoice = null;     // 選択中の音声
let startTime = 0;            // ミリ秒
let timerId = null;
let totalMs = 0;              // クリアタイム

// DOM取得
const el = (id)=>document.getElementById(id);
const menu = el('menu');
const game = el('game');
const result = el('result');
const historyView = el('history');
const grid = el('card-grid');

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  setupVoiceSelect();
  el('btn-start-from-menu').addEventListener('click', handleStartFromMenu);
  el('btn-show-history').addEventListener('click', showHistory);
  el('btn-start').addEventListener('click', startGameLogic);
  el('btn-repeat').addEventListener('click', repeatReading);
  el('btn-retry').addEventListener('click', retryGame);
  el('btn-quit').addEventListener('click', quitGame);
  el('btn-result-menu').addEventListener('click', () => switchScreen(result, menu));
  el('btn-history-back').addEventListener('click', () => switchScreen(historyView, menu));

  // iOSなどで onvoiceschanged が複数回発火しない場合に備えて
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = setupVoiceSelect;
  }
});

function switchScreen(hide, show){
  hide.style.display = 'none';
  show.style.display = 'flex';
}

/* ---- 音声選択 修正版（iOS対応 & ja-JP含む） ---- */
function setupVoiceSelect(){
  const select = el('voice-select');
  select.innerHTML = '';
  let allVoices = [];

  try {
    if (typeof speechSynthesis !== 'undefined') {
      allVoices = speechSynthesis.getVoices() || [];
    }
  } catch(e) {
    console.warn('音声取得エラー', e);
  }

  // iOSなどで音声リストが空の場合、少し遅延して再取得
  if (allVoices.length === 0 && typeof speechSynthesis !== 'undefined') {
    setTimeout(setupVoiceSelect, 200);
    return;
  }

  // lang に「ja-jp」が含まれる音声を優先、それがなければ ja を含むもの
  voiceList = allVoices.filter(v => v.lang && v.lang.toLowerCase().includes('ja-jp'));
  if (voiceList.length === 0) {
    voiceList = allVoices.filter(v => v.lang && v.lang.toLowerCase().includes('ja'));
  }

  // 日本語音声が見つからない場合でも全音声から選択可能にする
  const displayList = voiceList.length > 0 ? voiceList : allVoices;

  if (!displayList || displayList.length === 0){
    const opt = document.createElement('option');
    opt.textContent = '利用可能な音声がありません';
    opt.value = '';
    select.appendChild(opt);
    selectedVoice = null;
    return;
  }

  // 最大3件表示
  displayList.slice(0,3).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  selectedVoice = displayList[0] || null;
  select.value = selectedVoice ? selectedVoice.name : '';
  select.onchange = ()=>{
    const v = allVoices.find(x=>x.name===select.value);
    if (v) selectedVoice = v;
  };
}

function speak(text){
  if (!text) return;
  if (typeof speechSynthesis === 'undefined' || !selectedVoice){
    return; // 端末で未対応
  }
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.voice = selectedVoice;
    u.lang = selectedVoice.lang || 'ja-JP';
    u.rate = 1.0; // 標準速度
    speechSynthesis.cancel(); // 直前の発話を中断
    speechSynthesis.speak(u);
  }catch(e){
    console.warn('speech error', e);
  }
}

/* ---- メニューから開始 ---- */
async function handleStartFromMenu(){
  const setKey = el('grade-set').value;
  const count = parseInt(el('mode').value,10);

  if (!setKey){
    await showModal('学年とセットを選んでください');
    return;
  }
  // 音声チェック
  if (!selectedVoice){
    await showModal('日本語の音声が利用できません');
    return;
  }

  try{
    const filename = FILE_MAP[setKey] || `${setKey}.json`;
    const res = await fetch(`data/${filename}`);
    if (!res.ok) throw new Error(`${filename} の読み込みに失敗しました`);
    const data = await res.json();
    // 期待する形式: [{ kanji: "水", reading: "みず" }, ...]
    questionsAll = Array.isArray(data) ? data : [];
    if (questionsAll.length === 0) throw new Error('問題が空です');

    // ランダムに count 件を選ぶ
    const shuffled = [...questionsAll].sort(()=>Math.random()-0.5);
    questionsInPlay = shuffled.slice(0, count);
    remaining = [...questionsInPlay];

    buildGrid(count);
    el('btn-start').disabled = false;
    el('btn-repeat').disabled = true;
    el('btn-retry').disabled = true;

    switchScreen(menu, game);
  }catch(err){
    console.error(err);
    await showModal(`問題データの読み込みに失敗しました\n${err.message}`);
  }
}

/* ---- グリッド構成 ---- */
function buildGrid(count){
  grid.innerHTML = '';
  // 列数: 5->1列, 10->2列, 15->3列
  const cols = count===5?1:count===10?2:3;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  questionsInPlay.forEach(q=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.kanji = q.kanji;
    card.dataset.reading = q.reading;
    card.innerHTML = `<div class="kanji">${q.kanji}</div>`;
    card.addEventListener('click', ()=>handleCardClick(card));
    grid.appendChild(card);
  });
}

/* ---- ゲーム進行 ---- */
function startGameLogic(){
  // タイマー開始
  startTime = Date.now();
  el('timer').textContent = '0:00';
  if (timerId) clearInterval(timerId);
  timerId = setInterval(updateTimer, 1000);

  el('btn-start').disabled = true;
  el('btn-repeat').disabled = false;
  el('btn-retry').disabled = false;

  nextQuestion();
}

function updateTimer(){
  const ms = Date.now() - startTime;
  const m = Math.floor(ms/60000);
  const s = Math.floor((ms%60000)/1000).toString().padStart(2,'0');
  el('timer').textContent = `${m}:${s}`;
}

function nextQuestion(){
  if (remaining.length===0){
    finishGame();
    return;
  }
  const i = Math.floor(Math.random()*remaining.length);
  current = remaining[i];
  speak(current.reading);
}

function repeatReading(){
  if (current) speak(current.reading);
}

function handleCardClick(card){
  if (!current || card.classList.contains('hidden')) return;
  const isCorrect = card.dataset.kanji === current.kanji;
  if (isCorrect){
    playSE('pinpon');
    card.classList.add('correct');
    setTimeout(()=>{
      card.classList.remove('correct');
      card.classList.add('hidden');
      // 残りから除外
      remaining = remaining.filter(q=>q.kanji !== current.kanji);
      nextQuestion();
    }, 350);
  }else{
    playSE('bu');
    card.classList.add('incorrect');
    setTimeout(()=>card.classList.remove('incorrect'), 350);
  }
}

function retryGame(){
  // 同じセット・同じ枚数で再抽選
  const count = parseInt(el('mode').value,10);
  const shuffled = [...questionsAll].sort(()=>Math.random()-0.5);
  questionsInPlay = shuffled.slice(0, count);
  remaining = [...questionsInPlay];

  buildGrid(count);

  // タイマーリセット
  if (timerId) clearInterval(timerId);
  startTime = Date.now();
  el('timer').textContent = '0:00';
  timerId = setInterval(updateTimer, 1000);

  el('btn-start').disabled = true; // すでに計測中
  el('btn-repeat').disabled = false;

  nextQuestion();
}

async function quitGame(){
  const ok = await showModal('ゲームを中断してメニューにもどりますか？', true);
  if (ok){
    if (timerId) clearInterval(timerId);
    if (typeof speechSynthesis!== 'undefined') speechSynthesis.cancel();
    switchScreen(game, menu);
  }
}

function finishGame(){
  if (timerId) clearInterval(timerId);
  if (typeof speechSynthesis!== 'undefined') speechSynthesis.cancel();
  totalMs = Date.now() - startTime;

  // 結果画面へ
  const m = Math.floor(totalMs/60000);
  const s = Math.floor((totalMs%60000)/1000).toString().padStart(2,'0');
  el('final-time').textContent = `タイム: ${m}:${s}`;
  makeResultTable();
  switchScreen(game, result);
}



