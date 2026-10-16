#!/usr/bin/env python3
"""Limon static release checks. Run: python limon_kontrol.py"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
errors = []
warnings = []

def check(condition, message):
    (warnings if condition else errors).append(message) if not condition else None

def require(filename):
    path = ROOT / filename
    if not path.is_file():
        errors.append(f"Eksik dosya: {filename}")
        return ""
    return path.read_text(encoding="utf-8")

index = require("index.html")
admin = require("admin.html")
test_panel = require("test-panel.html")
robots = require("robots.txt")
sitemap = require("sitemap.xml")
work_migration = require("supabase/migrations/20261017050000_limon_worklog_finance.sql")
package_migration = require("supabase/migrations/20261017050100_limon_package_activation_admin_only.sql")
rpc_migration = require("supabase/migrations/20261017050200_limon_security_audit_rpc.sql")
gallery_page = require("limondan-kalanlar.html")
game_page = require("oyun.html")
journal_page = require("gelistirme-gunlugu.html")
support_page = require("destek.html")
legal_page = require("yasal-seffaflik.html")
legacy_path = ROOT / "legacy-index.html"
legacy_index = legacy_path.read_text(encoding="utf-8") if legacy_path.is_file() else ""
live_js = require("assets/site-live.js")

production_pages = {
    "index.html": index,
    "limondan-kalanlar.html": gallery_page,
    "oyun.html": game_page,
    "gelistirme-gunlugu.html": journal_page,
    "destek.html": support_page,
    "yasal-seffaflik.html": legal_page,
}
public_html = "\n".join(production_pages.values())

if index:
    if not re.search(r"\bconst\s+PREREG_ENABLED\s*=\s*false\s*;", index):
        errors.append("Ön kayıt kapalı değil veya durum doğrulanamıyor.")
    for route in ("limondan-kalanlar.html", "oyun.html", "gelistirme-gunlugu.html", "destek.html", "yasal-seffaflik.html"):
        if route not in index:
            errors.append(f"Ana sayfa çok sayfalı rotaya bağlanmıyor: {route}")
    if "legacy-index.html" in index:
        errors.append("Noindex geri dönüş kopyası ana gezinmede yayımlanmış.")
    if not all(x in index for x in ("id=\"admin-live-status\"", "id=\"public-work-hours\"", "id=\"public-break-hours\"", "id=\"paw-status\"", "id=\"limon-reaction\"")):
        errors.append("Ana sayfada doğrulanmış admin durumu, toplu çalışma özeti veya istenen etkileşim eksik.")
    support = re.search(r'<section id="destek"[^>]*>([\s\S]*?)</section>', index)
    if not support:
        errors.append("Ana sayfada destek alanına giden görünür bağlantı/teaser bulunamadı.")
    elif re.search(r'<form|checkout|createPayment|buyNow|purchase', support.group(1), re.I):
        errors.append("Ana sayfa destek teaser’ında kapalı olması gereken ödeme eylemi bulundu.")
    if "roadmap-tour" in public_html or "initializeRoadmapTour" in public_html:
        errors.append("Kaldırılması istenen rota turu düğmesi/kodu hâlâ mevcut.")
    for removed_copy in ("Bunlar yol haritası hedefleridir; oyun, bakım, bildirim, fotoğraf/video yükleme ve ses kaydı şu anda mevcut değildir.",
                         "İlk kayıt: 15 Ekim 2026, 17.30.",
                         "Çalışma süresi: doğrulanmış toplam saat kaydı yok.",
                         "Henüz kesinleşmiş yayın tarihi bulunmuyor.",
                         "Bu sayaç başlangıçtan bu yana geçen takvim süresidir; net çalışma saati değildir."):
        if removed_copy in public_html:
            errors.append(f"Kaldırılması istenen alt metin hâlâ sitede: {removed_copy[:55]}")
    if "çıktığımız yolculuk" in public_html or "Amacımız" in public_html or "hedefliyoruz" in public_html:
        errors.append("Tek geliştirici anlatımında çoğul özne kalmış.")
    if not all(x in live_js for x in ("client.auth.getUser()", "limon_admins", "limon_work_summary", "limon_finance_summary", "limon_announcements", "published=eq.true")):
        errors.append("Yeni sayfalardaki admin doğrulaması veya salt-okunur toplu veri bağlantısı eksik.")
    if not all(x in journal_page for x in ("id=\"announcements\"", "journal-chapter", "journal-title", "journal-copy")):
        errors.append("Geliştirme günlüğünde duyuru alanı veya etkileşimli hikâye kitabı eksik.")
    if not all(x in index for x in ("public-work-hours", "public-break-hours", "15 Ekim 2026")):
        errors.append("Ana sayfada başlangıç tarihi veya çalışma/mola toplam alanı eksik.")
    if not all(x in support_page for x in ("Kasa şimdilik boş", "public-income-total", "public-expense-total", "public-finance-count", "Ödeme şu an kapalı")):
        errors.append("Destek sayfasında boş kasa, toplu finans özeti veya kapalı ödeme durumu eksik.")
    if re.search(r'<form|checkout|createPayment|buyNow|purchase', support_page, re.I):
        errors.append("Destek sayfasında kapalı olması gereken satın alma/ödeme eylemi bulundu.")
    if "limon-pre-register" in public_html or re.search(r'<form[^>]*id=["\']prereg-form', public_html, re.I):
        errors.append("Ön kayıt kapalı olmasına rağmen üretim sayfalarında kayıt formu/endpoint bulundu.")
    if any(marker in public_html for marker in ("V0 önizlemesi", "preview-banner")):
        errors.append("Üretim sayfalarında V0 önizleme işareti kaldı.")
    if "noindex" in public_html:
        errors.append("Üretim sayfalarından biri noindex olarak kaldı.")
    if "Kasa şimdilik boş" not in support_page:
        errors.append("Destek kasasının boş olduğu açıkça belirtilmiyor.")
    if not all(x in admin for x in ("finance-demo-form", "support-cat-demo-button", "kaydedilmedi", "admin-work-bootstrap", "sleep_seconds")):
        errors.append("Yerel finans/kedi simülasyonu veya uyku ayrımlı başlangıç kaydı eksik.")
    if "db.from('limon_finance_entries').insert" not in admin:
        errors.append("Gerçek gider yazma akışı beklenmedik biçimde eksik.")
    if any(table in public_html + live_js for table in ("limon_work_sessions", "limon_finance_entries")):
        errors.append("Kamuya açık sayfa özel çalışma/finans satırlarını doğrudan sorguluyor.")
    if not all(table in live_js for table in ("limon_work_summary", "limon_finance_summary")):
        errors.append("Kamuya yalnızca toplu veri sunan kaynak bağlantısı eksik.")
    forbidden_gallery_numbers = {6, 8, 9, 12}
    production_gallery_assets = "\n".join((index, gallery_page))
    for number in forbidden_gallery_numbers:
        if re.search(rf"(?:assets/)?images/limon-{number:02}\.jpg", production_gallery_assets):
            errors.append(f"Galeride yasaklı fotoğraf var: limon-{number:02}.jpg")
    for route, content in production_pages.items():
        if content and ('rel="canonical"' not in content or 'preview-banner' in content or 'V0 önizlemesi' in content):
            errors.append(f"Üretim rotasının canonical/preview durumu hatalı: {route}")
    if legacy_index and 'name="robots" content="noindex,follow"' not in legacy_index:
        errors.append("Yerel eski ana sayfa kopyası arama motorlarından gizlenmemiş.")
    for route in production_pages:
        if f"https://routermurti.github.io/limon/{'' if route == 'index.html' else route}" not in sitemap:
            errors.append(f"Sitemap üretim rotasını içermiyor: {route}")

for name, content in (("index.html", index), ("admin.html", admin)):
    if not content:
        continue
    if re.search(r"sb_secret_[A-Za-z0-9_-]+", content):
        errors.append(f"{name}: Supabase gizli anahtar tespit edildi.")
    if re.search(r"(?i)(?:SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|TURNSTILE_SECRET_KEY)\s*[:=]\s*['\"][^'\"]+['\"]", content):
        errors.append(f"{name}: sunucu sırrı olabilecek değer bulundu.")

if admin and "signOut" not in admin:
    warnings.append("Yönetici çıkış fonksiyonu doğrulanamadı.")
if admin:
    if not re.search(r"async function verify\(options=\{\}\)[\s\S]*?db\.auth\.getUser\(\)[\s\S]*?from\(['\"]limon_admins['\"]\)[\s\S]*?showApp", admin):
        errors.append("Yönetim paneli sunucu oturumu ve üyelik doğrulanmadan açılabilir.")
    if not re.search(r"onAuthStateChange\([\s\S]*?SIGNED_OUT[\s\S]*?showLogin", admin):
        errors.append("Yönetim paneli oturum kapanışında ekranı kapatmıyor.")
    if "verify({preserveView:true})" not in admin or not re.search(r"async function verify\(options=\{\}\)[\s\S]*?if\(!preserveView\)clearProtectedView\(\)", admin):
        errors.append("Token yenilemesi sırasında doğrulanmış admin panelini koruyan, üyeliği yeniden denetleyen akış eksik.")
    if "tests/admin-auth-refresh.test.mjs" not in admin and not (ROOT / "tests/admin-auth-refresh.test.mjs").is_file():
        errors.append("Admin token yenileme regresyon testi eksik.")
    if "assets/admin-work-clock.js" not in admin or not (ROOT / "assets/admin-work-clock.js").is_file():
        errors.append("Admin çalışma saati yardımcı modülü eksik.")
    if not all(token in admin for token in ("work-activity-dialog", "work-check-sound", "visibilitychange", "ACTIVITY_CHECK_TIMEOUT_MS")):
        errors.append("Admin çalışma sayacı etkinlik kontrolü akışı eksik.")
    if not (ROOT / "tests/admin-work-clock.test.mjs").is_file():
        errors.append("Admin çalışma saati regresyon testi eksik.")
if test_panel:
    audit = re.search(r"async function runAudit\([\s\S]*?\n\}", test_panel)
    login_start = test_panel.find("$('login-form').addEventListener")
    login_end = test_panel.find("$('run-audit').addEventListener", login_start)
    login_handler = test_panel[login_start:login_end] if login_start >= 0 and login_end >= 0 else ""
    if not audit:
        errors.append("Test panelinde yönetici kapısı doğrulanamadı.")
    else:
        body = audit.group(0)
        checks = [body.find("db.auth.getUser()"), body.find("from('limon_admins')"),
                  body.find("if(!adminRow)"), body.find("$('dashboard').classList.remove('hidden')")]
        if any(position < 0 for position in checks) or checks != sorted(checks):
            errors.append("Test paneli dashboard'u güncel kullanıcı ve admin üyeliği doğrulanmadan açabilir.")
    if "$('dashboard').classList.remove('hidden')" in login_handler:
        errors.append("Test paneli giriş işleyicisi doğrulamadan dashboard'u açıyor.")
    if not re.search(r"function hideDashboard\([\s\S]*?verifiedUserId=null[\s\S]*?classList\.add\('hidden'\)[\s\S]*?clearResults\(\)", test_panel):
        errors.append("Test paneli yetki kaybında hassas sonuçları temizlemiyor.")
    if not re.search(r"onAuthStateChange\([\s\S]*?hideDashboard", test_panel):
        errors.append("Test paneli oturum değişikliğinde dashboard'u kapatmıyor.")
    if not all(token in test_panel for token in ("classifyRpcError", "PGRST202", "revalidateAdminAfterRefresh", "TOKEN_REFRESHED")):
        errors.append("Test paneli eksik RPC yanıtını veya token yenilemesinde admin yetkisini doğru denetlemiyor.")
    for table in ("limon_work_sessions", "limon_finance_entries"):
        if table not in test_panel:
            errors.append(f"Test paneli anonim okuma testine {table} tablosunu eklemiyor.")
if admin:
    if not all(token in admin for token in ("data-tab=\"worklog\"", "data-tab=\"finance\"", "limon_work_sessions", "limon_finance_entries")):
        errors.append("Yönetici çalışma günlüğü/finans modülü doğrulanamıyor.")
    if "is_active:false" not in admin:
        errors.append("Yeni paketler pasif varsayılan değil.")
    if "IYZICO_SECRET_KEY" in admin and "sb_secret_" in admin:
        errors.append("Admin HTML içinde gizli Supabase anahtarı tespit edildi.")

if "work_seconds <= 172800" not in work_migration:
    errors.append("Başlangıç çalışma kaydı 24 saati aşıyor ancak migration sınırı genişletilmemiş.")
if "total_sleep_seconds" in work_migration:
    errors.append("Uyku süresi kamuya açık özet toplamına sızıyor.")

for table, policy in (("limon_work_sessions", "limon_admins_manage_work_sessions_v1"),
                      ("limon_finance_entries", "limon_admins_manage_finance_entries_v1")):
    if not re.search(rf"ALTER TABLE public\.{table} ENABLE ROW LEVEL SECURITY", work_migration):
        errors.append(f"{table}: RLS açılışı migration'da yok.")
    if policy not in work_migration or "limon_admin_can_manage_limon_records_v1()" not in work_migration:
        errors.append(f"{table}: admin-only politika doğrulanamıyor.")
    if f"REVOKE ALL ON TABLE public.{table} FROM PUBLIC, anon" not in work_migration:
        errors.append(f"{table}: anon/PUBLIC tablo yetkisi iptal edilmiyor.")
for table, policy in (("limon_work_summary", "public_read_work_totals_v1"),
                      ("limon_finance_summary", "public_read_finance_totals_v1")):
    if not re.search(rf"ALTER TABLE public\.{table} ENABLE ROW LEVEL SECURITY", work_migration) or policy not in work_migration:
        errors.append(f"{table}: kamuya yalnızca özet açan RLS kuralı doğrulanamıyor.")
if "c.relrowsecurity" not in package_migration or "Existing package UPDATE/ALL policy found" not in package_migration:
    errors.append("Paket etkinleştirme migration'ı güvenli RLS/politika kapısını içermiyor.")
if "GRANT UPDATE (is_active)" not in package_migration or "limon_admins_manage_package_status_v1" not in package_migration:
    errors.append("Paket durumu admin-only kolon yetkisi/politikası doğrulanamıyor.")

if rpc_migration:
    for token in (
        "CREATE OR REPLACE FUNCTION public.limon_is_admin()",
        "CREATE OR REPLACE FUNCTION public.limon_security_audit()",
        "REVOKE ALL ON FUNCTION public.limon_is_admin() FROM PUBLIC, anon",
        "REVOKE ALL ON FUNCTION public.limon_security_audit() FROM PUBLIC, anon",
        "GRANT EXECUTE ON FUNCTION public.limon_is_admin() TO authenticated",
        "GRANT EXECUTE ON FUNCTION public.limon_security_audit() TO authenticated",
        "IF auth.uid() IS NULL OR NOT public.limon_is_admin()",
        "pg_catalog.pg_policies",
        "pg_catalog.pg_indexes",
    ):
        if token not in rpc_migration:
            errors.append(f"RPC güvenlik migration'ı beklenen kontrolü içermiyor: {token}")
    if re.search(r"\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b", rpc_migration, re.I):
        errors.append("RPC güvenlik migration'ında veri kaybı oluşturabilecek ifade bulundu.")
if not (ROOT / "tests/supabase-security-rpcs.test.mjs").is_file():
    errors.append("Supabase RLS/RPC güvenlik regresyon testi eksik.")
elif test_panel and not all(token in test_panel for token in ("db.rpc('limon_is_admin')", "db.rpc('limon_security_audit')", "anonDb.rpc('limon_security_audit')")):
    errors.append("Test paneli canlıdaki admin RPC'lerini ve anonim erişim reddini sınamıyor.")

if robots and not any(rule in robots for rule in ("Disallow: /admin.html", "Disallow: /limon/admin.html")):
    warnings.append("robots.txt yönetici panelini hariç tutmuyor.")
if sitemap and "admin.html" in sitemap:
    errors.append("Yönetici paneli sitemap.xml içinde.")

print(f"Limon statik kontrol: {len(errors)} hata, {len(warnings)} uyarı")
for msg in errors:
    print("HATA:", msg)
for msg in warnings:
    print("UYARI:", msg)
print("Not: Bu test sunucu RLS, ödeme ve Edge Function güvenliğini doğrulamaz.")
sys.exit(1 if errors else 0)
