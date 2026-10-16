const SUPABASE_URL = 'https://neudpyltwgimilmjszwp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gJU2Ei21YYlXINBqxg_w_w_kJt0k3PW';
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

async function readPublicRows(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Public summary request failed: ${response.status}`);

    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected public summary response');
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${new Intl.NumberFormat('tr-TR').format(hours)} saat ${String(minutes).padStart(2, '0')} dakika`;
}

function formatMoney(kurus) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
    .format(Math.max(0, Number(kurus) || 0) / 100);
}

async function loadWorkSummary() {
  if (!document.getElementById('public-work-hours')) return;

  try {
    const rows = await readPublicRows(
      'limon_work_summary?select=total_work_seconds,total_break_seconds,session_count&id=eq.true'
    );
    const summary = rows[0];
    if (!summary) {
      setText('public-work-hours', 'Henüz kayıt yok');
      setText('public-break-hours', 'Henüz kayıt yok');
      setText('public-work-state', 'Yönetim panelinden paylaşılmış çalışma oturumu bulunmuyor.');
      return;
    }

    setText('public-work-hours', formatDuration(summary.total_work_seconds));
    setText('public-break-hours', formatDuration(summary.total_break_seconds));
    setText(
      'public-work-state',
      `${Number(summary.session_count) || 0} kayıtlı oturum · yalnızca toplu süreler paylaşılır.`
    );
  } catch {
    setText('public-work-hours', 'Henüz bağlanmadı');
    setText('public-break-hours', 'Henüz bağlanmadı');
    setText('public-work-state', 'Çalışma özeti şu anda yüklenemedi.');
  }
}

async function loadFinanceSummary() {
  if (!document.getElementById('public-income-total')) return;

  try {
    const rows = await readPublicRows(
      'limon_finance_summary?select=income_total_kurus,expense_total_kurus,entry_count&id=eq.true'
    );
    const summary = rows[0];
    if (!summary) {
      setText('public-income-total', 'Henüz kayıt yok');
      setText('public-expense-total', 'Henüz kayıt yok');
      setText('public-finance-count', '0 kayıt');
      return;
    }

    setText('public-income-total', formatMoney(summary.income_total_kurus));
    setText('public-expense-total', formatMoney(summary.expense_total_kurus));
    setText('public-finance-count', `${Number(summary.entry_count) || 0} toplu kayıt`);
  } catch {
    setText('public-income-total', 'Henüz bağlanmadı');
    setText('public-expense-total', 'Henüz bağlanmadı');
    setText('public-finance-count', 'Veri bekleniyor');
  }
}

async function loadAnnouncements() {
  const root = document.getElementById('announcements');
  if (!root) return;

  try {
    const rows = await readPublicRows(
      'limon_announcements?select=title,content&published=eq.true'
    );
    root.replaceChildren();
    if (!rows.length) {
      root.textContent = 'Henüz yayımlanmış duyuru yok.';
      return;
    }

    for (const row of rows) {
      const article = document.createElement('article');
      article.className = 'news-item';
      const body = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = row.title || 'Duyuru';
      const content = document.createElement('p');
      content.textContent = row.content || '';
      body.append(title, content);
      article.append(body);
      root.append(article);
    }
  } catch {
    root.textContent = 'Duyurular şu anda yüklenemedi.';
  }
}

async function initializeAdminStatus() {
  const statusNode = document.getElementById('admin-live-status');
  if (!statusNode) return;

  let generation = 0;
  const hide = () => { statusNode.hidden = true; };
  hide();

  try {
    const { createClient } = await import(SUPABASE_JS_URL);
    const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    async function refresh() {
      const currentGeneration = ++generation;
      hide();
      try {
        const { data: { user }, error } = await client.auth.getUser();
        if (currentGeneration !== generation || error || !user) return;

        const { data: admin, error: adminError } = await client
          .from('limon_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (currentGeneration === generation && !adminError && admin) {
          statusNode.hidden = false;
        }
      } catch {
        hide();
      }
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        generation += 1;
        hide();
        return;
      }
      if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        setTimeout(() => { void refresh(); }, 0);
      }
    });
    void refresh();
  } catch {
    hide();
  }
}

void loadWorkSummary();
void loadFinanceSummary();
void loadAnnouncements();
void initializeAdminStatus();
