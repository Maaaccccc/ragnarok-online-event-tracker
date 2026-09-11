/**
 * Ragnarok Online Event Tracker
 * Timezone: Asia/Manila (UTC+8)
 */

// Application State
const state = {
  eventsData: null,
  activeFilter: 'All',
  timerInterval: null,
  clockInterval: null
};

// Day names mapping
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * UTC+8 Helper Functions
 */

// Get current date object
function getNow() {
  return new Date();
}

// Convert Date object to UTC+8 components
function getUTC8Components(dateObj) {
  // Offset by +8 hours (+480 minutes) relative to UTC
  const shifted = new Date(dateObj.getTime() + (8 * 60 * 60 * 1000));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds()
  };
}

// Create Epoch Milliseconds from UTC+8 date and time components
function createUTC8Timestamp(year, month, date, hours, minutes) {
  return Date.UTC(year, month, date, hours - 8, minutes, 0, 0);
}

// Format time in 12-hour AM/PM format (e.g. "8:00 PM")
function formatTime12H(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = minutes < 10 ? `0${minutes}` : minutes;
  return `${displayHours}:${displayMinutes} ${period}`;
}

// Format date string in UTC+8 (e.g. "Sep 11, 2026")
function formatDateString(year, month, date) {
  return `${MONTHS_SHORT[month]} ${date}, ${year}`;
}

// Format relative date string for upcoming event card (e.g., "Today, 8:00 PM")
function formatRelativeDateTime(startMs, nowMs) {
  const occComp = getUTC8Components(new Date(startMs));
  const nowComp = getUTC8Components(new Date(nowMs));

  const timeStr = formatTime12H(occComp.hours, occComp.minutes);

  // Check if same calendar day in UTC+8
  if (occComp.year === nowComp.year && occComp.month === nowComp.month && occComp.date === nowComp.date) {
    return `Today, ${timeStr}`;
  }

  // Check if tomorrow in UTC+8
  const tomorrowMs = nowMs + (24 * 60 * 60 * 1000);
  const tomorrowComp = getUTC8Components(new Date(tomorrowMs));
  if (occComp.year === tomorrowComp.year && occComp.month === tomorrowComp.month && occComp.date === tomorrowComp.date) {
    return `Tomorrow, ${timeStr}`;
  }

  return `${MONTHS_SHORT[occComp.month]} ${occComp.date}, ${timeStr}`;
}

/**
 * Event Occurrence Generator
 */

function generateOccurrences(nowMs, daysAhead = 14) {
  if (!state.eventsData) return [];

  const occurrences = [];

  // Scan range: 1 day in the past to daysAhead in the future
  for (let offset = -1; offset <= daysAhead; offset++) {
    const calcDate = new Date(nowMs + (offset * 24 * 60 * 60 * 1000));
    const dayComp = getUTC8Components(calcDate);
    const dayOfWeekName = WEEKDAYS[dayComp.dayOfWeek];

    // 1. Process Recurring Events
    const recurringList = state.eventsData.recurring || [];
    recurringList.forEach(event => {
      try {
        if (!event.name || !event.schedule || !event.schedule.type) {
          console.warn('Skipping invalid recurring event:', event);
          return;
        }

        const { type, times, duration = 60, days, intervalDays, startDate } = event.schedule;
        if (!Array.isArray(times) || times.length === 0) return;

        let isMatch = false;

        if (type === 'daily') {
          isMatch = true;
        } else if (type === 'weekly') {
          if (Array.isArray(days) && days.includes(dayOfWeekName)) {
            isMatch = true;
          }
        } else if (type === 'interval') {
          if (intervalDays && startDate) {
            const [sY, sM, sD] = startDate.split('-').map(Number);
            if (!isNaN(sY) && !isNaN(sM) && !isNaN(sD)) {
              const startRefMidnightMs = createUTC8Timestamp(sY, sM - 1, sD, 0, 0);
              const currentMidnightMs = createUTC8Timestamp(dayComp.year, dayComp.month, dayComp.date, 0, 0);
              const diffDays = Math.round((currentMidnightMs - startRefMidnightMs) / (24 * 60 * 60 * 1000));

              if (diffDays >= 0 && diffDays % intervalDays === 0) {
                isMatch = true;
              }
            }
          }
        }

        if (isMatch) {
          times.forEach(timeStr => {
            const [hStr, mStr] = timeStr.split(':');
            const hh = parseInt(hStr, 10);
            const mm = parseInt(mStr, 10);

            if (isNaN(hh) || isNaN(mm)) return;

            const startMs = createUTC8Timestamp(dayComp.year, dayComp.month, dayComp.date, hh, mm);
            const endMs = startMs + (duration * 60 * 1000);

            // Filter out events that ended in the past
            if (endMs > nowMs) {
              const isOngoing = startMs <= nowMs && nowMs < endMs;
              occurrences.push({
                name: event.name,
                category: event.category || 'General',
                type: 'recurring',
                startMs,
                endMs,
                formattedDate: formatDateString(dayComp.year, dayComp.month, dayComp.date),
                formattedStart: formatTime12H(hh, mm),
                formattedEnd: formatTime12H(getUTC8Components(new Date(endMs)).hours, getUTC8Components(new Date(endMs)).minutes),
                status: isOngoing ? 'Ongoing' : 'Upcoming'
              });
            }
          });
        }
      } catch (err) {
        console.warn('Error processing recurring event occurrence:', event, err);
      }
    });
  }

  // Deduplicate and Sort Chronologically
  occurrences.sort((a, b) => a.startMs - b.startMs);
  return occurrences;
}

