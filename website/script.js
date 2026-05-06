document.addEventListener('DOMContentLoaded', () => {
      // ===== NAVIGATION =====
      function switchPage(pageName) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + pageName).classList.add('active');
        document.querySelectorAll('[data-page]').forEach(a => {
          a.classList.toggle('active', a.dataset.page === pageName);
        });
        localStorage.setItem('clockly_page', pageName);
      }
      document.querySelectorAll('[data-page]').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); switchPage(a.dataset.page); });
      });
      // Restore last active page
      const savedPage = localStorage.getItem('clockly_page');
      if (savedPage && document.getElementById('page-' + savedPage)) switchPage(savedPage);

      // ===== DECLARE ALL STATE VARIABLES FIRST =====
      let alarms = JSON.parse(localStorage.getItem('clockly_alarms') || '[]');
      let alarmAmPm = 'AM', ringingAlarmId = null, alarmAudioCtx = null, alarmRingInterval = null;
      let isFullscreen = false;
      // Timer — restore saved state (paused only; never auto-resume running)
      const _timerSaved = JSON.parse(localStorage.getItem('clockly_timer') || 'null');
      let timerState = 'idle', timerInterval = null;
      let timerRemaining = _timerSaved ? _timerSaved.remaining : 0;
      let timerTotal    = _timerSaved ? _timerSaved.total    : 0;
      let timerAudioCtx = null, timerRingInterval = null, isTimerRinging = false;
      // Stopwatch — in-memory only, resets on page load
      let swRunning = false, swStartTime = 0, swElapsed = 0, swAnimFrame = null, swLaps = [], swLastLapTime = 0;
      // Settings
      let clockFormat = localStorage.getItem('clockly_fmt') || '24';
      let currentTheme = localStorage.getItem('clockly_theme') || 'dark';
      let currentAccent = localStorage.getItem('clockly_accent') || 'blue';
      let currentTimezone = localStorage.getItem('clockly_tz') || Intl.DateTimeFormat().resolvedOptions().timeZone;

      // ===== TIMEZONE HELPERS (offline — uses browser Intl API) =====
      const _allTz = (() => {
        try { return Intl.supportedValuesOf('timeZone'); }
        catch(e) { return ['Africa/Cairo','America/Chicago','America/Los_Angeles','America/New_York','America/Sao_Paulo','America/Toronto','Asia/Colombo','Asia/Dubai','Asia/Hong_Kong','Asia/Jakarta','Asia/Karachi','Asia/Kolkata','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Tehran','Asia/Tokyo','Australia/Melbourne','Australia/Sydney','Europe/Amsterdam','Europe/Berlin','Europe/Istanbul','Europe/London','Europe/Moscow','Europe/Paris','Pacific/Auckland','Pacific/Honolulu','UTC']; }
      })();
      function _buildTzSelect(q) {
        const sel = document.getElementById('tzSelect');
        if (!sel) return;
        const filt = q ? _allTz.filter(t => t.toLowerCase().includes(q.toLowerCase()) || t.replace(/_/g,' ').toLowerCase().includes(q.toLowerCase())) : _allTz;
        sel.innerHTML = filt.map(t => `<option value="${t}"${t === currentTimezone ? ' selected' : ''}>${t.replace(/_/g,' ')}</option>`).join('');
        const lbl = document.getElementById('tzCurrentLabel');
        if (lbl) lbl.textContent = 'Selected: ' + currentTimezone.replace(/_/g,' ');
      }
      // ===== CLOCK =====
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      function updateClock() {
        const now = new Date();
        const tz = currentTimezone;
        // Time parts in selected timezone
        const tp = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: clockFormat === '12' }).formatToParts(now).forEach(p => tp[p.type] = p.value);
        // 24h parts for fullscreen
        const tp24 = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now).forEach(p => tp24[p.type] = p.value);
        const ampm = tp.dayPeriod || '';
        document.getElementById('clockDisplay').innerHTML = tp.hour + ':' + tp.minute +
          '<span style="font-size:clamp(30px,6vw,64px);opacity:.4">:' + tp.second + '</span>' +
          (ampm ? '<span style="font-size:clamp(14px,2.5vw,28px);opacity:.6;margin-left:6px">' + ampm + '</span>' : '');
        // Date in selected timezone
        const dp = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).formatToParts(now).forEach(p => dp[p.type] = p.value);
        const dateStr = dp.weekday + ', ' + dp.month + ' ' + dp.day;
        document.getElementById('clockDate').textContent = dateStr;
        document.getElementById('fullscreenTime').textContent = tp24.hour + ':' + tp24.minute + ':' + tp24.second;
        document.getElementById('fullscreenDate').textContent = dateStr;
        // Timezone label (short name e.g. IST, EST, GMT+5:30)
        try {
          const tzLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || tz;
          document.getElementById('clockTZ').textContent = tzLabel;
        } catch(e) { document.getElementById('clockTZ').textContent = tz; }
        checkAlarms(now);
      }
      setInterval(updateClock, 1000); updateClock();

      function toggleFullscreen() { isFullscreen = !isFullscreen; document.getElementById('fullscreenOverlay').classList.toggle('active', isFullscreen); }

      const worldZones = [
        { city: 'New York', tz: 'America/New_York' }, { city: 'London', tz: 'Europe/London' },
        { city: 'Tokyo', tz: 'Asia/Tokyo' }, { city: 'Dubai', tz: 'Asia/Dubai' },
        { city: 'Sydney', tz: 'Australia/Sydney' }, { city: 'Paris', tz: 'Europe/Paris' },
        { city: 'Los Angeles', tz: 'America/Los_Angeles' }, { city: 'Singapore', tz: 'Asia/Singapore' }
      ];
      function renderWorldClocks() {
        const c = document.getElementById('worldClocks');
        c.innerHTML = worldZones.map(z => {
          let t; try { t = new Date().toLocaleTimeString('en-US', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); } catch (e) { t = '--:--'; }
          return '<div class="card" style="text-align:center"><div class="label-caps" style="color:var(--on-surface-variant);margin-bottom:8px">' + z.city.toUpperCase() + '</div><div class="headline-md tabular">' + t + '</div></div>';
        }).join('');
      }
      setInterval(renderWorldClocks, 1000); renderWorldClocks();

      // ===== CALENDAR =====
      let _calYear = new Date().getFullYear(), _calMonth = new Date().getMonth(), _calOpen = false;
      const _calMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

      function renderCalendar() {
        const title = document.getElementById('calTitle');
        const grid  = document.getElementById('calGrid');
        if (!title || !grid) return;
        title.textContent = _calMonthNames[_calMonth] + ' ' + _calYear;
        const today = new Date();
        const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();
        const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        let html = dayLabels.map(d => `<div class="cal-day-lbl">${d}</div>`).join('');
        const firstDay     = new Date(_calYear, _calMonth, 1).getDay();
        const daysInMonth  = new Date(_calYear, _calMonth + 1, 0).getDate();
        const daysInPrev   = new Date(_calYear, _calMonth, 0).getDate();
        for (let i = firstDay - 1; i >= 0; i--)
          html += `<div class="cal-cell faded">${daysInPrev - i}</div>`;
        for (let d = 1; d <= daysInMonth; d++) {
          const isToday = d === todayD && _calMonth === todayM && _calYear === todayY;
          html += `<div class="cal-cell${isToday ? ' today' : ''}">${d}</div>`;
        }
        const rem = (firstDay + daysInMonth) % 7;
        for (let d = 1; d <= (rem === 0 ? 0 : 7 - rem); d++)
          html += `<div class="cal-cell faded">${d}</div>`;
        grid.innerHTML = html;
      }

      function calNav(dir) {
        _calMonth += dir;
        if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
        if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
        renderCalendar();
      }

      function toggleCalendar() {
        _calOpen = !_calOpen;
        const popup = document.getElementById('calPopup');
        if (!popup) return;
        popup.classList.toggle('open', _calOpen);
        if (_calOpen) renderCalendar();
      }

      // Close calendar on outside click
      document.addEventListener('click', e => {
        if (_calOpen && !e.target.closest('#calPopup') && !e.target.closest('#calBtn')) {
          _calOpen = false;
          const popup = document.getElementById('calPopup');
          if (popup) popup.classList.remove('open');
        }
      });

      // ===== ALARM =====

      function adjustAlarmPicker(type, dir) {
        const el = document.getElementById(type === 'hour' ? 'alarmHour' : 'alarmMinute');
        let v = parseInt(el.value);
        if (type === 'hour') { v = ((v + dir) % 12 + 12) % 12; if (v === 0) v = 12; } else { v = ((v + dir) % 60 + 60) % 60; }
        el.value = String(v).padStart(2, '0');
      }
      function validateAlarmInput(type) {
        const el = document.getElementById(type === 'hour' ? 'alarmHour' : 'alarmMinute');
        let v = parseInt(el.value) || 0;
        if (type === 'hour') { if (v < 1 || v > 12) v = v < 1 ? 1 : 12; }
        else { if (v < 0 || v > 59) v = v < 0 ? 0 : 59; }
        el.value = String(v).padStart(2, '0');
      }
      function setAmPm(v) {
        alarmAmPm = v;
        document.getElementById('amBtn').style.background = v === 'AM' ? 'var(--primary-container)' : 'var(--surface-container-highest)';
        document.getElementById('amBtn').style.color = v === 'AM' ? 'var(--on-primary-container)' : 'var(--on-surface-variant)';
        document.getElementById('pmBtn').style.background = v === 'PM' ? 'var(--primary-container)' : 'var(--surface-container-highest)';
        document.getElementById('pmBtn').style.color = v === 'PM' ? 'var(--on-primary-container)' : 'var(--on-surface-variant)';
      }
      function toggleDay(btn) {
        btn.classList.toggle('selected');
        if (btn.classList.contains('selected')) { btn.style.background = 'var(--primary)'; btn.style.color = 'var(--on-primary)'; btn.style.border = 'none'; }
        else { btn.style.background = 'transparent'; btn.style.color = 'var(--primary)'; btn.style.border = '1px solid var(--primary)'; }
      }
      function saveAlarm() {
        const h12 = parseInt(document.getElementById('alarmHour').value), min = parseInt(document.getElementById('alarmMinute').value);
        let h24 = h12; if (alarmAmPm === 'AM' && h24 === 12) h24 = 0; if (alarmAmPm === 'PM' && h24 !== 12) h24 += 12;
        const selectedDays = Array.from(document.querySelectorAll('#repeatDays .day-btn.selected')).map(b => parseInt(b.dataset.day));
        const label = document.getElementById('alarmLabel').value.trim() || 'Alarm';
        alarms.push({ id: Date.now(), hour: h24, minute: min, days: selectedDays, label, enabled: true, ampm: alarmAmPm, h12 });
        localStorage.setItem('clockly_alarms', JSON.stringify(alarms)); renderAlarms();
        document.getElementById('alarmLabel').value = '';
      }
      function renderAlarms() {
        const list = document.getElementById('alarmList');
        const msg = document.getElementById('noAlarmsMsg');
        document.getElementById('alarmCount').textContent = alarms.length + ' Set';
        if (alarms.length === 0) { 
          if (msg) msg.style.display = 'block'; 
          list.innerHTML = '<div style="text-align:center;padding:48px 16px;color:var(--on-surface-variant);opacity:.5" id="noAlarmsMsg">No alarms set. Create one above!</div>'; 
          return; 
        }
        if (msg) msg.style.display = 'none';
        list.innerHTML = alarms.map(a => {
          const dn = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
          const ds = a.days.length === 7 ? 'Daily' : a.days.length === 0 ? 'Once' : a.days.map(d => dn[d]).join(' ');
          const ts = String(a.h12).padStart(2, '0') + ':' + String(a.minute).padStart(2, '0');
          return '<div class="card" style="display:flex;align-items:center;justify-content:space-between;opacity:' + (a.enabled ? '1' : '.5') + '">' +
            '<div><div style="display:flex;align-items:baseline;gap:8px"><span class="display-lg tabular" style="line-height:1">' + ts + '</span>' +
            '<span class="headline-md" style="color:var(--outline)">' + a.ampm + '</span></div>' +
            '<div style="display:flex;gap:8px;margin-top:8px"><span class="label-caps" style="color:var(--primary);background:rgba(149,204,255,.1);padding:2px 8px;border-radius:4px">' + ds + '</span>' +
            '<span class="label-caps" style="color:var(--on-surface-variant)">' + a.label + '</span></div></div>' +
            '<div style="display:flex;align-items:center;gap:16px">' +
            '<div class="toggle ' + (a.enabled ? 'on' : 'off') + '" onclick="toggleAlarm(' + a.id + ')"><div class="knob"></div></div>' +
            '<button onclick="deleteAlarm(' + a.id + ')" style="background:none;border:none;color:var(--outline);cursor:pointer;font-size:16px;font-weight:700" onmouseover="this.style.color=\'var(--error)\'" onmouseout="this.style.color=\'var(--outline)\'">✕</button>' +
            '</div></div>';
        }).join('');
      }
      function toggleAlarm(id) { const a = alarms.find(x => x.id === id); if (a) { a.enabled = !a.enabled; localStorage.setItem('clockly_alarms', JSON.stringify(alarms)); renderAlarms(); } }
      function deleteAlarm(id) { alarms = alarms.filter(x => x.id !== id); localStorage.setItem('clockly_alarms', JSON.stringify(alarms)); renderAlarms(); }
      function checkAlarms(now) {
        if (ringingAlarmId) return;
        alarms.forEach(a => {
          if (!a.enabled) return;
          if (a.hour === now.getHours() && a.minute === now.getMinutes() && now.getSeconds() === 0) {
            if (a.days.length > 0 && !a.days.includes(now.getDay())) return;
            ringingAlarmId = a.id;
            document.getElementById('alarmModalTime').textContent = String(a.h12).padStart(2, '0') + ':' + String(a.minute).padStart(2, '0') + ' ' + a.ampm;
            document.getElementById('alarmModalLabel').textContent = a.label;
            document.getElementById('alarmModal').classList.add('active'); playAlarmSound();
          }
        });
      }
      function playAlarmSound() { try { if (alarmRingInterval) clearInterval(alarmRingInterval); alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); let freq = 800; function playBeep() { if (!alarmAudioCtx) return; const o = alarmAudioCtx.createOscillator(), g = alarmAudioCtx.createGain(); o.connect(g); g.connect(alarmAudioCtx.destination); o.frequency.value = freq; o.type = 'sawtooth'; g.gain.setValueAtTime(.4, alarmAudioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.01, alarmAudioCtx.currentTime + .6); o.start(); o.stop(alarmAudioCtx.currentTime + .6); freq = freq === 800 ? 1000 : 800; } playBeep(); alarmRingInterval = setInterval(playBeep, 700); } catch (e) { } }
      function dismissAlarm() { document.getElementById('alarmModal').classList.remove('active'); if (alarmRingInterval) clearInterval(alarmRingInterval); if (alarmAudioCtx) { alarmAudioCtx.close(); alarmAudioCtx = null; } const a = alarms.find(x => x.id === ringingAlarmId); if (a && a.days.length === 0) deleteAlarm(a.id); ringingAlarmId = null; }
      renderAlarms();

      // ===== TIMER =====
      function saveTimerState() {
        if (timerState === 'idle') { localStorage.removeItem('clockly_timer'); return; }
        localStorage.setItem('clockly_timer', JSON.stringify({ state: timerState, remaining: timerRemaining, total: timerTotal }));
      }
      function adjustTimer(u, d) { const el = document.getElementById('timer' + u.toUpperCase()); let v = parseInt(el.value); if (u === 'h') v = ((v + d) % 24 + 24) % 24; else v = ((v + d) % 60 + 60) % 60; el.value = String(v).padStart(2, '0'); }
      function validateTimer(u) {
        const el = document.getElementById('timer' + u.toUpperCase());
        let v = parseInt(el.value) || 0;
        if (u === 'h') { if (v < 0 || v > 23) v = v < 0 ? 0 : 23; }
        else { if (v < 0 || v > 59) v = v < 0 ? 0 : 59; }
        el.value = String(v).padStart(2, '0');
      }
      function setTimerPreset(min, sec) { if (timerState === 'running') return; resetTimer(); document.getElementById('timerH').value = '00'; document.getElementById('timerM').value = String(min).padStart(2, '0'); document.getElementById('timerS').value = String(sec).padStart(2, '0'); }
      function getTimerInputSeconds() { return parseInt(document.getElementById('timerH').value) * 3600 + parseInt(document.getElementById('timerM').value) * 60 + parseInt(document.getElementById('timerS').value); }
      function formatTimer(s) { return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
      function toggleTimer() {
        const btn = document.getElementById('timerStartBtn');
        if (timerState === 'idle') { timerTotal = getTimerInputSeconds(); if (timerTotal <= 0) return; timerRemaining = timerTotal; timerState = 'running'; document.getElementById('timerInput').style.display = 'none'; document.getElementById('timerRunDisplay').style.display = 'block'; document.getElementById('timerCountdown').textContent = formatTimer(timerRemaining); btn.innerHTML = '⏸ PAUSE'; btn.className = 'btn btn-outline'; timerInterval = setInterval(timerTick, 1000); saveTimerState(); }
        else if (timerState === 'running') { clearInterval(timerInterval); timerState = 'paused'; btn.innerHTML = '▶ RESUME'; btn.className = 'btn btn-primary'; saveTimerState(); }
        else if (timerState === 'paused') { timerState = 'running'; btn.innerHTML = '⏸ PAUSE'; btn.className = 'btn btn-outline'; timerInterval = setInterval(timerTick, 1000); saveTimerState(); }
      }
      function timerTick() {
        timerRemaining--;
        if (timerRemaining <= 0) { timerRemaining = 0; clearInterval(timerInterval); timerState = 'idle'; document.getElementById('timerStartBtn').innerHTML = '▶ START'; document.getElementById('timerStartBtn').className = 'btn btn-primary'; localStorage.removeItem('clockly_timer'); timerDone(); }
        else { saveTimerState(); }
        document.getElementById('timerCountdown').textContent = formatTimer(timerRemaining);
        const p = timerTotal > 0 ? (timerRemaining / timerTotal) * 100 : 0; document.getElementById('timerProgressFill').style.width = p + '%';
        if (timerRemaining <= 10) { document.getElementById('timerCountdown').style.color = 'var(--error)'; document.getElementById('timerProgressFill').style.background = 'var(--error)'; }
        else { document.getElementById('timerCountdown').style.color = 'var(--on-surface)'; document.getElementById('timerProgressFill').style.background = 'var(--primary)'; }
      }
      function timerDone() { try { if (timerRingInterval) clearInterval(timerRingInterval); timerAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); isTimerRinging = true; let freq = 900; function playTimerBeep() { if (!timerAudioCtx || !isTimerRinging) return; const o = timerAudioCtx.createOscillator(), g = timerAudioCtx.createGain(); o.connect(g); g.connect(timerAudioCtx.destination); o.frequency.value = freq; o.type = 'sawtooth'; g.gain.setValueAtTime(.35, timerAudioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.01, timerAudioCtx.currentTime + .5); o.start(); o.stop(timerAudioCtx.currentTime + .5); freq = freq === 900 ? 1100 : 900; } playTimerBeep(); timerRingInterval = setInterval(playTimerBeep, 650); } catch (e) { } document.getElementById('timerCountdown').textContent = '00:00:00'; document.getElementById('timerCountdown').style.color = 'var(--secondary)'; }
      function resetTimer() { clearInterval(timerInterval); if (timerRingInterval) clearInterval(timerRingInterval); isTimerRinging = false; if (timerAudioCtx) { timerAudioCtx.close(); timerAudioCtx = null; } timerState = 'idle'; timerRemaining = 0; timerTotal = 0; localStorage.removeItem('clockly_timer'); document.getElementById('timerInput').style.display = 'flex'; document.getElementById('timerRunDisplay').style.display = 'none'; document.getElementById('timerStartBtn').innerHTML = '▶ START'; document.getElementById('timerStartBtn').className = 'btn btn-primary'; document.getElementById('timerCountdown').style.color = 'var(--on-surface)'; document.getElementById('timerProgressFill').style.width = '100%'; document.getElementById('timerProgressFill').style.background = 'var(--primary)'; }
      // Restore timer UI if a paused timer was saved
      (function restoreTimer() {
        if (!_timerSaved || _timerSaved.state === 'idle') return;
        // Only restore paused state — never silently resume a running timer
        timerState = 'paused';
        timerRemaining = _timerSaved.remaining;
        timerTotal = _timerSaved.total;
        document.getElementById('timerInput').style.display = 'none';
        document.getElementById('timerRunDisplay').style.display = 'block';
        document.getElementById('timerCountdown').textContent = formatTimer(timerRemaining);
        const p = timerTotal > 0 ? (timerRemaining / timerTotal) * 100 : 0;
        document.getElementById('timerProgressFill').style.width = p + '%';
        if (timerRemaining <= 10) { document.getElementById('timerCountdown').style.color = 'var(--error)'; document.getElementById('timerProgressFill').style.background = 'var(--error)'; }
        document.getElementById('timerStartBtn').innerHTML = '▶ RESUME';
        document.getElementById('timerStartBtn').className = 'btn btn-primary';
      })();

      // ===== STOPWATCH =====
      function formatSW(ms) {
        const totalSec = Math.floor(ms / 1000);
        const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        return h + ':' + m + ':' + s;
      }

      function formatSwMs(ms) {
        return '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
      }

      function formatLapTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        const cs = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
        return m + ':' + s + '.' + cs;
      }

      function getNowMs() {
        return (window.performance && typeof window.performance.now === 'function')
          ? window.performance.now()
          : Date.now();
      }

      function updateSwDisplay() {
        const now = getNowMs();
        const total = swElapsed + (now - swStartTime);
        document.getElementById('swDisplay').innerHTML =
          formatSW(total) + '<span class="display-lg" style="color:var(--primary);margin-left:8px" id="swMs">' + formatSwMs(total) + '</span>';
        if (swRunning) swAnimFrame = requestAnimationFrame(updateSwDisplay);
      }


      function toggleStopwatch() {
        const btn = document.getElementById('swStartBtn');
        if (!swRunning) {
          swRunning = true;
          swStartTime = getNowMs();
          btn.innerHTML = '⏸';
          btn.style.background = 'var(--primary-container)';
          btn.style.color = 'var(--on-primary-container)';
          swAnimFrame = requestAnimationFrame(updateSwDisplay);
        } else {
          swRunning = false;
          swElapsed += getNowMs() - swStartTime;
          cancelAnimationFrame(swAnimFrame);
          btn.innerHTML = '▶';
          btn.style.background = 'var(--secondary)';
          btn.style.color = 'var(--on-secondary)';
        }
      }

      function resetStopwatch() {
        swRunning = false;
        swElapsed = 0;
        swStartTime = 0;
        swLastLapTime = 0;
        cancelAnimationFrame(swAnimFrame);
        document.getElementById('swDisplay').innerHTML =
          '00:00:00<span class="display-lg" style="color:var(--primary);margin-left:8px" id="swMs">.00</span>';
        const btn = document.getElementById('swStartBtn');
        btn.innerHTML = '▶';
        btn.style.background = 'var(--secondary)';
        btn.style.color = 'var(--on-secondary)';
        swLaps = [];
        renderLaps();
      }

      function addLap() {
        if (!swRunning) return;
        const now = getNowMs();
        const totalMs = swElapsed + (now - swStartTime);
        const lapMs = totalMs - swLastLapTime;
        swLastLapTime = totalMs;
        swLaps.push({ num: swLaps.length + 1, lapTime: lapMs, totalTime: totalMs });
        renderLaps();
      }

      function renderLaps() {
        const list = document.getElementById('lapList');
        const msg = document.getElementById('noLapsMsg');
        document.getElementById('swLapCount').textContent = String(swLaps.length).padStart(2, '0');

        if (swLaps.length === 0) {
          if (msg) msg.style.display = 'block';
          list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--on-surface-variant);opacity:.5" id="noLapsMsg">Press ◐ to record a lap</div>';
          document.getElementById('swAvgLap').textContent = '00:00.0';
          return;
        }
        if (msg) msg.style.display = 'none';

        // Calculate avg
        const totalLapMs = swLaps.reduce((sum, l) => sum + l.lapTime, 0);
        const avgMs = totalLapMs / swLaps.length;
        document.getElementById('swAvgLap').textContent = formatLapTime(avgMs);

        // Find fastest and slowest
        let fastestIdx = 0, slowestIdx = 0;
        swLaps.forEach((l, i) => {
          if (l.lapTime < swLaps[fastestIdx].lapTime) fastestIdx = i;
          if (l.lapTime > swLaps[slowestIdx].lapTime) slowestIdx = i;
        });

        // Render in reverse (newest first)
        list.innerHTML = swLaps.slice().reverse().map((l, revIdx) => {
          const origIdx = swLaps.length - 1 - revIdx;
          let rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(63,72,81,.3);font-variant-numeric:tabular-nums;transition:background .2s;';
          let numHtml = '<span style="color:var(--on-surface-variant)">' + String(l.num).padStart(2, '0') + '</span>';
          let timeStyle = 'font-weight:600';
          let timeColor = 'color:var(--on-surface)';

          if (swLaps.length > 1 && origIdx === fastestIdx) {
            rowStyle += 'background:rgba(117,219,149,.06);';
            numHtml = '<span style="color:var(--secondary);font-weight:700">' + String(l.num).padStart(2, '0') + ' ↑</span>';
            timeColor = 'color:var(--secondary)';
            timeStyle += ';font-weight:700';
          } else if (swLaps.length > 1 && origIdx === slowestIdx) {
            rowStyle += 'background:rgba(255,180,171,.08);';
            numHtml = '<span style="color:var(--error);font-weight:700">' + String(l.num).padStart(2, '0') + ' ↓</span>';
            timeColor = 'color:var(--error)';
            timeStyle += ';font-weight:700';
          }

          return '<div style="' + rowStyle + '">' +
            numHtml +
            '<span style="' + timeStyle + ';' + timeColor + '">' + formatLapTime(l.lapTime) + '</span>' +
            '<span style="color:var(--on-surface-variant);font-size:14px">' + formatLapTime(l.totalTime) + '</span>' +
            '</div>';
        }).join('');
      }

      function clearLaps() {
        swLaps = [];
        swLastLapTime = swElapsed + (swRunning ? (getNowMs() - swStartTime) : 0);
        renderLaps();
      }

      renderLaps();
      // Ensure stopwatch buttons always have handlers, even if inline handlers are blocked
      const swStartBtn = document.getElementById('swStartBtn');
      const swResetBtn = document.getElementById('swResetBtn');
      const swLapBtn = document.getElementById('swLapBtn');
      if (swStartBtn) swStartBtn.addEventListener('click', toggleStopwatch);
      if (swResetBtn) swResetBtn.addEventListener('click', resetStopwatch);
      if (swLapBtn) swLapBtn.addEventListener('click', addLap);
      
      // ===== SETTINGS =====
      function openSettings() {
        document.getElementById('settingsOverlay').classList.add('active');
        document.getElementById('themeDarkBtn').classList.toggle('active', currentTheme === 'dark');
        document.getElementById('themeLightBtn').classList.toggle('active', currentTheme === 'light');
        document.getElementById('fmt12Btn').classList.toggle('active', clockFormat === '12');
        document.getElementById('fmt24Btn').classList.toggle('active', clockFormat === '24');
        document.querySelectorAll('.accent-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === currentAccent));
        // Reset search and rebuild timezone list
        const tzInp = document.getElementById('tzSearchInput');
        if (tzInp) tzInp.value = '';
        _buildTzSelect('');
      }
      function closeSettings() {
        document.getElementById('settingsOverlay').classList.remove('active');
      }
      function setTheme(t) {
        currentTheme = t;
        localStorage.setItem('clockly_theme', t);
        document.documentElement.classList.toggle('light', t === 'light');
        document.getElementById('themeDarkBtn').classList.toggle('active', t === 'dark');
        document.getElementById('themeLightBtn').classList.toggle('active', t === 'light');
        // Re-apply the correct accent primary for the new theme
        const darkPrimary    = localStorage.getItem('clockly_accent_primary');
        const darkOnPrimary  = localStorage.getItem('clockly_accent_onPrimary');
        const lightPrimary   = localStorage.getItem('clockly_accent_light_primary');
        const lightOnPrimary = localStorage.getItem('clockly_accent_light_onPrimary');
        if (t === 'light' && lightPrimary) {
          document.documentElement.style.setProperty('--primary', lightPrimary);
          document.documentElement.style.setProperty('--on-primary', lightOnPrimary || '#ffffff');
        } else if (darkPrimary) {
          document.documentElement.style.setProperty('--primary', darkPrimary);
          if (darkOnPrimary) document.documentElement.style.setProperty('--on-primary', darkOnPrimary);
        } else {
          // No saved accent — clear inline override so CSS variables take effect
          document.documentElement.style.removeProperty('--primary');
          document.documentElement.style.removeProperty('--on-primary');
        }
      }
      function setClockFormat(f) {
        clockFormat = f;
        localStorage.setItem('clockly_fmt', f);
        document.getElementById('fmt12Btn').classList.toggle('active', f === '12');
        document.getElementById('fmt24Btn').classList.toggle('active', f === '24');
        updateClock();
      }
      function setTimezone(tz) {
        if (!tz) return;
        currentTimezone = tz;
        localStorage.setItem('clockly_tz', tz);
        updateClock();
        const lbl = document.getElementById('tzCurrentLabel');
        if (lbl) lbl.textContent = 'Selected: ' + tz.replace(/_/g,' ');
      }
      function setAccent(name, primary, onPrimary, lightPrimary, lightOnPrimary) {
        currentAccent = name;
        localStorage.setItem('clockly_accent', name);
        localStorage.setItem('clockly_accent_primary', primary);
        localStorage.setItem('clockly_accent_onPrimary', onPrimary);
        if (lightPrimary) {
          localStorage.setItem('clockly_accent_light_primary', lightPrimary);
          localStorage.setItem('clockly_accent_light_onPrimary', lightOnPrimary || '#ffffff');
        }
        const ap = currentTheme === 'light' && lightPrimary ? lightPrimary : primary;
        const aop = currentTheme === 'light' && lightOnPrimary ? lightOnPrimary : onPrimary;
        document.documentElement.style.setProperty('--primary', ap);
        document.documentElement.style.setProperty('--on-primary', aop);
        document.querySelectorAll('.accent-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === name));
      }
      // Restore settings on load
      (function applySettings() {
        if (currentTheme === 'light') document.documentElement.classList.add('light');
        const darkPrimary    = localStorage.getItem('clockly_accent_primary');
        const darkOnPrimary  = localStorage.getItem('clockly_accent_onPrimary');
        const lightPrimary   = localStorage.getItem('clockly_accent_light_primary');
        const lightOnPrimary = localStorage.getItem('clockly_accent_light_onPrimary');
        if (currentTheme === 'light' && lightPrimary) {
          document.documentElement.style.setProperty('--primary', lightPrimary);
          document.documentElement.style.setProperty('--on-primary', lightOnPrimary || '#ffffff');
        } else if (darkPrimary) {
          document.documentElement.style.setProperty('--primary', darkPrimary);
          if (darkOnPrimary) document.documentElement.style.setProperty('--on-primary', darkOnPrimary);
        }
      })();
      // Wire settings button and overlay close
      const settingsBtn = document.querySelector('.header-actions button:last-child');
      if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
      const settingsCloseBtn = document.getElementById('settingsCloseBtn');
      if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
      document.getElementById('settingsOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
      // Timezone search filter
      const tzSearchInput = document.getElementById('tzSearchInput');
      if (tzSearchInput) tzSearchInput.addEventListener('input', e => _buildTzSelect(e.target.value));

      // ===== INPUT VALIDATION =====
      const alarmHourEl = document.getElementById('alarmHour');
      const alarmMinEl = document.getElementById('alarmMinute');
      const timerHEl = document.getElementById('timerH');
      const timerMEl = document.getElementById('timerM');
      const timerSEl = document.getElementById('timerS');
      
      const _navKeys = new Set(['ArrowLeft','ArrowRight','Tab','Home','End','Enter']);
      const _allowKey = e => /[0-9]/.test(e.key) || _navKeys.has(e.key) || e.key === 'Backspace' || e.key === 'Delete' || e.ctrlKey || e.metaKey;

      if (alarmHourEl) {
        alarmHourEl.addEventListener('blur', () => validateAlarmInput('hour'));
        alarmHourEl.addEventListener('keydown', e => {
          if (e.key === 'ArrowUp')   { e.preventDefault(); adjustAlarmPicker('hour',  1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustAlarmPicker('hour', -1); }
          else if (!_allowKey(e))    { e.preventDefault(); }
        });
      }
      if (alarmMinEl) {
        alarmMinEl.addEventListener('blur', () => validateAlarmInput('minute'));
        alarmMinEl.addEventListener('keydown', e => {
          if (e.key === 'ArrowUp')   { e.preventDefault(); adjustAlarmPicker('minute',  1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustAlarmPicker('minute', -1); }
          else if (!_allowKey(e))    { e.preventDefault(); }
        });
      }
      if (timerHEl) {
        timerHEl.addEventListener('blur', () => validateTimer('h'));
        timerHEl.addEventListener('keydown', e => {
          if (e.key === 'ArrowUp')   { e.preventDefault(); adjustTimer('h',  1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustTimer('h', -1); }
          else if (!_allowKey(e))    { e.preventDefault(); }
        });
      }
      if (timerMEl) {
        timerMEl.addEventListener('blur', () => validateTimer('m'));
        timerMEl.addEventListener('keydown', e => {
          if (e.key === 'ArrowUp')   { e.preventDefault(); adjustTimer('m',  1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustTimer('m', -1); }
          else if (!_allowKey(e))    { e.preventDefault(); }
        });
      }
      if (timerSEl) {
        timerSEl.addEventListener('blur', () => validateTimer('s'));
        timerSEl.addEventListener('keydown', e => {
          if (e.key === 'ArrowUp')   { e.preventDefault(); adjustTimer('s',  1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustTimer('s', -1); }
          else if (!_allowKey(e))    { e.preventDefault(); }
        });
      }
      
      // ===== TASKS =====
      let tasks = JSON.parse(localStorage.getItem('clockly_tasks') || '[]');
      let tasksOpen = JSON.parse(localStorage.getItem('clockly_tasks_open') || 'true');

      function saveTasks() {
        localStorage.setItem('clockly_tasks', JSON.stringify(tasks));
      }

      function renderTasks() {
        // Render to sidebar panel
        const list = document.getElementById('taskList');
        const badge = document.getElementById('tasksBadge');
        const footer = document.getElementById('tasksFooterCount');
        // Render to page (mobile)
        const listPage = document.getElementById('taskListPage');
        const pageCount = document.getElementById('tasksPageCount');

        const remaining = tasks.filter(t => !t.done).length;
        if (badge) badge.textContent = remaining > 0 ? remaining : tasks.length;
        if (footer) footer.textContent = remaining + ' remaining';
        if (pageCount) pageCount.textContent = remaining + ' remaining';

        const emptyHtml = '<div class="tasks-empty">No tasks yet. Add one above!</div>';
        const itemsHtml = tasks.length === 0 ? emptyHtml : tasks.map(t => `
          <div class="task-item${t.done ? ' done' : ''}">
            <label class="task-checkbox-wrap" title="${t.done ? 'Mark incomplete' : 'Mark complete'}">
              <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTask(${t.id})" />
              <span class="task-checkbox-vis"></span>
            </label>
            <span class="task-text">${escapeHtml(t.text)}</span>
            <button class="task-del-btn" onclick="deleteTask(${t.id})" title="Delete task">✕</button>
          </div>`).join('');

        if (list) list.innerHTML = itemsHtml;
        if (listPage) listPage.innerHTML = itemsHtml;
      }

      function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function addTask(sourceId) {
        const inputId = sourceId || 'taskInput';
        const input = document.getElementById(inputId);
        if (!input) return;
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        tasks.unshift({ id: Date.now(), text, done: false });
        input.value = '';
        input.focus();
        saveTasks(); renderTasks();
      }

      function toggleTask(id) {
        const t = tasks.find(x => x.id === id);
        if (t) { t.done = !t.done; saveTasks(); renderTasks(); }
      }

      function deleteTask(id) {
        tasks = tasks.filter(x => x.id !== id);
        saveTasks(); renderTasks();
      }

      function clearDoneTasks() {
        tasks = tasks.filter(x => !x.done);
        saveTasks(); renderTasks();
      }

      function applyTasksPanelState() {
        const body = document.getElementById('tasksBody');
        const chev = document.getElementById('tasksChevron');
        if (body) body.classList.toggle('open', tasksOpen);
        if (chev) chev.classList.toggle('open', tasksOpen);
      }

      const tasksPanelToggle = document.getElementById('tasksPanelToggle');
      if (tasksPanelToggle) {
        tasksPanelToggle.addEventListener('click', () => {
          tasksOpen = !tasksOpen;
          localStorage.setItem('clockly_tasks_open', JSON.stringify(tasksOpen));
          applyTasksPanelState();
        });
      }

      const taskAddBtn = document.getElementById('taskAddBtn');
      const taskInputEl = document.getElementById('taskInput');
      if (taskAddBtn) taskAddBtn.addEventListener('click', () => addTask('taskInput'));
      if (taskInputEl) taskInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') addTask('taskInput'); });

      // Page (mobile) task input
      const taskAddBtnPage = document.getElementById('taskAddBtnPage');
      const taskInputPageEl = document.getElementById('taskInputPage');
      if (taskAddBtnPage) taskAddBtnPage.addEventListener('click', () => addTask('taskInputPage'));
      if (taskInputPageEl) taskInputPageEl.addEventListener('keydown', e => { if (e.key === 'Enter') addTask('taskInputPage'); });

      const clearDoneBtn = document.getElementById('tasksClearDone');
      if (clearDoneBtn) clearDoneBtn.addEventListener('click', clearDoneTasks);
      const clearDoneBtnPage = document.getElementById('tasksClearDonePage');
      if (clearDoneBtnPage) clearDoneBtnPage.addEventListener('click', clearDoneTasks);

      // Init tasks panel
      applyTasksPanelState();
      renderTasks();

      // Expose key functions to the global scope to ensure inline handlers work across environments
      window.toggleStopwatch = toggleStopwatch;
      window.addLap = addLap;
      window.resetStopwatch = resetStopwatch;
      window.clearLaps = clearLaps;
      window.setTimerPreset = setTimerPreset;
      window.toggleTimer = toggleTimer;
      window.resetTimer = resetTimer;
      window.adjustTimer = adjustTimer;
      window.validateTimer = validateTimer;
      window.adjustAlarmPicker = adjustAlarmPicker;
      window.validateAlarmInput = validateAlarmInput;
      window.setAmPm = setAmPm;
      window.toggleDay = toggleDay;
      window.toggleAlarm = toggleAlarm;
      window.deleteAlarm = deleteAlarm;
      window.saveAlarm = saveAlarm;
      window.dismissAlarm = dismissAlarm;
      window.toggleFullscreen = toggleFullscreen;
      window.setTheme = setTheme;
      window.setClockFormat = setClockFormat;
      window.setAccent = setAccent;
      window.toggleTask = toggleTask;
      window.deleteTask = deleteTask;
      window.setTimezone = setTimezone;
      window.toggleCalendar = toggleCalendar;
      window.calNav = calNav;
      });
