/* global supabase */

const STORAGE_KEYS = {
  memberId: "lunch-picker-member-id",
  nickname: "lunch-picker-nickname",
  theme: "lunch-picker-theme",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

let db = null;
let memberId = null;
let nickname = "";
let roomId = null; // YYYY-MM-DD
let restaurants = [];
let votes = [];
let teamMembers = [];
let datesWithOptions = new Set();
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let roomChannel = null;
let teamChannel = null;
let calendarChannel = null;

const $ = (id) => document.getElementById(id);

function getPreferredTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  const btn = $("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

function initTheme() {
  applyTheme(getPreferredTheme());
  $("theme-toggle")?.addEventListener("click", toggleTheme);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

function showScreen(name) {
  ["setup-screen", "calendar-screen", "room-screen"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== `${name}-screen`);
  });
}

function isConfigured() {
  return (
    window.SUPABASE_URL &&
    window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_URL.includes("YOUR_PROJECT") &&
    !window.SUPABASE_ANON_KEY.includes("YOUR_ANON")
  );
}

function initSupabase() {
  if (!isConfigured()) return null;
  return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function getOrCreateMemberId() {
  let id = localStorage.getItem(STORAGE_KEYS.memberId);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.memberId, id);
  }
  return id;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateDisplay(iso) {
  const date = parseDateISO(iso);
  const today = formatDateISO(new Date());
  const label = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return iso === today ? `${label} (Today)` : label;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function saveNickname(name) {
  nickname = name.trim();
  if (!nickname) {
    showToast("Please enter a nickname");
    return false;
  }

  memberId = getOrCreateMemberId();
  localStorage.setItem(STORAGE_KEYS.nickname, nickname);

  const { error } = await db.from("team_members").upsert(
    { member_id: memberId, nickname, updated_at: new Date().toISOString() },
    { onConflict: "member_id" }
  );

  if (error) {
    showToast("Could not save nickname: " + error.message);
    return false;
  }

  return true;
}

async function loadTeamMembers() {
  const { data, error } = await db
    .from("team_members")
    .select("*")
    .order("nickname", { ascending: true });

  if (error) throw error;
  teamMembers = data || [];
  renderTeamList();
}

function renderTeamList() {
  const list = $("team-list");
  const empty = $("team-empty");

  if (teamMembers.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  list.innerHTML = teamMembers
    .map(
      (m) => `
      <li class="team-member${m.member_id === memberId ? " is-me" : ""}">
        <span class="team-avatar">${escapeHtml(m.nickname.charAt(0).toUpperCase())}</span>
        <span class="team-name">${escapeHtml(m.nickname)}${m.member_id === memberId ? " (you)" : ""}</span>
      </li>`
    )
    .join("");
}

async function loadMonthActivity() {
  const start = formatDateISO(new Date(calendarYear, calendarMonth, 1));
  const end = formatDateISO(new Date(calendarYear, calendarMonth + 1, 0));

  const { data, error } = await db
    .from("restaurants")
    .select("room_id")
    .gte("room_id", start)
    .lte("room_id", end);

  if (error) throw error;

  datesWithOptions = new Set((data || []).map((r) => r.room_id));
  renderCalendar();
}

function renderCalendar() {
  $("calendar-title").textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

  const grid = $("calendar-grid");
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const todayISO = formatDateISO(new Date());

  let cells = "";

  for (let i = 0; i < firstDay; i++) {
    cells += `<div class="cal-cell cal-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = formatDateISO(new Date(calendarYear, calendarMonth, day));
    const isToday = iso === todayISO;
    const hasOptions = datesWithOptions.has(iso);
    cells += `
      <button type="button" class="cal-cell cal-day${isToday ? " cal-today" : ""}${hasOptions ? " cal-has-options" : ""}"
        data-date="${iso}" aria-label="${iso}">
        <span class="cal-day-num">${day}</span>
        ${hasOptions ? '<span class="cal-dot"></span>' : ""}
      </button>`;
  }

  grid.innerHTML = cells;
  grid.querySelectorAll("[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => openDateRoom(btn.dataset.date));
  });
}

async function loadRoomData() {
  const [restRes, voteRes] = await Promise.all([
    db.from("restaurants").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
    db.from("votes").select("*").eq("room_id", roomId),
  ]);

  if (restRes.error) throw restRes.error;
  if (voteRes.error) throw voteRes.error;

  restaurants = restRes.data || [];
  votes = voteRes.data || [];
  renderRanking();
}

function getVoteCounts() {
  const counts = {};
  const votersByRestaurant = {};

  for (const vote of votes) {
    counts[vote.restaurant_id] = (counts[vote.restaurant_id] || 0) + 1;
    if (!votersByRestaurant[vote.restaurant_id]) {
      votersByRestaurant[vote.restaurant_id] = [];
    }
    votersByRestaurant[vote.restaurant_id].push(vote.voter_name || "Someone");
  }

  return { counts, votersByRestaurant };
}

function getMyVote() {
  return votes.find((v) => v.voter_id === memberId);
}

function renderRanking() {
  const list = $("restaurant-list");
  const empty = $("empty-state");
  const countBadge = $("option-count");
  const winnerBanner = $("winner-banner");

  countBadge.textContent = String(restaurants.length);

  if (restaurants.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    winnerBanner.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");

  const { counts, votersByRestaurant } = getVoteCounts();
  const myVote = getMyVote();
  const maxVotes = Math.max(0, ...Object.values(counts));

  const sorted = [...restaurants].sort((a, b) => {
    const diff = (counts[b.id] || 0) - (counts[a.id] || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  if (maxVotes > 0) {
    const leader = sorted[0];
    winnerBanner.innerHTML = `<strong>#1 ${escapeHtml(leader.name)}</strong> is leading with ${maxVotes} vote${maxVotes === 1 ? "" : "s"}.`;
    winnerBanner.classList.remove("hidden");
  } else {
    winnerBanner.classList.add("hidden");
  }

  list.innerHTML = sorted
    .map((r, index) => {
      const rank = index + 1;
      const voteCount = counts[r.id] || 0;
      const isMyVote = myVote?.restaurant_id === r.id;
      const voters = (votersByRestaurant[r.id] || []).join(", ");
      const menuText = r.menu || r.menu_text;
      const rankClass = rank === 1 ? " rank-gold" : rank === 2 ? " rank-silver" : rank === 3 ? " rank-bronze" : "";

      return `
        <li class="restaurant-item${rankClass}${isMyVote ? " my-vote" : ""}" data-id="${r.id}">
          <div class="rank-badge">#${rank}</div>
          <div class="restaurant-info">
            <h3>${escapeHtml(r.name)}</h3>
            ${r.added_by ? `<div class="meta">Added by ${escapeHtml(r.added_by)}</div>` : ""}
            ${menuText ? `<p class="menu-text">${escapeHtml(menuText)}</p>` : ""}
            ${r.menu_url ? `<a href="${escapeAttr(r.menu_url)}" target="_blank" rel="noopener noreferrer">View menu link</a>` : ""}
            ${r.notes ? `<p class="notes">${escapeHtml(r.notes)}</p>` : ""}
          </div>
          <div class="restaurant-actions">
            <button type="button" class="btn btn-vote${isMyVote ? " active" : " btn-secondary"}" data-vote="${r.id}">
              ${isMyVote ? "Voted" : "Vote"}
            </button>
            <span class="vote-count">${voteCount} vote${voteCount === 1 ? "" : "s"}</span>
            ${voters ? `<span class="voters-list">${escapeHtml(voters)}</span>` : ""}
            <button type="button" class="btn btn-danger" data-delete="${r.id}">Remove</button>
          </div>
        </li>`;
    })
    .join("");

  list.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", () => handleVote(btn.dataset.vote));
  });

  list.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete));
  });
}