/**
 * Get Active Special Events
 */
function getActiveSpecialEvents(nowMs) {
  if (!state.eventsData || !Array.isArray(state.eventsData.special)) return [];

  return state.eventsData.special.filter(event => {
    try {
      if (!event.name || !event.start || !event.end) return false;
      const startMs = new Date(event.start).getTime();
      const endMs = new Date(event.end).getTime();
      if (isNaN(startMs) || isNaN(endMs)) return false;

      return nowMs >= startMs && nowMs <= endMs;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Extract Categories for Filters
 */
function extractCategories() {
  const categories = new Set();
  
  if (state.eventsData) {
    if (Array.isArray(state.eventsData.recurring)) {
      state.eventsData.recurring.forEach(e => {
        if (e.category) categories.add(e.category);
      });
    }
    if (Array.isArray(state.eventsData.special)) {
      state.eventsData.special.forEach(e => {
        if (e.category) categories.add(e.category);
      });
    }
  }

  return Array.from(categories).sort();
}

/**
 * Render Filters UI
 */
function renderFilters() {
  const container = document.getElementById('categoryFilters');
  if (!container) return;

  const categories = extractCategories();
  let html = `<button class="filter-btn ${state.activeFilter === 'All' ? 'active' : ''}" data-category="All">All</button>`;

  categories.forEach(cat => {
    const isActive = state.activeFilter === cat;
    html += `<button class="filter-btn ${isActive ? 'active' : ''}" data-category="${cat}">${escapeHtml(cat)}</button>`;
  });

  container.innerHTML = html;

  // Add click listeners
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const selectedCategory = e.target.getAttribute('data-category');
      if (selectedCategory && selectedCategory !== state.activeFilter) {
        state.activeFilter = selectedCategory;
        renderFilters();
        updateEventState(true);
      }
    });
  });
}

/**
 * Render Top Event Status Bar
 */
function renderStatusBar(nowMs, occurrences) {
  // 1. Special Event Card
  const activeSpecial = getActiveSpecialEvents(nowMs);
  const specialContainer = document.getElementById('specialEventContent');
  if (specialContainer) {
    if (activeSpecial.length > 0) {
      specialContainer.innerHTML = activeSpecial.map(e => `
        <div class="status-item">
          <span class="event-name">${escapeHtml(e.name)}</span>
          <span class="event-subtext">${escapeHtml(e.category || 'Special')}</span>
        </div>
      `).join('');
    } else {
      specialContainer.innerHTML = '<div class="status-none">None</div>';
    }
  }

  // 2. Ongoing Events Card (Global ongoing recurring occurrences)
  const ongoingOccurrences = occurrences.filter(o => o.status === 'Ongoing');
  const ongoingContainer = document.getElementById('ongoingEventContent');
  if (ongoingContainer) {
    if (ongoingOccurrences.length > 0) {
      // Remove duplicate ongoing event names if any
      const uniqueOngoingMap = new Map();
      ongoingOccurrences.forEach(o => {
        if (!uniqueOngoingMap.has(o.name)) {
          uniqueOngoingMap.set(o.name, o);
        }
      });

      ongoingContainer.innerHTML = Array.from(uniqueOngoingMap.values()).map(o => `
        <div class="status-item">
          <span class="event-name">${escapeHtml(o.name)}</span>
          <span class="event-subtext">Ends at ${o.formattedEnd}</span>
        </div>
      `).join('');
    } else {
      ongoingContainer.innerHTML = '<div class="status-none">None</div>';
    }
  }

  // 3. Upcoming Event Card (Global next upcoming event)
  const upcomingOccurrence = occurrences.find(o => o.status === 'Upcoming');
  const upcomingContainer = document.getElementById('upcomingEventContent');
  if (upcomingContainer) {
    if (upcomingOccurrence) {
      const relTime = formatRelativeDateTime(upcomingOccurrence.startMs, nowMs);
      upcomingContainer.innerHTML = `
        <div class="status-item">
          <span class="event-name">${escapeHtml(upcomingOccurrence.name)}</span>
          <span class="event-subtext">${escapeHtml(relTime)}</span>
        </div>
      `;
    } else {
      upcomingContainer.innerHTML = '<div class="status-none">None</div>';
    }
  }
}

