# CrewPulse — Proje Planı (NASA Space Apps 2026)

Challenge: **Create Health Monitoring Software for Astronauts on Space Missions**
Hackathon: **14–15 Kasım 2026**. Teslim saati büyük ihtimalle 15 Kasım 23:59 (Local Event saati). Bunu Local Lead'den teyit edin.
Jüri kriterleri: **Impact · Creativity · Validity · Relevance · Presentation**

> Bugün yapılacak ilk iş: spaceappschallenge.org üzerinden **2026 Project Submission Guide** ve **Judging Guide**'ı okuyun. İkisi de 13 Kasım'da yayınlandı. Demo formatını (video süresi / slayt sayısı) oradan kesinleştirin. Geçmiş yıllarda 30 saniyelik video **veya** en fazla 7 slayt isteniyordu; içerik İngilizce, videoda İngilizce altyazı zorunluydu. **NASA logosu kullanmayın.** AI kullanımını proje sayfasında belirtin.

---

## 1. Tek cümlelik fikir

*"Mars yolunda en yakın doktor 20 dakika uzaktayken astronotun sağlığını ölçen, açıklayan ve ne zaman yardım isteyeceğini söyleyen yardımcı."*

Jüriye anlatacağımız temel fark: **iletişim gecikmesini bilen triyaj.** Görev ISS'ten Mars'a doğru ilerledikçe yerdeki doktora ulaşmak zorlaşır. Bu yüzden uygulama astronota daha fazla öz-bakım rehberliği verir ve eskalasyon eşiklerini buna göre değiştirir.

---

## 2. Ekranlar (öncelik sırasıyla)

| # | Ekran | Öncelik | Not |
|---|---|---|---|
| 1 | **Mission Select**: ISS / Artemis transfer / Lunar base / Mars transit / Mars surface | P0 | Görev gün sayısını, radyasyon dozu hızını, iletişim gecikmesini ve yerçekimini belirler |
| 2 | **Body Map**: tıklanabilir SVG insan figürü, sistemler renk kodlu | P0 | Asıl "vay" anı. Kalp, kemik/kas, beyin/uyku/ruh hali, gözler (SANS), bağışıklık/ısı, radyasyon |
| 3 | **Log Vitals**: tansiyon, nabız, SpO₂, ısı, şeker, uyku, ruh hali, belirtiler | P0 | Klavye ve tıklama. Emoji ruh hali ölçeği |
| 4 | **Triage**: 🟢 Self-care · 🟡 Crew check + tekrar ölç · 🔴 Flight surgeon raporu | P0 | **Kural tabanlı.** AI'a bağlı değil, internet olmadan da çalışır |
| 5 | **Trends**: görev gününe göre grafik, normal aralık bantlarıyla | P1 | Recharts. "Simulated / Real device" etiketleri |
| 6 | **Camera Read**: Omron ekranının fotoğrafı → AI vision → SYS/DIA/PULSE | P1 | Değerler kaydedilmeden önce kullanıcı onaylar |
| 7 | **Live Sensor**: Arduino → Web Serial (Chrome/Edge) | P1 | Kabin sıcaklığı ve nem → "hostile closed environment" tehlikesi. Nabız sensörü varsa canlı nabız |
| 8 | **AI Medical Officer**: sohbet asistanı | P1 | Açıklar ve öğretir, **teşhis koymaz** |
| 9 | **Flight Surgeon Report**: düşük bant genişliğine uygun özet, kopyalanabilir veya indirilebilir | P1 | Mesajda gecikme sayacı: "Mars'a tahmini varış: 14 dk" |
| 10 | **Daily Routine + Gamification**: hatırlatmalar, streak, rozetler, Mission Health Score | P2 | |
| 11 | **Watch import**: Samsung Health CSV (uyku, nabız) | P2 | Trend grafiklerini gerçek veriyle doldurur |
| 12 | **PWA**: iPad ve Samsung'da "Ana ekrana ekle" | P2 | vite-plugin-pwa, 30 dk iş |

Zaman yetmezse en alttan başlayarak kesin. **P0 Cumartesi akşamına kadar çalışır ve yayında olmalı.**