async function handleAdd(e) {
  e.preventDefault();

  const name = $("restaurant-name").value.trim();
  const menuText = $("menu-text").value.trim();
  const menuUrl = $("menu-url").value.trim();
  const notes = $("notes").value.trim();

  if (!name) return;

  const row = {
    room_id: roomId,
    name,
    menu: menuText || null,
    menu_url: menuUrl || null,
    notes: notes || null,
    added_by: nickname || null,
  };

  const { error } = await db.from("restaurants").insert(row);

  if (error) {
    showToast("Could not add restaurant: " + error.message);
    return;
  }

  $("add-form").reset();
  showToast("Restaurant added!");
  await loadRoomData();
}

async function handleVote(restaurantId) {
  const existing = getMyVote();

  if (existing?.restaurant_id === restaurantId) {
    const { error } = await db.from("votes").delete().eq("id", existing.id);
    if (error) {
      showToast("Could not remove vote: " + error.message);
      return;
    }
    showToast("Vote removed");
  } else if (existing) {
    const { error } = await db
      .from("votes")
      .update({ restaurant_id: restaurantId, voter_name: nickname || null })
      .eq("id", existing.id);
    if (error) {
      showToast("Could not change vote: " + error.message);
      return;
    }
    showToast("Vote updated!");
  } else {
    const { error } = await db.from("votes").insert({
      room_id: roomId,
      restaurant_id: restaurantId,
      voter_id: memberId,
      voter_name: nickname || null,
    });
    if (error) {
      showToast("Could not vote: " + error.message);
      return;
    }
    showToast("Vote recorded!");
  }

  await loadRoomData();
}

async function handleDelete(id) {
  if (!confirm("Remove this restaurant from the list?")) return;

  const { error } = await db.from("restaurants").delete().eq("id", id);
  if (error) {
    showToast("Could not remove: " + error.message);
    return;
  }
  showToast("Removed");
  await loadRoomData();
}

