#!/bin/bash
# hoosh-watchdog.sh — نگهبان سرور توسعهٔ هوش (خودترمیم بعد از OOM)
# WHY: سرور next-server در سندباکس (۴GB RAM) هنگام کامپایل/هیدریشن کامل
# به ~۳GB می‌رسد و OOM-kill می‌شود. کش Turbopack پایدار می‌ماند، پس هر
# restart سریع‌تر بالا می‌آید تا بالاخره همهٔ مسیرها کش شوند و پایدار شود.
# این نگهبان فقط زیرساخت است (مشابه start.sh سندباکس) — نه کرون‌جاب اپ.
# Mini-services (۳۰۳۱/۳۰۳۲) توسط dev-services.sh به‌صورت idempotent مدیریت می‌شوند.
#
# FIX(v13): گرم‌کردن تدریجی مسیرهای حیاتی — کامپایل تنبل (lazy) در میانهٔ
# کارِ کاربر، سقوط OOM و «در ۹۰٪ گیرکردن ایمپورت» را می‌ساخت. الگوریتم:
# لیست ماندگار مسیرهای گرم‌شده (/tmp) + در هر بوت فقط وقتی ادامه می‌دهیم
# که حافظه ≥۷۰۰MB باشد؛ اگر کم شد صبر/توقف — restart طبیعی بعدی از همان
# جا ادامه می‌دهد (کش Turbopack می‌ماند) تا همهٔ مسیرها گرم و سرور پایدار شود.

LOCK=/tmp/hoosh-watchdog.lock
LOG=/home/z/my-project/watchdog.log
WARMED=/tmp/hoosh-warmed.flag
WARM_LIST=/tmp/hoosh-warmed.list

# جلوگیری از نمونهٔ دوم
if [ -f "$LOCK" ] && kill -0 "$(cat $LOCK 2>/dev/null)" 2>/dev/null; then
  echo "watchdog already running (pid $(cat $LOCK))" >> /dev/stderr
  exit 0
fi
echo $$ > "$LOCK"

cd /home/z/my-project || exit 1

echo "[$(date '+%F %H:%M:%S')] watchdog started (pid $$)" >> "$LOG"

health() {
  curl -s -o /dev/null -w "%{http_code}" -m 300 "http://127.0.0.1:3000/api/health" 2>/dev/null
}

avail_mb() {
  awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 9999
}

start_dev() {
  echo "[$(date '+%F %H:%M:%S')] starting dev server..." >> "$LOG"
  (
    cd /home/z/my-project
    setsid bash -c 'NODE_OPTIONS="--max-old-space-size=1024" TURBOPACK_MAX_WORKERS=1 NEXT_TELEMETRY_DISABLED=1 bash scripts/dev-services.sh; exec bunx next dev -p 3000 -H 0.0.0.0 2>&1 | tee dev.log' \
      > /dev/null 2>&1 < /dev/null &
  )
}

# صبر برای حافظهٔ کافی — حداکثر max_wait×15 ثانیه؛ خروجی 0 اگر رسید
wait_for_mem() {
  local min_mb="$1"
  local max_wait="${2:-8}"
  local health_fails=0
  for i in $(seq 1 "$max_wait"); do
    local code
    code=$(health) || code="000"
    if [ "$code" != "200" ]; then
      health_fails=$((health_fails + 1))
      # تا ۶ شکست پیاپی (≈ چند دقیقه کامپایل) تحمل کن — نه فوراً return 1
      if [ "$health_fails" -ge 6 ]; then return 1; fi
      sleep 15
      continue
    fi
    health_fails=0
    local avail=$(avail_mb)
    [ "$avail" -ge "$min_mb" ] && return 0
    sleep 15
  done
  avail=$(avail_mb)
  [ "$avail" -ge "$min_mb" ]
}

# گرم‌کردن یک مسیر — سرور باید زنده باشد؛ نتیجهٔ نهایی مهم نیست (۲۰۰/۴۰۱/۴۰۴ همه یعنی کامپایل شد)
warm_route() {
  local label="$1"; local timeout_s="$2"; local url="$3"
  for i in 1 2 3; do
    [ "$(health)" = "200" ] || return 1
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -m "$timeout_s" "$url" 2>/dev/null)
    echo "[$(date '+%F %H:%M:%S')] warm \"$label\" -> $code (avail=$(avail_mb)MB)" >> "$LOG"
    if [ "$code" = "200" ] || [ "$code" = "401" ] || [ "$code" = "404" ] || [ "$code" = "400" ]; then
      return 0
    fi
    sleep 10
  done
  return 0
}

# لیست مسیرهای حیاتی به‌ترتیب اولویت (مسیرهای پرمصرفِ تجربهٔ کاربر)
WARM_ROUTES=(
  "home|150|http://127.0.0.1:3000/"
  "products-api|120|http://127.0.0.1:3000/api/products?limit=1"
  "import-api|120|http://127.0.0.1:3000/api/import"
  "parties-api|120|http://127.0.0.1:3000/api/parties?limit=1"
  "invoices-api|120|http://127.0.0.1:3000/api/invoices?limit=1"
)