---

## 3. Tehlike → gösterge → ekran eşlemesi (Relevance slaytı)

| NASA hazard | HRP riski | Gösterge | Uygulamadaki yeri |
|---|---|---|---|
| Space radiation | Radiation-induced cancers | Kümülatif doz (mSv), simüle dozimetre | Body Map ☢️ + görev profili |
| Isolation & confinement | Behavioral conditions, inadequate sleep, teamwork | Ruh hali, uyku saati, stres | 🧠 Brain |
| Distance from Earth | (tümü: kendi kendine yeterlilik) | İletişim gecikmesi → eskalasyon mantığı | Triage + Surgeon report |
| Gravity fields | Bone changes, cardiovascular, SANS, sensorimotor, fitness | Tansiyon, nabız, egzersiz dk, görme testi, baş dönmesi | ❤️ 🦴 👁️ |
| Hostile closed environment | Immune, host-microorganism, hypoxia | Vücut ısısı, SpO₂, kabin sıcaklığı/nemi (Arduino) | 🛡️ + Live Sensor |

Kaynaklar: [5 Hazards](https://www.nasa.gov/hrp/hazards/), [HRP Risks (17 risk)](https://www.nasa.gov/hrp/risks/), [CSA radiation (CANS)](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp)

## 4. Eşikler (Kişi 3 her birinin kaynağını doğrulayacak)

| Gösterge | 🟢 | 🟡 | 🔴 | Kaynak önerisi |
|---|---|---|---|---|
| Tansiyon (mmHg) | <130/<80 | 130–139 / 80–89 | ≥140/90; ≥180/120 → acil | AHA/ACC 2017 |
| Dinlenme nabzı (bpm) | 50–100 | 40–49 / 101–120 | <40 / >120 | Klinik standart |
| SpO₂ (%) | ≥95 | 92–94 | <92 | Klinik standart; hypoxia riski |
| Vücut ısısı (°C) | 36.1–37.5 | 37.6–38.0 | >38.0 veya <35 | Klinik standart; immune riski |
| Kan şekeri (mg/dL, açlık) | 70–99 | 100–125 / 60–69 | ≥126 / <60 | ADA |
| Uyku (saat) | ≥7 | 5–6.9 | <5 (2+ gün üst üste) | HRP sleep riski |
| Ruh hali (1–5) | 4–5 | 3 | 1–2 (3+ gün üst üste) | HRP behavioral riski |
| Egzersiz (dk/gün) | ≥120 | 60–119 | <60 | ISS rutini yaklaşık 2–2.5 sa/gün |
| Radyasyon (kümülatif) | <%50 limit | %50–80 | >%80 limit | NASA kariyer limiti 600 mSv (doğrula) |

Yaklaşık doz hızları (doğrulanacak): ISS ≈ 0.5–1 mSv/gün · Mars transit ≈ 1.8 mSv/gün (Curiosity RAD) · Mars yüzeyi ≈ 0.7 mSv/gün.
Tek yönlü iletişim gecikmesi: ISS ≈ 0 · Ay ≈ 1.3 sn · Mars 3–22 dk.
Kemik kaybı: egzersiz yapılmazsa ağırlık taşıyan kemiklerde ayda yaklaşık %1–1.5.

**Gecikmeye duyarlı eskalasyon (yaratıcılık puanı):** ISS'te 🟡 durumunda bile "ground'a danış" önerilir. Mars'ta 🟡 durumunda önce mürettebat protokolü ve tekrar ölçüm gelir. 🔴 durumunda surgeon raporu otomatik hazırlanır ve astronota "yanıt en erken X dk sonra gelir, o zamana kadar şunu yap" adımları gösterilir.

Uygulamadaki her eşiğin yanında bir **ℹ️ Why?** butonu olacak: kaynak ve kısa açıklama (Validity puanı için).

---

## 5. Teknik mimari

```
Vite + React + TypeScript + Tailwind + Recharts + Framer Motion
  ├─ src/data/thresholds.ts     ← tek gerçek kaynak (Kişi 3 doldurur)
  ├─ src/logic/triage.ts        ← kural tabanlı, offline, test edilebilir
  ├─ src/state (localStorage)   ← backend yok
  └─ server/  (Express)         ← /api/chat, /api/vision → OpenAI (anahtar sadece sunucuda)
GitHub (main) ──push──► Hostinger otomatik build + deploy ──► alanadiniz.com
```

### Hostinger'a özel kararlar (önceki plandan farklı olan kısım)
- Önceki plan Vercel öneriyordu. Siz Hostinger kullanacaksınız. **hPanel → Websites → Add Website** menüsünde **"Node.js web app"** seçeneğine bakın (Business/Cloud/Web Apps paketlerinde var). Seçenek varsa: GitHub repo'yu bağlayın. Vite otomatik algılanır, `npm run build` çalışır ve her push'ta yeniden deploy edilir. Express sunucusu hem `dist`'i hem `/api` uçlarını sunar.
- **Node.js seçeneği yoksa** (paylaşımlı Premium paket): build'i GitHub Actions'ta alıp `dist`'i sunucuya yükleyeceğiz, API proxy'sini ise **PHP** ile yazacağız (`api/chat.php`). Her Hostinger paketi PHP çalıştırır.
- ⚠️ **OpenAI anahtarına asla `VITE_` önekli isim vermeyin.** Vite `VITE_` ile başlayan değişkenleri tarayıcıya gömer. Anahtar Hostinger'da sunucu ortam değişkeni olarak (`OPENAI_API_KEY`) tanımlanacak. OpenAI panelinde aylık harcama limiti koyun (ör. 10–20 $).
- Model adını kod yerine env değişkeninde tutun (`OPENAI_MODEL`). Vision destekli, ucuz ve hızlı bir model seçin.
- **Rate limit:** `/api` uçlarına IP başına basit bir istek sınırı koyun. Jüri linki herkese açık olacak.

### AI asistan kuralları
- Sistem prompt'u: rolü "Onboard Medical Officer assistant"; teşhis koymaz, ilaç dozu vermez; triyaj sonucunu değiştiremez, sadece açıklar; 🔴 durumda flight surgeon'a yönlendirir; kısa ve adım adım yanıt verir.
- Bağlam: o anki görev profili, son ölçümler, triyaj sonucu ve HRP risk özetleri (Kişi 3'ün metinleri) prompt'a eklenir.
- **"Mars'ta internet yok" sorusuna hazır cevap:** "Triyaj ve uyarılar tamamen offline ve kural tabanlı çalışıyor. AI yalnızca açıklama katmanı. Gerçek bir görevde bu katman gemideki yerel bir modelle çalışır." Uygulamada **"Offline mode"** anahtarı olsun ve demoda gösterilsin.

### Donanım
| Cihaz | Yöntem | Risk ve yedek plan |
|---|---|---|
| Omron | Fotoğraf → `/api/vision` → JSON {sys, dia, pulse}. Kaydetmeden önce kullanıcı onaylar | LCD okuması bazen hatalı olabilir. İyi ışıkta çekilmiş, önceden test edilmiş bir yedek fotoğraf hazır tutun |
| Arduino | Seri porttan JSON satırları (`{"t":23.4,"h":41}`), Web Serial ile okuma | Yalnızca Chrome/Edge masaüstünde çalışır. iPad'de çalışmaz. Demo laptop'tan yapılacak |
| Galaxy Watch 6 | Samsung Health → Ayarlar → kişisel verileri indir → CSV içe aktar | Canlı veri ileride Capacitor + Health Connect ile gelir (Future Work) |
| Watch (alternatif) | Nabız/SpO₂ değerini saatten okuyup elle girmek | Demoda "real device" olarak etiketlenir |

### Mobil (hackathon sonrası)
PWA hackathon'da yapılır, aynı kodla iPad ve Samsung'da çalışır. Sonrasında **Capacitor** ile Android APK üretilir (VS Code + Android Studio). Health Connect üzerinden Galaxy Watch verisi canlı alınır. iOS derlemesi için Mac + Xcode gerekir, bunu not edin.

---

## 6. Yol haritası (İstanbul saati, teslim Paz 23:59 varsayılarak)

| Zaman | Kişi 1 (Frontend/UI) | Kişi 2 (Veri/Donanım/AI/Deploy) | Kişi 3 (Bilim/İçerik/Sunum) |
|---|---|---|---|
| **Cmt → 12:00** | Node.js 22 LTS kurulumu, Vite iskeleti, tasarım dili (koyu "mission control" teması) | GitHub repo, Hostinger paketini kontrol, ilk "hello" deploy + domain | Submission/Judging Guide'ı okuma, eşik tablosunun doğrulanması (§4) |
| **12:00–19:00** | Mission Select, Body Map SVG, Log Vitals formu | `thresholds.ts` + `triage.ts`, localStorage, simüle 180 günlük astronot verisi | Her sistem için "function / how space affects it / what to do" metinleri (EN) |
| **19:00–24:00** | Triage ekranı, Trends grafikleri | Express `/api/chat` + `/api/vision`, Arduino sketch + Web Serial | AI sistem prompt'u ve bağlam metni, demo senaryosu taslağı |
| **00:00–07:00** | 😴 uyku (dönüşümlü) | 😴 | 😴 |
| **Paz 08:00–14:00** | Gamification, Surgeon Report, animasyonlar, mobil uyum | Omron fotoğraf okumanın testi, Watch CSV, PWA, rate limit | Slaytlar, proje sayfası metni, kaynaklar, AI beyanı |
| **14:00** | 🧊 **ÖZELLİK DONDURMA** | | |
| **14:00–18:00** | Hata düzeltme, iPad/telefonda test | Prod deploy kontrolü, offline mode testi | Demo çekimi (gerçek Omron + Arduino) |
| **18:00–21:00** | Video montajı + İngilizce altyazı (hep birlikte) | | |
| **21:00** | ✅ **Teslim.** Son saate bırakmayın | | |

---

## 7. Demo senaryosu (hikâye)

1. "Mars transit, day 142. One-way delay to Earth: 14 minutes." (Mission Select)
2. Body Map: 🧠 sarı, çünkü 3 gecedir az uyku var. Tıklanınca: "Isolation & sleep → why it matters" açılır.
3. **Gerçek Omron ölçümü**, telefonla fotoğraf çekiliyor, değerler otomatik doluyor → ❤️ sarıya dönüyor.
4. Triage: "Re-measure in 15 min, notify crewmate." Tekrar ölçüm hâlâ yüksek → 🔴.
5. Surgeon Report tek tıkla hazırlanıyor. Ekranda "Earliest reply: 28 min, until then: …" mesajı görünüyor.
6. AI Officer'a "What does this mean?" diye soruluyor, kısa ve kaynaklı bir açıklama geliyor. **Offline mode** açılıyor, triyaj çalışmaya devam ediyor.
7. Arduino canlı kabin sıcaklığı akışı. Trend grafiğinde 142 günlük veri, kemik riski eğrisi.
8. Kapanış: "Same tool → Antarctic stations, remote clinics, home care for elderly patients."

## 8. Slaytlar (7 slayt, İngilizce)
1. Problem: Mars'ta doktor 20 dk uzakta · 2. 5 hazard → göstergeler (§3 tablosu) · 3. Çözüm + Body Map ekran görüntüsü · 4. Gerçek sensörler (Omron/Arduino/Watch) · 5. Gecikmeye duyarlı triyaj · 6. Mimari + güvenli AI (offline-first) · 7. Etki + gelecek (Capacitor, Health Connect, Dünya'da kullanım)

## 9. Teslim kontrol listesi
- [ ] Canlı link (domain) + GitHub repo public
- [ ] Demo (video İngilizce altyazılı / slaytlar İngilizce), format Guide'a uygun
- [ ] Proje sayfası: özet, nasıl çalışır, kullanılan NASA/CSA kaynakları, **AI kullanım beyanı** (Claude Code ile geliştirme, OpenAI API çalışma zamanında)
- [ ] NASA logosu yok; simüle veriler etiketli
- [ ] OpenAI harcama limiti aktif, anahtar repoda değil (`.env` dosyası `.gitignore` içinde)