function subscribeRoomChanges() {
  if (roomChannel) db.removeChannel(roomChannel);

  roomChannel = db
    .channel(`date:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "restaurants", filter: `room_id=eq.${roomId}` },
      () => loadRoomData()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` },
      () => loadRoomData()
    )
    .subscribe();
}

function subscribeTeamChanges() {
  if (teamChannel) db.removeChannel(teamChannel);

  teamChannel = db
    .channel("team-members")
    .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, () =>
      loadTeamMembers()
    )
    .subscribe();
}

function subscribeCalendarChanges() {
  if (calendarChannel) db.removeChannel(calendarChannel);

  calendarChannel = db
    .channel("calendar-restaurants")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurants" }, () =>
      loadMonthActivity()
    )
    .subscribe();
}

function updateUrl(dateISO) {
  const url = new URL(window.location.href);
  if (dateISO) {
    url.searchParams.set("date", dateISO);
  } else {
    url.searchParams.delete("date");
  }
  window.history.replaceState({}, "", url);
}

async function showCalendar() {
  if (roomChannel) {
    db.removeChannel(roomChannel);
    roomChannel = null;
  }

  roomId = null;
  updateUrl(null);

  $("calendar-nickname").textContent = nickname;
  showScreen("calendar");

  try {
    await Promise.all([loadTeamMembers(), loadMonthActivity()]);
    subscribeTeamChanges();
    subscribeCalendarChanges();
  } catch (err) {
    showToast("Failed to load calendar: " + err.message);
  }
}

async function openDateRoom(dateISO) {
  roomId = dateISO;
  updateUrl(dateISO);

  $("display-date").textContent = formatDateDisplay(dateISO);
  $("room-nickname").textContent = nickname;
  showScreen("room");

  try {
    await loadRoomData();
    subscribeRoomChanges();
  } catch (err) {
    showToast("Failed to load this date: " + err.message);
  }
}

function copyShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("date", roomId);
  navigator.clipboard.writeText(url.toString()).then(
    () => showToast("Link copied! Share with your team."),
    () => showToast("Could not copy link.")
  );
}

async function enterApp() {
  memberId = getOrCreateMemberId();
  nickname = localStorage.getItem(STORAGE_KEYS.nickname) || "";

  const params = new URLSearchParams(window.location.search);
  const dateFromUrl = params.get("date");

  if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl)) {
    await showCalendar();
    await openDateRoom(dateFromUrl);
  } else {
    await showCalendar();
  }
}

function initSetupScreen() {
  if (!isConfigured()) {
    $("config-warning").classList.remove("hidden");
    $("save-nickname").disabled = true;
  }

  const saved = localStorage.getItem(STORAGE_KEYS.nickname);
  if (saved) $("nickname-input").value = saved;

  $("save-nickname").addEventListener("click", async () => {
    if (!window.supabase) {
      showToast("Could not load Supabase. Try another browser or network.");
      return;
    }
    if (!db) {
      showToast("Supabase credentials missing. Re-upload index.html from your PC.");
      return;
    }
    const ok = await saveNickname($("nickname-input").value);
    if (ok) await enterApp();
  });

  $("nickname-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("save-nickname").click();
  });
}

function initCalendarScreen() {
  $("prev-month").addEventListener("click", () => {
    calendarMonth -= 1;
    if (calendarMonth < 0) {
      calendarMonth = 11;
      calendarYear -= 1;
    }
    loadMonthActivity().catch((err) => showToast(err.message));
  });

  $("next-month").addEventListener("click", () => {
    calendarMonth += 1;
    if (calendarMonth > 11) {
      calendarMonth = 0;
      calendarYear += 1;
    }
    loadMonthActivity().catch((err) => showToast(err.message));
  });

  $("go-today").addEventListener("click", () => {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
    loadMonthActivity().catch((err) => showToast(err.message));
  });

  $("edit-nickname").addEventListener("click", () => {
    showScreen("setup");
  });
}

function initRoomScreen() {
  $("add-form").addEventListener("submit", handleAdd);
  $("copy-link").addEventListener("click", copyShareLink);
  $("back-to-calendar").addEventListener("click", () => {
    showCalendar().catch((err) => showToast(err.message));
  });
}

async function boot() {
  initTheme();
  initSetupScreen();
  initCalendarScreen();
  initRoomScreen();

  db = initSupabase();
  memberId = getOrCreateMemberId();
  nickname = localStorage.getItem(STORAGE_KEYS.nickname) || "";

  if (!db || !isConfigured()) return;

  if (nickname) {
    await db.from("team_members").upsert(
      { member_id: memberId, nickname, updated_at: new Date().toISOString() },
      { onConflict: "member_id" }
    );
    await enterApp();
  }
}

boot();