/**
 * Render Event Table
 */
function renderEventTable(nowMs, occurrences) {
  const tbody = document.getElementById('eventTableBody');
  const tableCountInfo = document.getElementById('tableCountInfo');
  if (!tbody) return;

  // Filter occurrences based on active category
  let filtered = occurrences;
  if (state.activeFilter !== 'All') {
    filtered = occurrences.filter(o => o.category === state.activeFilter);
  }

  // Limit table to showing the top 2 upcoming/ongoing event occurrences
  const displayOccurrences = filtered.slice(0, 2);

  if (displayOccurrences.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">No upcoming events found for category "${escapeHtml(state.activeFilter)}".</td>
      </tr>
    `;
    if (tableCountInfo) {
      tableCountInfo.textContent = `Showing 0 events (${state.activeFilter})`;
    }
    return;
  }

  tbody.innerHTML = displayOccurrences.map(occ => {
    const isOngoing = occ.status === 'Ongoing';
    const pillClass = isOngoing ? 'ongoing' : 'upcoming';
    const pillDot = isOngoing ? '<span class="pulse-dot"></span> ' : '';

    return `
      <tr>
        <td class="col-event">
          ${escapeHtml(occ.name)}
          <span class="col-category">${escapeHtml(occ.category)}</span>
        </td>
        <td class="col-date">${occ.formattedDate}</td>
        <td class="col-time">${occ.formattedStart}</td>
        <td class="col-time">${occ.formattedEnd}</td>
        <td class="col-status">
          <span class="status-pill ${pillClass}">
            ${pillDot}${occ.status}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  if (tableCountInfo) {
    tableCountInfo.textContent = `Showing next ${displayOccurrences.length} event occurrence${displayOccurrences.length === 1 ? '' : 's'} (${state.activeFilter})`;
  }
}

/**
 * Live UTC+8 Clock Update
 */
function updateClock() {
  const now = getNow();
  const comp = getUTC8Components(now);

  const clockTimeEl = document.getElementById('serverClock');
  const clockDateEl = document.getElementById('serverDate');

  if (clockTimeEl) {
    clockTimeEl.textContent = `${formatTime12H(comp.hours, comp.minutes)}:${comp.seconds < 10 ? '0' + comp.seconds : comp.seconds}`;
  }

  if (clockDateEl) {
    clockDateEl.textContent = `${formatDateString(comp.year, comp.month, comp.date)} (${WEEKDAYS[comp.dayOfWeek]})`;
  }
}

/**
 * Main Update Loop
 */
function updateEventState(forceRender = false) {
  const nowMs = getNow().getTime();
  const occurrences = generateOccurrences(nowMs);

  renderStatusBar(nowMs, occurrences);
  renderEventTable(nowMs, occurrences);
}

/**
 * HTML Escaper Helper
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Load Events from events.json
 */
async function loadEvents() {
  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');

  try {
    const response = await fetch('./public/events.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load events.json: HTTP ${response.status}`);
    }

    const data = await response.json();
    state.eventsData = data;

    if (errorBanner) errorBanner.classList.add('hidden');

    // Initialize UI
    renderFilters();
    updateEventState(true);

    // Start periodic background updates (every 10 seconds)
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => updateEventState(false), 10000);

  } catch (err) {
    console.error('Error loading events:', err);
    if (errorBanner && errorMessage) {
      errorMessage.textContent = `Failed to load event data (events.json). ${err.message}`;
      errorBanner.classList.remove('hidden');
    }
  }
}

/**
 * Application Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
  // Start clock timer (1 second interval)
  updateClock();
  state.clockInterval = setInterval(updateClock, 1000);

  // Load events JSON
  loadEvents();
});
