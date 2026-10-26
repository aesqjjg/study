(() => {
  "use strict";

  const STORAGE_KEY = "studymate_local_v2";
  
  // 타이머 객체 및 상태
  let timerInterval = null;
  let timerSecondsLeft = 25 * 60;
  let timerTotalSeconds = 25 * 60;
  let isTimerRunning = false;

  // 노트 멀티페이지 및 텍스트 박스 상태 관리
  let notePages = [
    { text: "", strokes: [], textElements: [] } // 기본 1페이지 (손글씨 + 타이핑 텍스트 박스 지원)
  ];
  let currentPageIndex = 0;

  const state = { 
    studyFiles: [], 
    problemFile: null, 
    solutionFile: null, 
    toastTimer: null, 
    strokes: [], 
    activeTool: "pen", // pen, highlighter, eraser, text
    drawing: false, 
    currentStroke: null, 
    canvasReady: false, 
    gradingFiles: {}, 
    currentQuiz: null 
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { history: [], profile: { name: "학생" }, notes: [], subjects: ["국어", "영어", "수학", "과학", "사회", "전기전자", "자동제어"], events: [], scores: [] };
      const parsed = JSON.parse(raw);
      return { 
        ...parsed, 
        history: Array.isArray(parsed.history) ? parsed.history : [], 
        profile: parsed.profile || { name: "학생" }, 
        notes: Array.isArray(parsed.notes) ? parsed.notes : [], 
        subjects: Array.isArray(parsed.subjects) && parsed.subjects.length ? parsed.subjects : ["국어", "영어", "수학", "과학", "사회"], 
        events: Array.isArray(parsed.events) ? parsed.events : [], 
        scores: Array.isArray(parsed.scores) ? parsed.scores : [] 
      };
    } catch (error) {
      console.warn("StudyMate 저장 데이터를 읽지 못했습니다.", error);
      return { history: [], profile: { name: "학생" }, notes: [], subjects: ["국어", "영어", "수학", "과학", "사회"], events: [], scores: [] };
    }
  }
  let appData = loadData();

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      return true;
    } catch (error) {
      showToast("저장 공간이 부족하거나 브라우저 저장이 차단되어 있어요.");
      return false;
    }
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function navigate(page) {
    const validPages = ["home", "quiz", "analysis", "notes", "grading", "planner", "history"];
    if (!validPages.includes(page)) return;
    $$(".page").forEach(section => section.classList.toggle("active", section.id === `page-${page}`));
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    const current = $(`.nav-item[data-page="${page}"] span:nth-child(2)`);
    if ($("#breadcrumbCurrent")) $("#breadcrumbCurrent").textContent = current ? current.textContent : "대시보드";
    closeMobileMenu();
    if (page === "notes") { 
      setTimeout(() => {
        resizeNoteCanvas(); 
        loadPageData(currentPageIndex);
      }, 50);
      renderSavedNotes(); 
      refreshSubjectSelects(); 
    }
    if (page === "planner") { refreshSubjectSelects(); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeMobileMenu() {
    $("#sidebar")?.classList.remove("open");
    $("#mobileOverlay")?.classList.remove("show");
  }

  // --- Notebook / 멀티페이지 및 텍스트박스 필기 패드 ---
  function saveCurrentPageData() {
    notePages[currentPageIndex] = {
      text: $("#noteText") ? $("#noteText").value : "",
      strokes: JSON.parse(JSON.stringify(state.strokes)),
      textElements: notePages[currentPageIndex]?.textElements ? JSON.parse(JSON.stringify(notePages[currentPageIndex].textElements)) : []
    };
  }

  function loadPageData(index) {
    if (index < 0 || index >= notePages.length) return;
    currentPageIndex = index;
    const pageData = notePages[currentPageIndex] || { text: "", strokes: [], textElements: [] };
    
    if ($("#noteText")) $("#noteText").value = pageData.text || "";
    state.strokes = JSON.parse(JSON.stringify(pageData.strokes || []));
    
    updatePagePaginationUI();
    drawStrokes();
    renderTextElementsOverlay();
  }

  function updatePagePaginationUI() {
    const pageNumEl = $("#notePageNumber");
    if (pageNumEl) {
      pageNumEl.textContent = `${currentPageIndex + 1} / ${notePages.length} 페이지`;
    }
  }

  function setupPageControlsUI() {
    const canvasContainer = $("#noteCanvas")?.parentElement;
    if (!canvasContainer || $("#notePageControls")) return;

    // 툴바에 'T' 텍스트 도구 버튼 추가 (없을 경우)
    const toolbar = canvasContainer.querySelector(".note-toolbar") || canvasContainer;
    if (!toolbar.querySelector('[data-tool="text"]')) {
      const textToolBtn = document.createElement("button");
      textToolBtn.type = "button";
      textToolBtn.className = "button button-light";
      textToolBtn.dataset.tool = "text";
      textToolBtn.innerHTML = "T 타이핑";
      toolbar.appendChild(textToolBtn);
    }

    const pageControls = document.createElement("div");
    pageControls.id = "notePageControls";
    pageControls.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; background: #f8faf7; padding: 10px 16px; border-radius: 8px; border: 1px solid #e0ebd9; flex-wrap: wrap; gap: 10px;";
    pageControls.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="button button-light" id="btnPrevPage" style="padding: 6px 12px; font-size: 12px;">◀ 이전 페이지</button>
        <span id="notePageNumber" style="font-weight: bold; font-size: 14px; color: #344f40; margin: 0 4px;">1 / 1 페이지</span>
        <button type="button" class="button button-light" id="btnNextPage" style="padding: 6px 12px; font-size: 12px;">다음 페이지 ▶</button>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="button button-secondary" id="btnAddPage" style="padding: 6px 12px; font-size: 12px;">+ 새 페이지 추가</button>
        <button type="button" class="button button-light danger-text" id="btnDeletePage" style="padding: 6px 12px; font-size: 12px; color: #d9534f;">이 페이지 삭제</button>
      </div>
    `;

    canvasContainer.parentNode.insertBefore(pageControls, canvasContainer);

    // 캔버스 부모에 relative 포지션 부여 (텍스트 박스 절대 좌표 배치를 위해)
    canvasContainer.style.position = "relative";

    $("#btnPrevPage")?.addEventListener("click", () => {
      if (currentPageIndex > 0) {
        saveCurrentPageData();
        loadPageData(currentPageIndex - 1);
      } else {
        showToast("첫 번째 페이지입니다.");
      }
    });

    $("#btnNextPage")?.addEventListener("click", () => {
      if (currentPageIndex < notePages.length - 1) {
        saveCurrentPageData();
        loadPageData(currentPageIndex + 1);
      } else {
        showToast("마지막 페이지입니다. 새 페이지를 추가해 보세요!");
      }
    });

    $("#btnAddPage")?.addEventListener("click", () => {
      saveCurrentPageData();
      notePages.push({ text: "", strokes: [], textElements: [] });
      loadPageData(notePages.length - 1);
      showToast(`${notePages.length}번째 페이지가 추가되었습니다.`);
    });

    $("#btnDeletePage")?.addEventListener("click", () => {
      if (notePages.length <= 1) {
        showToast("최소 한 개의 페이지는 남아있어야 합니다.");
        return;
      }
      if (confirm(`현재 ${currentPageIndex + 1}페이지를 삭제하시겠습니까?`)) {
        notePages.splice(currentPageIndex, 1);
        if (currentPageIndex >= notePages.length) {
          currentPageIndex = notePages.length - 1;
        }
        loadPageData(currentPageIndex);
        showToast("페이지가 삭제되었습니다.");
      }
    });
  }

  function resizeNoteCanvas() {
    const canvas = $("#noteCanvas"); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio); 
    canvas.height = Math.round(450 * ratio);
    canvas.style.height = "450px";
    const ctx = canvas.getContext("2d"); 
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStrokes(); 
    state.canvasReady = true;
  }

  function drawStrokes() {
    const canvas = $("#noteCanvas"); if (!canvas) return;
    const ctx = canvas.getContext("2d"), w = canvas.clientWidth, h = 450;
    ctx.clearRect(0, 0, w, h);
    
    // 줄노트 배경 그리기
    ctx.save(); 
    ctx.strokeStyle = "rgba(129, 151, 128, .15)"; 
    ctx.lineWidth = 1;
    for (let y = 32; y < h; y += 30) { 
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); 
    }
    ctx.restore();

    for (const stroke of state.strokes) {
      drawStroke(ctx, stroke, w, h);
    }
  }

  function drawStroke(ctx, stroke, w, h) {
    if (!stroke || !stroke.points || !stroke.points.length) return;
    ctx.save(); 
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = stroke.tool === "highlight" ? 0.25 : 1;
    ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : (stroke.color || "#344f40");
    ctx.fillStyle = ctx.strokeStyle; 
    ctx.lineWidth = stroke.tool === "highlight" ? Math.max((stroke.size || 4) * 3, 15) : (stroke.size || 4);
    ctx.lineCap = "round"; 
    ctx.lineJoin = "round";
    
    if (stroke.points.length === 1) { 
      const pt = stroke.points[0]; 
      ctx.beginPath(); 
      ctx.arc(pt.x * w, pt.y * h, ctx.lineWidth / 2, 0, Math.PI * 2); 
      ctx.fill(); 
    } else { 
      ctx.beginPath(); 
      ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h); 
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h); 
      }
      ctx.stroke(); 
    }
    ctx.restore();
  }

  function pointFromEvent(event) { 
    const r = $("#noteCanvas").getBoundingClientRect(); 
    return { 
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), 
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / 450)) 
    }; 
  }

  // 텍스트 박스 오버레이 렌더링 (T 도구용)
  function renderTextElementsOverlay() {
    const canvasContainer = $("#noteCanvas")?.parentElement;
    if (!canvasContainer) return;
    
    // 기존 오버레이 제거 후 재생성
    let overlay = canvasContainer.querySelector("#textElementsOverlay");
    if (overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.id = "textElementsOverlay";
    overlay.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;";
    
    const pageData = notePages[currentPageIndex] || { textElements: [] };
    if (!Array.isArray(pageData.textElements)) pageData.textElements = [];

    pageData.textElements.forEach((el, idx) => {
      const box = document.createElement("div");
      box.style.cssText = `position: absolute; left: ${el.x * 100}%; top: ${el.y * 100}%; pointer-events: auto; display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.9); padding: 4px 8px; border: 1px dashed #56765e; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`;
      
      const input = document.createElement("inputtype");
      // 표준 input 태그 생성
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.value = el.text || "";
      textInput.placeholder = "내용 입력...";
      textInput.style.cssText = "border: none; background: transparent; outline: none; font-size: 14px; color: #283a2c; font-family: inherit; width: 150px;";
      
      textInput.addEventListener("input", (e) => {
        el.text = e.target.value;
        saveCurrentPageData();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "×";
      deleteBtn.style.cssText = "border: none; background: #ffdfdf; color: #d9534f; border-radius: 50%; width: 18px; height: 18px; cursor: pointer; font-size: 12px; display: grid; place-items: center;";
      deleteBtn.addEventListener("click", () => {
        pageData.textElements.splice(idx, 1);
        saveCurrentPageData();
        renderTextElementsOverlay();
        showToast("텍스트 상자를 삭제했어요.");
      });

      box.appendChild(textInput);
      box.appendChild(deleteBtn);
      overlay.appendChild(box);
    });

    canvasContainer.appendChild(overlay);
  }

  function setupCanvas() {
    const canvas = $("#noteCanvas"); if (!canvas) return;
    
    setupPageControlsUI();

    const start = event => { 
      if (state.activeTool === "text") {
        // T 도구일 때 클릭한 위치에 텍스트 박스 생성
        event.preventDefault();
        const pt = pointFromEvent(event);
        if (!notePages[currentPageIndex].textElements) {
          notePages[currentPageIndex].textElements = [];
        }
        notePages[currentPageIndex].textElements.push({ x: pt.x, y: pt.y, text: "" });
        saveCurrentPageData();
        renderTextElementsOverlay();
        showToast("텍스트 상자가 추가되었습니다. 타이핑해 보세요!");
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) return; 
      event.preventDefault(); 
      canvas.setPointerCapture?.(event.pointerId); 
      state.drawing = true; 
      state.currentStroke = { 
        tool: state.activeTool, 
        color: $("#penColor") ? $("#penColor").value : "#344f40", 
        size: $("#penSize") ? Number($("#penSize").value) : 4, 
        points: [pointFromEvent(event)] 
      }; 
      state.strokes.push(state.currentStroke); 
      drawStrokes(); 
    };

    const move = event => { 
      if (!state.drawing || !state.currentStroke) return; 
      event.preventDefault(); 
      state.currentStroke.points.push(pointFromEvent(event)); 
      drawStrokes(); 
    };

    const end = () => { 
      if (!state.drawing) return; 
      state.drawing = false; 
      state.currentStroke = null; 
    };

    canvas.addEventListener("pointerdown", start); 
    canvas.addEventListener("pointermove", move); 
    ["pointerup","pointercancel","lostpointercapture"].forEach(type => canvas.addEventListener(type, end));
    
    // 툴바 버튼 이벤트 (펜, 형광펜, 지우개, T타이핑)
    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-tool]");
      if (!btn) return;
      state.activeTool = btn.dataset.tool;
      $$("[data-tool]").forEach(b => b.classList.toggle("active", b === btn));
      canvas.style.cursor = state.activeTool === "eraser" ? "cell" : (state.activeTool === "text" ? "text" : "crosshair");
    });

    $("#undoStroke")?.addEventListener("click", () => { 
      state.strokes.pop(); 
      drawStrokes(); 
    });

    $("#clearCanvas")?.addEventListener("click", () => { 
      if (!state.strokes.length && !notePages[currentPageIndex].textElements?.length) return; 
      if (confirm("현재 페이지의 필기 및 타이핑 내용을 모두 지울까요?")) { 
        state.strokes = []; 
        notePages[currentPageIndex].textElements = [];
        drawStrokes(); 
        renderTextElementsOverlay();
      } 
    });

    $("#saveNote")?.addEventListener("click", saveCurrentNote);
    $("#downloadNote")?.addEventListener("click", () => { 
      drawStrokes(); 
      const a = document.createElement("a"); 
      a.download = `${($("#noteTitle").value.trim() || "studymate-note").replace(/[\\/:*?"<>|]/g,"_")}_P${currentPageIndex + 1}.png`; 
      a.href = canvas.toDataURL("image/png"); 
      a.click(); 
    });

    window.addEventListener("resize", () => { 
      if ($("#page-notes")?.classList.contains("active")) resizeNoteCanvas(); 
    });
  }

  function saveCurrentNote() {
    saveCurrentPageData(); // 현재 페이지 동기화

    const title = $("#noteTitle").value.trim() || "제목 없는 노트", 
          subject = $("#noteSubject").value || "미분류";
    
    // 과목별/노트별 묶음(바인더) 저장 객체
    const note = { 
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, 
      title, 
      subject, 
      pages: JSON.parse(JSON.stringify(notePages)), 
      updatedAt: new Date().toISOString() 
    };
    
    appData.notes.unshift(note); 
    appData.notes = appData.notes.slice(0, 50); 
    saveData(); 
    renderSavedNotes(); 
    showToast(`[${subject}] '${title}' 노트 묶음이 저장되었습니다! (${notePages.length}페이지)`);
  }

  function renderSavedNotes() {
    const root = $("#savedNotes"); if (!root) return;
    root.innerHTML = appData.notes.length ? appData.notes.map(note => `
      <article class="saved-note-card" style="display: flex; align-items: center; justify-content: space-between; gap: 15px; background: #fff; padding: 14px 18px; border-radius: 12px; border: 1px solid #e0ebd9; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 24px; background: #f0f4ec; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px;">📚</div>
          <div>
            <strong style="font-size: 16px; color: #283a2c;">${escapeHTML(note.title)}</strong>
            <div style="font-size: 12px; color: #6b826e; margin-top: 2px;">과목: <b>${escapeHTML(note.subject)}</b> · 총 ${note.pages ? note.pages.length : 1}페이지 · ${escapeHTML(new Date(note.updatedAt).toLocaleDateString("ko-KR"))}</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="button button-light" style="padding: 6px 12px; font-size: 12px;" data-load-note="${escapeHTML(note.id)}">불러오기</button>
          <button class="button button-light danger-text" style="padding: 6px 12px; font-size: 12px; color: #d9534f;" data-delete-note="${escapeHTML(note.id)}">삭제</button>
        </div>
      </article>`).join("") : `<div class="empty-state"><div class="empty-state-icon">📚</div><div><strong>저장된 노트 묶음이 없어요.</strong>노트를 작성한 뒤 '노트 저장하기'를 눌러 과목별 묶음을 만들어 보세요!</div></div>`;

    // 노트 불러오기 이벤트
    root.querySelectorAll("[data-load-note]").forEach(btn => btn.addEventListener("click", () => { 
      const note = appData.notes.find(n => n.id === btn.dataset.loadNote); 
      if (!note) return; 
      $("#noteTitle").value = note.title; 
      $("#noteSubject").value = note.subject; 
      
      if (note.pages && Array.isArray(note.pages) && note.pages.length > 0) {
        notePages = JSON.parse(JSON.stringify(note.pages));
      } else {
        notePages = [{ text: note.text || "", strokes: note.strokes || [], textElements: [] }];
      }
      
      currentPageIndex = 0;
      resizeNoteCanvas(); 
      loadPageData(0);
      window.scrollTo({ top: 0, behavior: "smooth" }); 
      showToast(`'${note.title}' 노트 묶음을 불러왔습니다.`); 
    }));

    // 노트 묶음 삭제 이벤트
    root.querySelectorAll("[data-delete-note]").forEach(btn => btn.addEventListener("click", () => { 
      if (confirm("해당 노트 묶음을 완전히 삭제하시겠습니까?")) {
        appData.notes = appData.notes.filter(n => n.id !== btn.dataset.deleteNote); 
        saveData(); 
        renderSavedNotes(); 
        showToast("노트 묶음이 삭제되었습니다."); 
      }
    }));
  }

  function refreshSubjectSelects() {
    const selects = $$(".subject-select");
    selects.forEach(select => { const previous = select.value; select.innerHTML = appData.subjects.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join(""); if (appData.subjects.includes(previous)) select.value = previous; });
    const noteSelect = $("#noteSubject"); if (noteSelect) { const prev = noteSelect.value; noteSelect.innerHTML = appData.subjects.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join(""); if (appData.subjects.includes(prev)) noteSelect.value = prev; }
  }

  function init() {
    setupCanvas();
    refreshSubjectSelects();
    renderSavedNotes();
  }

  document.addEventListener("DOMContentLoaded", init);
})();