warmup() {
  echo "[$(date '+%F %H:%M:%S')] warmup phase start (done: $(tr '\n' ',' < "$WARM_LIST" 2>/dev/null || echo none))" >> "$LOG"
  sleep 15
  # مرحلهٔ ۱ — صفحهٔ اصلی «/» همیشه اول و تنهایی: پنل پیش‌نمایش پلتفرم هم
  # همین مسیر را متراقب می‌کند؛ کامپایل همزمان «/» + مسیر دیگر = OOM قطعی.
  # curl طولانی ما آن را سریالی می‌کند (درخواست دوم به همان کامپال سوار می‌شود).
  if ! grep -qxF "home" "$WARM_LIST" 2>/dev/null; then
    if ! wait_for_mem 900 6; then
      if [ "$(health)" != "200" ]; then return 1; fi
      echo "[$(date '+%F %H:%M:%S')] warmup paused (low mem $(avail_mb)MB) before home" >> "$LOG"
      touch "$WARMED"; return 0
    fi
    warm_route "home" 300 "http://127.0.0.1:3000/" || return 1
    echo "home" >> "$WARM_LIST"
    # بعد از سنگین‌ترین کامپایل، به GC فرصت جدی بده
    sleep 45
  fi
  # مرحلهٔ ۲ — بقیهٔ مسیرها یکی‌یکی و فقط وقتی حافظه ≥ ۹۰۰MB
  for entry in "${WARM_ROUTES[@]}"; do
    label="${entry%%|*}"; rest="${entry#*|}"; timeout_s="${rest%%|*}"; url="${rest#*|}"
    [ "$label" = "home" ] && continue
    # قبلاً گرم شده — رد شو
    grep -qxF "$label" "$WARM_LIST" 2>/dev/null && continue
    # FIX(v13.1-stability): invoices-api سنگین‌ترین مسیر کامپایل است — در محیط‌های
    # کم‌حافظه (سندباکس ۴GB) گرم‌کردنش حلقهٔ OOM می‌ساخت (لاگ 2026-09-21).
    # فقط با حافظهٔ فراوان (≥2200MB) گرم می‌شود؛ در غیر این صورت به‌صورت on-demand کامپایل می‌شود.
    if [ "$label" = "invoices-api" ] && [ "$(avail_mb)" -lt 2200 ]; then
      echo "[$(date '+%F %H:%M:%S')] skip warm invoices-api (low mem $(avail_mb)MB) — on-demand compile" >> "$LOG"
      echo "$label" >> "$WARM_LIST"
      continue
    fi
    if ! wait_for_mem 900 8; then
      if [ "$(health)" != "200" ]; then return 1; fi
      echo "[$(date '+%F %H:%M:%S')] warmup paused (low mem $(avail_mb)MB) — resume after next natural restart" >> "$LOG"
      touch "$WARMED"
      return 0
    fi
    warm_route "$label" "$timeout_s" "$url" || return 1
    echo "$label" >> "$WARM_LIST"
    # بعد از هر کامپایل موفق، به GC فرصت بده
    sleep 30
  done
  echo "[$(date '+%F %H:%M:%S')] warmup phase done (avail=$(avail_mb)MB)" >> "$LOG"
  touch "$WARMED"
}

# FIX(watchdog-boot): اگر سرور از قبل در حال بالاآمدن است، زمان شروع واچ‌داگ
# به‌عنوان مرجع مهلت در نظر گرفته می‌شود (LAST_START=0 یعنی «حالا» → مهلت صفر → قتل فوری!)
LAST_START=$(date +%s)

while true; do
  code=$(health)
  if [ "$code" != "200" ]; then
    now=$(date +%s)
    # فرصت اولیه: سرور تازه‌استارت‌شده تا ۳۰۰ ثانیه فرصت کامپایل اولیه دارد
    if [ $((now - LAST_START)) -lt 300 ]; then
      sleep 20
      continue
    fi
    # تأیید دوم: ۶۰ ثانیه بعد هنوز مرده؟ (کامپایل طولانی اشتباه گرفته نشود)
    if [ "${CONFIRM_DEAD:-0}" != "1" ]; then
      CONFIRM_DEAD=1
      sleep 60
      continue
    fi
    CONFIRM_DEAD=0
    # حداقل ۲۰ ثانیه فاصله بین restartها (جلوگیری از حلقهٔ مرگ)
    if [ $((now - LAST_START)) -lt 20 ]; then sleep $((20 - (now - LAST_START))); fi
    # اگر حافظه خیلی کم است، ۸ ثانیه صبر تا page cache آزاد شود
    avail=$(avail_mb)
    if [ "$avail" -lt 400 ]; then sleep 8; fi
    echo "[$(date '+%F %H:%M:%S')] health=$code avail=${avail}MB — restart" >> "$LOG"
    # هر پروسهٔ next باقی‌مانده را بکش (نیمه‌مرده بعد از OOM)
    pkill -f "next dev -p 3000" 2>/dev/null
    pkill -f "next-server" 2>/dev/null
    sleep 2
    rm -f "$WARMED"
    start_dev
    LAST_START=$(date +%s)
    # ۲۵ ثانیه به سرور فرصت بوت بده
    sleep 25
  elif [ ! -f "$WARMED" ]; then
    # سرور تازه بالا آمده — مسیرهای حیاتی را (تدریجی، با نگهبان حافظه) گرم کن
    warmup
  fi
  sleep 10
done
