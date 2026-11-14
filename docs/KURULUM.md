# AURA — Hostinger kurulum rehberi (veritabanı + e-posta)

Bu rehber, sitenin Hostinger'daki MySQL veritabanına ve e-postaya bağlanmasını adım adım anlatır.
PHP dosyası elle düzenlemen **gerekmez**: ayar dosyasını `tools/make-config.mjs` aracı yazar.

> **Hızlı özet (her şey yolundaysa 20 dakika)**
> 1. hPanel'de bir MySQL veritabanı oluştur → adını, kullanıcı adını ve şifresini not et.
> 2. VS Code terminalinde: `node tools/make-config.mjs` → soruları cevapla.
> 3. Oluşan `aura-config.php` dosyasını File Manager'da **`public_html` klasörünün yanına** yükle (içine değil).
> 4. Aracın verdiği kurulum adresini tarayıcıda bir kez aç → `Tables ready.` yazısını gör.
> 5. `…/api/index.php?r=health` adresinde `"db":true` gör.
> 6. Giriş sayfasının altında `● Connected to the mission database` yazısını gör.

**Bu rehberde kullanılan adresler.** Sitenin adresi:
`https://auraspace.space`. Aşağıda `SİTE` gördüğün her yere sitenin o anki adresini koy
(alan adı değişirse yeni adresi).

**Arayüz hakkında dürüst bir not.** Menü adları Hostinger'ın İngilizce yardım sayfalarından alındı (Kasım 2026).
hPanel'i Türkçe kullanıyorsan aynı menüler Türkçe adlarla görünebilir; tam Türkçe karşılıklarını doğrulayamadık,
bu yüzden İngilizce adları yazdık. Hostinger'ın File Manager'ının yeni sürümü kademeli geliyor: sağ üstte
**Deploy** düğmesi görüyorsan yeni sürümdesin; görmüyorsan eski sürümdesin (düğme adları biraz farklı olabilir).

---

## 1. Bu "anahtarlar" ne? (1 dakikalık açıklama)

Sitenin sunucu tarafı, sırlarını tek bir dosyada tutar: **`aura-config.php`**. İçinde birkaç şifre var.
Bunların hiçbiri GitHub'a gitmez; dosya yalnızca senin bilgisayarında ve Hostinger'da durur.

| Ayar | Günlük dilde ne? | Sen hatırlamalı mısın? |
|---|---|---|
| `db_pass` | Veritabanının kapı şifresi. Hostinger'da veritabanını oluştururken sen belirlersin. | Hayır. Unutursan hPanel'den yenisini koyarsın. |
| `install_token` | **Kurulum sayfasının kapı anahtarı.** Kurulum sayfası (`install.php`) tabloları oluşturur ve demo verisini yükler. Bu sayfayı yabancılar açamasın diye adresin sonuna uzun bir anahtar eklenir: `?token=...`. Anahtarı sen "uydurursun" — araç senin yerine rastgele, tahmin edilemez bir tane üretir. Bir şifreyle giriş yapmazsın; sadece adresin sonunda durur. | Hayır. Gerekirse VS Code'da `aura-config.php` dosyasını açıp `install_token` satırına bakarsın. |
| `app_secret` | E-posta doğrulama kodlarını "mühürleyen" gizli bir dize. Bir insanın bunu yazması ya da bilmesi hiç gerekmez. | Hayır. |
| `demo_password` | 6 demo hesabın (okafor, reyes, tanaka, brandt, surgeon, capcom) ortak giriş şifresi. Jüriye söyleyebilirsin. | **Evet**, bunu not alın. |
| `smtp_pass` | E-posta kodlarını gönderen posta kutusunun şifresi. | Hayır. Unutursan hPanel'den yenisini koyarsın. |

Kısaca: **yalnızca demo şifresini** akılda tutun. Geri kalanı dosyada durur, kimseyle paylaşılmaz.

---

## 2. Veritabanını oluştur (hPanel)

1. hPanel'e gir → **Websites** → sitenin yanındaki **Manage** (sitenin paneli açılır).
2. Sol menü: **Databases** → **MySQL Databases**.
3. Hostinger'ın iki farklı ekranı var; hangisini görürsen:
   - **Yeni ekran:** **Create database** → bir ad yaz (ör. `aura`) → **Create**. Kullanıcı otomatik oluşturulur.
     Şifre sorulmadıysa: **Databases → MySQL Users → Change Password** ile bir şifre belirle.
   - **Eski ekran:** "Create a New MySQL Database And Database User" bölümünde **ad**, **kullanıcı adı** ve **şifre** gir → **Create**.
4. Şifre kuralı (Hostinger): en az 8 karakter, en az bir rakam, bir büyük ve bir küçük harf.
   Araç tırnaklı şifreleri de doğru yazar; yine de en sorunsuzu harf, rakam ve `-` `_` `!` gibi işaretler.

**Ekranda ne görmelisin?** Listede (eski ekranda: "List of Current MySQL Databases And Users") yeni veritabanı
aşağıdakine benzer biçimde görünür (sütun adları ve düzen ekrana göre değişebilir):

```
Database:  u123456789_aura      User:  u123456789_aura
```

- Baştaki **`u123456789_`** kısmı senin hesabına özel bir numaradır; Hostinger ekler, silinemez ve değiştirilemez.
  Araca adı ve kullanıcıyı **bu ön ek dahil, tam haliyle** yazacaksın. (`u123456789` sadece örnek; seninki farklı.)
- Not etmen gereken üç şey: **tam veritabanı adı**, **tam kullanıcı adı**, **şifre**. Şifreyi hPanel sonradan göstermez.
- Sunucu (host) her zaman **`localhost`** — araç bunu kendisi yazar. Hostinger'ın "Remote MySQL" sayfasındaki
  `srv….hstgr.io` gibi adresleri **kullanma**.
- Her veritabanının tek bir kullanıcısı olur. Adı ve kullanıcıyı listede **aynı satırdan** kopyala.

---

## 3. `aura-config.php` dosyasını oluştur

### 3a. Araçla (önerilen)

1. VS Code'da projeyi aç → üst menü **Terminal → New Terminal**.
2. Node yüklü mü bak: `node -v` → `v18` veya daha yeni bir sürüm yazmalı.
3. Şunu çalıştır:

```powershell
node tools/make-config.mjs
```

4. Ekranda şunu görürsün (kısaltılmış):

```
AURA — sunucu ayar dosyası (aura-config.php) oluşturucu
  Hedef: C:\...\auraspace\aura-config.php
  Güvenlik kontrolü: git tarafından yok sayılıyor (.gitignore) — GitHub'a gitmez

  [1/6] Veritabanı adı
      hPanel → Databases → MySQL Databases listesindeki tam ad. Örnek: u123456789_aura
  >
```

5. Soruları cevapla:

| Soru | Ne yazacaksın | Örnek |
|---|---|---|
| [1/6] Veritabanı adı | Listedeki tam ad | `u123456789_aura` |
| [2/6] Veritabanı kullanıcı adı | Aynı satırdaki kullanıcı | `u123456789_aura` |
| [3/6] Veritabanı şifresi | Belirlediğin şifre, iki kez. **Yazarken ekranda görünmez — normal.** Yapıştırabilirsin (sağ tık ya da Ctrl+V). | — |
| [4/6] Demo hesap şifresi | Enter → araç güçlü bir şifre üretir (ör. `Kp7m-x3Qw-9bTz`). İstersen kendin yaz (en az 8 karakter). | — |
| [5/6] E-posta | Şimdilik **Enter** (boş) geçebilirsin; e-postayı 7. bölümde eklersin. | `no-reply@alanadiniz.com` |
| [6/6] Sitenin adresi | Enter (site adresi hazır gelir) | `https://auraspace.space` |
| Devam edilsin mi? | Enter (= evet) | — |

6. Sonunda araç şunları yazar: **özet** (şifreler hariç), **demo şifresi**, **kurulum adresi** ve **kontrol adresi**.
   Terminali kapatma; birazdan bu adresleri kullanacaksın.

```
✓ Yazıldı: C:\...\auraspace\aura-config.php
...
 2) Kurulumu bir kez çalıştır — bu adresi tarayıcıda aç:
    https://SİTE/api/install.php?token=3f9c...(48 karakter)
 3) Kontrol et: https://SİTE/api/index.php?r=health
```

- Dosya proje klasörünün **kök** dizinine yazılır. VS Code'da gri görünür: `.gitignore`'da olduğu için GitHub'a gitmez.
- Araç, dosyayı GitHub'a gidebilecek bir yere (ya da `public`, `dist`, `public_html` içine) yazmayı **reddeder**.
- Aracı tekrar çalıştırırsan mevcut değerler varsayılan gelir: **Enter = aynı kalsın**. Ayar değiştirmenin yolu budur.
- Vazgeçmek için Ctrl+C: hiçbir dosya yazılmaz.

### 3b. Elle (araç çalışmazsa)

1. Proje kökünde `aura-config.example.php` dosyasını kopyala, kopyanın adını tam olarak **`aura-config.php`** yap
   (proje kökünde; başka ad ya da başka klasör olmaz).
2. Tırnakların **arasındaki** değerleri değiştir. `CHANGE-ME` geçen **her** değeri değiştir: örnek dosya herkese açık
   GitHub'da durduğu için içindeki değerleri herkes biliyor ve kurulum sayfası bunları reddetmiyor.
3. Şifrende `'` varsa `\'`, `\` varsa `\\` yaz. (Araç bunu kendisi yapar; elle yaparken en sık hata budur.)
4. `install_token` ve `app_secret` için rastgele dize üret (her biri için ayrı ayrı çalıştır):

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

   Node yoksa PowerShell'de:

```powershell
$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

5. Dosyayı **UTF-8** olarak kaydet ("UTF-8 with BOM" değil; VS Code sağ alttaki kodlamayı gösterir). `<?php` satırından
   önce hiçbir şey (boşluk bile) olmasın.

---

## 4. Dosyayı doğru klasöre yükle

### Neden `public_html`'in yanına?

- Site GitHub Actions'ta derlenir ve Hostinger'ın Git dağıtımı `deploy` dalını **`public_html`'e** çeker. Hostinger'a
  göre bu dağıtım "her seferinde o klasördeki dosyaları değiştirir" — yani `public_html`'e koyduğun dosya bir sonraki
  yayında kaybolabilir.
- `public_html` içindeki her şey internete açıktır. Hostinger da "kimlik bilgisi içeren yapılandırma dosyalarını
  `public_html`'e koymayın" diyor.
- Sunucu kodu (`public/api/lib.php`) dosyayı tam olarak **`public_html`'i içeren klasörde** arar.

Hostinger'daki yapı genelde şöyledir:

```
domains/
└── auraspace.space/   ← aura-config.php BURAYA
    ├── aura-config.php        ✓ senin yükleyeceğin dosya
    ├── DO_NOT_UPLOAD_HERE     (görebilirsin, aşağıya bak)
    └── public_html/           ← GitHub'dan gelen site, her yayında yenilenir
        ├── index.html
        ├── api/               (index.php, install.php, …)
        ├── assets/
        └── models/
```

(Bazı eski hesaplarda yol `/home/u123456789/public_html` olur; o zaman `public_html`'i içeren klasör Home klasörüdür.
Kural aynı: **`public_html` ile yan yana**.)

### Adımlar

1. hPanel → **Websites** → sitenin **Manage** → sol menü **Files → File Manager**.
2. Hostinger'a göre File Manager **sitenin klasöründe** (`domains/<alan-adı>`) açılır. Yani çoğu zaman zaten doğru yerdesin.
3. **Doğru yerde misin? Kontrol listesi:**
   - [ ] Listede **`public_html` adında bir klasör** görüyorsun (ve içine girmedin).
   - [ ] Bu klasörde `index.html`, `api`, `assets` **yok** (onları görüyorsan `public_html`'in içindesin → yol çubuğunda bir üst klasöre tıkla).
   - [ ] Yol çubuğundaki klasör adı sitenin alan adıyla aynı (ör. `auraspace.space`).
         Birden fazla siten varsa her birinin `domains` altında ayrı klasörü vardır; doğru olanı seç.
   - [ ] `DO_NOT_UPLOAD_HERE` adlı bir dosya görebilirsin. Hostinger bunun ne olduğunu belgelerinde açıklamıyor; bizim
         anladığımız, "site dosyalarını buraya değil `public_html`'e koy, buradakiler web'de görünmez" uyarısı olduğu.
         Gizli ayar dosyası için istediğimiz tam olarak bu. **Buraya yalnızca `aura-config.php` koy**, başka bir şey değil.
4. Yüklemek için önce dosyayı bilgisayarında bul: VS Code'da `aura-config.php`'ye sağ tık → **Reveal in File Explorer**.
5. File Manager'da **Upload → Upload files**. Pencerenin altındaki **To** alanı `public_html` ile **bitmemeli**;
   sitenin klasörünü göstermeli. (Hedefi yalnızca dosya eklemeden önce değiştirebilirsin.)
6. Dosyayı sürükle ya da **Choose files** → dosyanın yanında tik işareti → **Done**. Yüklemeler hemen geçerli olur, Deploy gerekmez.
7. "Dosya zaten var" sorusu gelirse **Replace** seç. **Keep both** seçersen yeni dosya başka bir adla kaydedilir ve
   sunucu **eski** dosyayı okumaya devam eder.

> **Dosyayı File Manager'da düzenlersen:** Yeni File Manager'da düzenlemeler **Deploy** düğmesine basana kadar canlıya
> geçmez ve sayfadan çıkarsan kaybolur. En kolayı: düzenleme yapma; aracı tekrar çalıştır ve dosyayı **Replace** ile yükle.

### Yapma

- ❌ `public_html`'in ya da `public_html/api`'nin **içine** koyma.
- ❌ GitHub'a yükleme (`git add -f` kullanma, GitHub web sitesine sürükleme).
- ❌ Adını değiştirme (`aura-config (1).php`, `aura-config.php.txt` çalışmaz).
- ❌ WhatsApp/Discord/e-posta ile gönderme. Başka bir bilgisayar gerekiyorsa orada aracı yeniden çalıştırın.

**En kesin kontrol:** Bir sonraki adımdaki kurulum adresini aç. `aura-config.php not found…` **dışında** bir şey
görüyorsan dosya doğru yerde demektir.

> **Gerçek alan adını bağladığınızda:** Hostinger sitenin klasörünü yeni alan adıyla (`domains/<gerçek-alan-adı>/`)
> gösterebilir. Yeni adreste health kontrolünü (6. bölüm) tekrar yapın; `"db":false` ise `aura-config.php`'nin hâlâ
> o sitenin `public_html`'inin yanında olduğuna bakın, değilse oraya yükleyin. Aracı yeni adresle tekrar çalıştırırsanız
> bağlantıları da yeni adresle yazar.

---

## 5. Kurulumu çalıştır (bir kez)

Aracın verdiği adresi tarayıcıda aç (tamamını kopyala; anahtar 48 karakterdir):

```
https://SİTE/api/install.php?token=BURAYA_install_token
```

Sayfa düz yazı gösterir. **İlk kurulumda** şöyle görmelisin:

```
Tables ready.
Loaded 4 crew, 2 staff accounts and <sayı> measurements.
Usernames: okafor, reyes, tanaka, brandt, surgeon, capcom
Password for every demo account: the demo_password in aura-config.php.
Email: NOT configured — sign-up codes cannot be sent until mail_from/SMTP are set.
```

- `<sayı>` birkaç bindir ve günün saatine göre değişir (henüz "gelmemiş" saatlerin ölçümleri yüklenmez).
- E-posta ayarlıysa son satır: `Email: configured (smtp.hostinger.com)`.
- Özelliklerin kendi tabloları için `Tables ready.`'den önce `Module ready: <ad>` satırları da görünür. Şu an üç tane
  olmalı (alfabetik sırayla):

  ```
  Module ready: clinic
  Module ready: env
  Module ready: import
  ```

  `clinic` = sağlık profili ve kaydedilen AURA danışma sonuçları (`clinic_profiles`, `clinic_assessments` tabloları),
  `env` = Arduino ortam sensörü okumaları (`env_readings`), `import` = Samsung Health içe aktarma kayıtları (`import_keys`).
  Bunlardan biri eksikse o dosya sunucuya yüklenmemiştir (GitHub Actions + hPanel Git'e bak).
  Eski bir veritabanında `Upgraded: users.email` gibi satırlar da çıkabilir. Hepsi normal.

**İkinci ve sonraki açışlarda** (bu da başarıdır):

```
Module ready: clinic
Module ready: env
Module ready: import
Tables ready.
Demo data already present — nothing else changed. Add &reset=1 to reload the demo crew.
```

| Gördüğün | Anlamı |
|---|---|
| `Tables ready.` + `Loaded 4 crew…` | Kurulum tamam. 6. bölüme geç. |
| `Demo data already present — nothing else changed…` | Zaten kurulu; eksik tablolar oluşturuldu, veri silinmedi. |
| `aura-config.php not found…` | Dosya yanlış yerde/adda → 4. bölüm. |
| `aura-config.php was found but …` | Dosya doğru yerde ama bozuk → 9. bölüm. |
| `Forbidden: wrong or missing token…` | Adresteki anahtar sunucudaki dosyayla aynı değil → 9. bölüm. |
| `INSTALL FAILED during: …` | Bir kurulum adımı veritabanında hata verdi; altındaki satır sebebi söyler → 9. bölüm. |
| Boş sayfa, `HTTP ERROR 500` ya da `Fatal error: …` | PHP hatası → 9. bölüm. |

> **`&reset=1` ne yapar?** Adresin sonuna `&reset=1` eklersen **yalnızca simüle demo ekibinin** verisi silinip baştan
> yüklenir; e-postayla kayıt olmuş gerçek üyeler **silinmez**. Gerektiği durumlar: demo şifresini değiştirdiğinde ve
> sunumdan önce demo verisini tazelemek istediğinde. Bunun dışında `&reset=1` kullanma.

---

## 6. Doğrula

### 6a. Health (sağlık) adresi

```
https://SİTE/api/index.php?r=health
```

Her şey tamamsa:

```json
{"ok":true,"db":true,"signup":true,"demo":true,"mail":false}
```

| Alan | `true` ise | `false` ise |
|---|---|---|
| `ok` | PHP çalışıyor ve API'ye ulaşılıyor. | (Sayfa hiç açılmıyorsa ya da 404 ise site/API yayında değil ya da adres yanlış.) |
| `db` | Ayar dosyası bulundu, veritabanına bağlanıldı **ve** kurulum yapılmış (kullanıcılar var). | Sebebi yanındaki `reason` alanı söyler (aşağıdaki tablo). Ayrıntı için kurulum adresini aç. |
| `signup` | E-postayla yeni kayıt açık (`allow_signup`). | Kayıt kapalı. |
| `mail` | Dosyada geçerli bir gönderen adresi (`mail_from`) var. **Dikkat:** şifrenin doğru olduğunu göstermez; gerçek test kayıt olmaktır (7. bölüm). | E-posta ayarlanmamış. |

`"db":false` ise yanında bir `reason` (sebep) görünür, ör. `{"ok":true,"db":false,"signup":false,"demo":false,"mail":false,"reason":"config_missing"}`:

| `reason` | Anlamı | Çözüm |
|---|---|---|
| `config_missing` | `aura-config.php` bulunamadı. | 4. bölüm (doğru klasör, doğru ad). |
| `config_invalid` | Dosya bulundu ama bozuk (PHP yazım hatası ya da `return [ … ];` yok). | Kurulum adresi satır numarasını söyler. Aracı çalıştır, **Replace** ile yükle. |
| `config_incomplete` | Dosyada `db_name` ya da `db_user` boş. | Aracı çalıştır, yükle. |
| `connect_failed` | Veritabanına bağlanılamadı (şifre, kullanıcı, veritabanı adı ya da `db_host` yanlış). | Kurulum adresini aç: `Database connection failed: …` satırı tam sebebi söyler → 9. bölüm. |
| `not_installed` | Bağlantı tamam ama tablolar/demo hesaplar yok. | Kurulum adresini aç (5. bölüm). |
| `db_error` | Başka bir veritabanı hatası. | Kurulum adresini aç ve mesajı oku. |

### 6b. Giriş sayfası

`https://SİTE/login` sayfasını aç ve **Ctrl+F5** ile yenile. Sayfanın en altında:

- `● Connected to the mission database · all crew data is simulated` → sunucuya bağlı. ✓
- `○ Demo mode — data stays in this browser · all crew data is simulated` → site veritabanına ulaşamadı ve
  tarayıcı içi demo moduna düştü (health'te `"db":false` olunca ya da 3 saniyede cevap gelmeyince böyle olur).

### 6c. Demo hesaplar

Şifre hepsinde aynıdır: `demo_password` (araç ekrana yazdı). Giriş sayfasındaki demo düğmeleri şifre sormadan girer.

| Kullanıcı adı | Kim | Demo hikâyesi |
|---|---|---|
| `okafor` | Mira Okafor — Commander | Yükselen tansiyon |
| `reyes` | Daniel Reyes — Pilot | Çok kısa uyku, düşük ruh hali |
| `tanaka` | Aiko Tanaka — Mission Specialist | Sağlıklı |
| `brandt` | Lukas Brandt — Flight Engineer | Az su ve egzersiz |
| `surgeon` | Dr. Selin Arslan — Flight Surgeon | Uçuş hekimi (personel) |
| `capcom` | Jonas Weber — Mission Control · CAPCOM | Yer kontrol (personel; ruh hali verisini görmez) |

Test: `okafor` + demo şifresiyle giriş yap. Açılıyorsa kurulum bitti. 🎉

---

## 7. E-posta kodları (kayıt ve şifre sıfırlama)

"Create an account" (`/register`) ve "Forgot password?" (`/forgot`) e-postayla **6 haneli bir kod** gönderir
(15 dakika geçerli). Bunun için Hostinger'da bir posta kutusu gerekir.

**Önce bilmen gereken:** Posta kutusu **gerçek bir alan adında** açılır (kiraladığınız alan adı). Geçici
`hostingersite.com` adresinde posta kutusu açılıp açılamadığını Hostinger belgelerinde doğrulayamadık; gerçek alan
adını kullanın. Site geçici adreste kalsa bile gönderen adres gerçek alan adında olabilir.

1. **Posta kutusunu oluştur:** hPanel → **Emails** → alan adını seç → **Mailboxes** → yeni posta kutusu oluştur, ör.
   `no-reply@alanadiniz.com`. Şifre kuralı (Hostinger): 8–50 karakter; büyük harf, küçük harf, rakam ve sembol;
   boşluk yok, yalnızca Latin harfleri. Ücretsiz posta kutusu sayısı pakete göre değişir.
2. **SMTP bilgilerini kontrol et:** Aynı alan adının **Connect apps & devices** sayfası. Hostinger'ın verdiği değerler:
   - Sunucu: `smtp.hostinger.com` · Port: `465` · Şifreleme: SSL/TLS (sorun olursa `587` + STARTTLS)
   - Kullanıcı adı: **tam e-posta adresi** · Şifre: **posta kutusunun şifresi** (Hostinger hesabının şifresi değil).
     Posta kutusunda iki adımlı doğrulama (2FA) açıksa Mailboxes'tan bir **App password** oluşturup onu kullan.
3. **DNS kayıtları:** Emails → alan adı → **Domain settings** sayfasında MX, SPF, DKIM, DMARC kayıtlarının durumunu
   kontrol et. Alan adının DNS'i Hostinger'daysa sayfa bunları kendisi ekleyebilir. Bunlar eksikse kodlar spam'e düşebilir
   ya da hiç ulaşmayabilir. Hostinger'a göre DNS değişikliklerinin yayılması 12 saate kadar sürebilir.
4. **Aracı tekrar çalıştır:** `node tools/make-config.mjs` → her soruda **Enter** (mevcut değer kalır) → **[5/6]**'da
   posta kutusu adresini yaz → şifresini iki kez gir → port için Enter (465) → "Gizli anahtarlar aynı kalsın mı?" →
   Enter (evet).
5. **Yükle:** File Manager'da aynı yere, **Replace** ile (4. bölüm).
6. **Kurulumu tekrar açmak gerekmez.** E-posta ayarı her istekte dosyadan okunur. İstersen açabilirsin, zararsızdır:
   `&reset=1` olmadan açılınca **hiçbir veri silinmez**, sadece `Demo data already present — nothing else changed…` yazar.
7. **Health:** `"mail":true` görmelisin.
8. **Gerçek test:** Gizli (incognito) pencerede `https://SİTE/register` → ad, kendi e-postan, en az 8 karakterlik şifre,
   profil türü, onay kutusu → ekranda `Check your email` → gelen kutusuna **ve spam klasörüne** bak → kodu gir.

| Kayıtta gördüğün hata | Anlamı / çözüm |
|---|---|
| `Email sending is not set up on the server yet.` | Sunucudaki dosyada `mail_from` boş. Yeni dosyayı yüklemeyi unuttun ya da "Keep both" seçildi. |
| `The server could not send the email right now (mail server problem). Please try again later.` | **Sunucu tarafında SMTP hatası**: posta kutusu şifresi yanlış, 2FA açık (→ App password), port (→ 587 dene), posta kutusu yok, bağlantı/TLS kurulamadı. Tam SMTP cevabı sunucunun hata günlüğüne (`AURA mail: …`) yazılır. Emails → alan adı → **Email Logs → Access** sekmesinde başarısız SMTP girişlerini görebilirsin. |
| `We could not send the email. Check the address and try again.` | Alıcı adres reddedildi (geçersiz ya da karşı tarafta böyle bir posta kutusu yok). Adresi kontrol et. |
| `Please wait a minute before asking for another code.` | Aynı adrese dakikada bir kod. Bekle. |
| `Too many codes requested from this network. Try again later.` | Aynı ağdan saatte en fazla 12 kod. Bekle. |
| `This email is already registered. Sign in or reset your password.` | Bu adresle zaten hesap var. |

**E-posta yokken kodlar nerede görünür?** Yalnızca **demo modunda** (giriş sayfasının altında `○ Demo mode` yazıyorsa ya da
bilgisayarında `npm run dev` ile çalışırken) e-posta gönderilmez ve kod ekranda sarı bir kutuda çıkar:
`Demo mode: email sending is not connected, so here is your code: 123456`. Site **sunucuya bağlıyken** (`● Connected…`)
ve e-posta ayarlı değilken ekranda kod çıkmaz; kayıt `Email sending is not set up on the server yet.` hatası verir.
Jüri için sorun değil: demo düğmeleri ve demo hesaplar e-postasız çalışır.

---

## 8. Yeni özellikler yayınlandıktan sonra

**Ne zaman?** Her yayından sonra; özellikle koordinatör "yeni tablo var" dediğinde (yeni `public/api/schema/*.php`).
Yayın: `main` dalına push → GitHub'da **Actions** sekmesinde "Build and publish" yeşil tik → Hostinger `deploy` dalını
çeker (hPanel → **Advanced → Git**'te durumu görebilir, gerekirse **Redeploy** diyebilirsin).

**Neden?** Yeni özellikler kendi tablolarına ihtiyaç duyabilir; bu tablolar **sadece kurulum adresi açılınca** oluşur.
Açmazsan o özellik `Feature tables are not installed yet — re-run the installer (api/install.php).` hatası verir. `aura-config.php` yayından etkilenmez (`public_html`'in dışında).

**Nasıl?** Aynı kurulum adresini **`&reset=1` olmadan** aç. Beklenen:

```
Module ready: clinic
Module ready: env
Module ready: import
Module ready: <yeni-özellik-adı>
Tables ready.
Demo data already present — nothing else changed. Add &reset=1 to reload the demo crew.
```

İstediğin kadar açabilirsin; tablolar varsa dokunulmaz, veri silinmez.

> **Sunum günü ipucu:** Demo ekibinin verisi kurulumun yapıldığı güne göre yerleştirilir ve kurulum anından **sonraki**
> saatlere ait ölçümler yüklenmez. Günler geçince veri eski görünür. Sunum günü (sabah ölçümlerinin de gelmesi için
> tercihen 09:00'dan sonra) adresi bir kez `&reset=1` ile açın. Kayıtlı üyeler silinmez.

---

## 9. Sorun giderme

Önce health adresine bak: `"db":false` ise `reason` alanı sebebin kısa adını söyler (6a). Ayrıntılı mesaj için kurulum adresini aç.
Kurulum sayfası boş ya da `HTTP ERROR 500` gösteriyorsa PHP hatayı gizliyordur: hPanel → **PHP**
(ya da **Advanced → PHP Configuration**) → **Options** sekmesi → `display_errors`'ı **geçici olarak** aç, kurulum
adresini yenile, mesajı oku, sonra `display_errors`'ı **kapat** (Hostinger de canlı sitede kapalı tutmayı öneriyor).

### Kurulum sayfasının mesajları

| Ekranda gördüğün (aynen) | Sebep | Çözüm |
|---|---|---|
| `aura-config.php not found. Upload it next to (one level above) public_html first.` | Dosya `public_html`'in yanında değil (içinde, yanlış sitenin klasöründe, yanlış adla: `aura-config (1).php`, `aura-config.php.txt`). | 4. bölümdeki kontrol listesi. Adın tam `aura-config.php` olduğuna bak. Aracı tekrar çalıştırıp yükle. |
| `aura-config.php was found but has a PHP error on line N. Create it again with: node tools/make-config.mjs — then upload it with Replace.` | Dosya doğru yerde ama elle düzenlerken PHP bozulmuş (eksik tırnak/virgül, şifredeki `'` kaçışsız). | Aracı çalıştır, dosyayı **Replace** ile yükle. |
| `aura-config.php was found but does not return the settings (the file must contain: return [ ... ];). Create it again …` | Dosya doğru yerde ama içinde `return [ … ];` yok (yanlış dosya yüklenmiş ya da içerik silinmiş). | Aracı çalıştır, dosyayı **Replace** ile yükle. |
| `INSTALL FAILED during: <adım>` + altında hata metni | Tablo oluşturma/güncelleme ya da demo verisi yükleme sırasında veritabanı hata verdi. Demo verisi yarım kalmaz (o adım geri alınır). | Alttaki metni aşağıdaki "PHP / MySQL hata metinleri" tablosunda ara (ör. `1142 … command denied`). Düzelttikten sonra adresi tekrar aç. |
| `Forbidden: wrong or missing token (install_token must be at least 16 characters).` | Adresteki anahtar sunucudaki dosyadakiyle aynı değil: adres eksik kopyalandı, sunucuda eski dosya var ("Keep both" seçildi ya da yükleme unutuldu), anahtar 16 karakterden kısa. | Adresi araç çıktısından **tamamen** kopyala ya da VS Code'da `aura-config.php`'deki `install_token`'a bak. Dosyayı **Replace** ile yeniden yükle. |
| `Set demo_password (at least 8 characters) in aura-config.php.` | Demo şifresi boş ya da kısa. | Aracı çalıştır, [4/6]'da en az 8 karakter. |
| `aura-config.php still contains the placeholder CHANGE-ME for '…'. Replace it with your own value (or run: node tools/make-config.mjs).` | Örnek dosya kopyalanmış ama `CHANGE-ME` yazan bir alan (anahtar, şifre) değiştirilmemiş. Örnekteki değerler herkese açık olduğu için kurulum bunları kabul etmez. | `node tools/make-config.mjs` ile dosyayı yeniden üret ve **Replace** ile yükle. |
| `Database connection failed: …` | Veritabanına bağlanılamadı. Devamındaki metin sebebi söyler: `Access denied` = kullanıcı adı/şifre yanlış; `Unknown database` = veritabanı adı yanlış; `db_name or db_user is missing` = dosyada bu alanlar boş. | hPanel'deki veritabanı adı, kullanıcı ve şifreyi kontrol et; aracı tekrar çalıştırıp dosyayı yükle. |
| `seed.json is missing or invalid in /api. Redeploy the site.` | Site yayını eksik/bozuk. | GitHub Actions yeşil mi bak; hPanel → Advanced → Git → **Redeploy**. |
| Boş sayfa / `HTTP ERROR 500` / "This page isn't working" | PHP ölümcül hata verdi ve hatalar gizli. | Yukarıdaki `display_errors` yöntemiyle mesajı gör, aşağıdaki satırlardan birini bul. |

### PHP / MySQL hata metinleri (`display_errors` açıkken görünür)

| Ekranda gördüğün | Sebep | Çözüm |
|---|---|---|
| `SQLSTATE[HY000] [1045] Access denied for user 'u…'@'localhost' (using password: YES)` | Veritabanı şifresi (ya da kullanıcı adı) yanlış. | hPanel → Databases → **MySQL Users → Change Password** ile yeni şifre koy → aracı çalıştır (yeni şifre) → yükle. |
| `SQLSTATE[HY000] [1044] Access denied for user '…'@'localhost' to database '…'` | Kullanıcı bu veritabanına bağlı değil (ad ve kullanıcı farklı satırlardan alınmış). | Listede **aynı satırdaki** ad/kullanıcı çiftini kullan. |
| `SQLSTATE[HY000] [1049] Unknown database '…'` | Veritabanı adı yanlış (çoğunlukla `u123456789_` ön eki eksik). | Tam adı listeden kopyala. |
| `SQLSTATE[HY000] [2002] …` (No such file or directory / Connection refused / getaddrinfo) | `db_host` yanlış. | `localhost` olmalı (araç varsayılan olarak bunu yazar). Remote MySQL adresini ya da site adresini yazma. |
| `SQLSTATE[42000]: … 1142 … command denied to user …` | Kullanıcının tablo oluşturma/değiştirme yetkisi yok. | Veritabanını ve kullanıcıyı hPanel'in **MySQL Databases** ekranından birlikte oluştur; sürerse Hostinger desteğine "kullanıcının bu veritabanında tüm yetkileri olsun" de. |
| `could not find driver` | PHP'de `pdo_mysql` eklentisi kapalı. | hPanel → **PHP** (ya da Advanced → PHP Configuration) → eklentiler (extensions) sekmesi → `pdo_mysql` açık olsun. Sekmenin adı farklı olabilir. |
| `Uncaught RuntimeException: not_configured` | Dosyada `db_name` ya da `db_user` boş. | Aracı çalıştır. |
| `Parse error: syntax error, unexpected …` (`aura-config.php` içinde) | Elle düzenlerken PHP bozuldu (eksik tırnak/virgül, şifredeki `'` kaçışsız). | Aracı çalıştır, dosyayı **Replace** ile yükle. |
| `Warning: Cannot modify header information - headers already sent by (output started at …/aura-config.php:1)` | Dosya "UTF-8 with BOM" kaydedilmiş ya da `<?php`'den önce boşluk/yazı var. | Aracı çalıştır (BOM'suz yazar) ya da UTF-8 olarak kaydet. |
| `syntax error, unexpected …` ya da `Call to undefined function …` (`public_html/api/…` dosyalarında) | PHP sürümü eski olabilir. | hPanel → **PHP** (ya da Advanced → PHP Configuration) → en yeni **8.x** sürümünü seç → **Save**. Hostinger yalnızca hâlâ desteklenen sürümleri listeler. |

### Site ve giriş belirtileri

| Belirti | Sebep | Çözüm |
|---|---|---|
| Health: `"db":false` | `reason` alanına bak (6a). | Kurulum adresini aç, mesaja göre bu tablodan çöz. |
| Kurulum/health adresi 404 veriyor | Site yayında değil ya da adres yanlış (http/https, eski alan adı). | Sitenin ana sayfası açılıyor mu bak; GitHub Actions + hPanel Git. |
| Health `"db":true` ama giriş sayfasında `○ Demo mode` | Eski sayfa önbellekte. | **Ctrl+F5**. Gizli pencerede dene. |
| Demo düğmesinde `Demo user not found` | Veritabanında demo kullanıcıları yok (kurulum tamamlanmamış). | Kurulum adresini aç. |
| `Demo access is disabled` | `allow_demo` kapalı. | `node tools/make-config.mjs --demo` → yükle. |
| `Sign-up is closed` | `allow_signup` kapalı. | `node tools/make-config.mjs --signup` → yükle. |
| Demo kullanıcı adıyla `Unknown user or wrong password.` | Yanlış şifre, ya da demo şifresi kurulumdan **sonra** değiştirildi (şifre kurulumda veritabanına yazılır). | Kurulum adresini bir kez `&reset=1` ile aç. |
| `Too many attempts. Try again in 15 minutes.` | Aynı ağdan 15 dakikada 10 hatalı giriş. | 15 dakika bekle (`&reset=1` de bu sayacı sıfırlar). |
| Uygulamada `Database is not configured` | Sunucu `aura-config.php`'yi bulamadı ya da dosyada `db_name`/`db_user` boş. | 4. bölüm (doğru klasör); aracı çalıştır, yükle. |
| `Feature tables are not installed yet — re-run the installer (api/install.php).` | Yayından sonra kurulum adresi açılmadı (yeni tablo yok). | 8. bölüm. |
| `The database is not reachable right now. Please try again in a minute.` | Site çalışırken veritabanına bağlanılamadı (şifre değişti ya da MySQL geçici olarak kapalı). | Health'e bak (`"reason":"connect_failed"`), sonra kurulum adresini aç. |
| Uygulamada `Server error` | Beklenmeyen bir sunucu hatası; ayrıntı sunucunun hata günlüğünde (`AURA API: …`). | Koordinatöre haber ver (hangi sayfada, ne yaparken). |
| File Manager'da dosyayı düzenledim, değişmedi | Yeni File Manager düzenlemeleri **Deploy**'a kadar bekletir. | Sağ üstte **Deploy**'a bas ya da aracı çalıştırıp **Replace** ile yükle. |
| Gerçek alan adı bağlandıktan sonra `"db":false` | Site artık başka bir klasörden çalışıyor. | `aura-config.php`'yi yeni `domains/<alan-adı>/` klasörüne, `public_html`'in yanına yükle. |
| Şifrede `'` ya da `\` var, bağlanmıyor | Elle yazarken kaçış yapılmadı. | Aracı kullan (otomatik kaçış yapar). |
| Kodlar gelmiyor / spam'e düşüyor | DNS kayıtları (MX/SPF/DKIM/DMARC) eksik. | 7. bölüm, 3. adım. Emails → Email Logs → **Delivery** sekmesinde gönderim durumunu gör. |

---

## 10. Güvenlik kontrol listesi

- [ ] `aura-config.php` **asla GitHub'da değil.** `git status` (ya da GitHub Desktop'ta Changes) bu dosyayı listelememeli.
      `git add -f` kullanma.
- [ ] Proje klasöründe **kopya oluşturma**: `aura-config (1).php`, `aura-config.php.bak`, `aura-config.txt` gibi adlar
      `.gitignore`'da **değildir** ve GitHub'a gidebilir.
- [ ] Kurulum adresini, anahtarı ve şifreleri **sohbete yazma**: WhatsApp, Discord, e-posta, yapay zekâ sohbetleri, ekran
      paylaşımı, ekran görüntüsü, sunum slaytı, README. Ortak bilgisayarda tarayıcı geçmişinden kurulum adresini sil.
- [ ] Dosya `public_html`'in **içinde değil**, yanında.
- [ ] Demo şifresi jüriye söylenebilir; ama veritabanı ya da e-posta şifresiyle **aynı olmasın** (araç buna izin vermez).

**Sonradan değiştirmek** (her zaman: araç → yükle → gerekiyorsa kurulum adresi):

| Ne | Nasıl | Ek adım |
|---|---|---|
| Veritabanı şifresi | hPanel → Databases → MySQL Users → **Change Password** → araç ([3/6]'da yeni şifre) → **Replace** ile yükle | Yükleyene kadar site demo moduna düşer. |
| Posta kutusu şifresi | hPanel → Emails → Mailboxes → **Change password** → araç ([5/6]) → yükle | — |
| `install_token` / `app_secret` | Araç → "Aynı kalsınlar mı?" sorusuna **h** → yükle | Eski kurulum adresi çalışmaz; yenisini araç yazar. |
| Demo şifresi | Araç → [4/6]'da yeni şifre (ya da `yeni` yaz) → yükle | Kurulum adresini **`&reset=1`** ile bir kez aç. |

**Bir sır sızarsa** (GitHub'a gitti, gruba yazıldı, ekranda göründü):

1. Silmek yetmez: depo herkese açık, botlar dakikalar içinde tarar. **Sızmış kabul et.**
2. hPanel'de **veritabanı şifresini** ve **posta kutusu şifresini** değiştir.
3. Aracı çalıştır: yeni şifreleri gir, "Aynı kalsınlar mı?" → **h**, demo şifresine `yeni` yaz.
4. Dosyayı **Replace** ile yükle, kurulum adresini (yeni anahtarla) **`&reset=1`** ile bir kez aç.
5. Koordinatöre haber ver (dosya depodan ve geçmişten temizlensin).
6. Emails → **Email Logs → Access** sekmesinde tanımadığın girişler var mı bak.

**Demo düğmelerini / kaydı kapatmak:**

```powershell
node tools/make-config.mjs --no-signup     # e-postayla yeni kayıt kapalı
node tools/make-config.mjs --no-demo       # tek tık demo düğmeleri kapalı
node tools/make-config.mjs --demo --signup # ikisini geri aç
```

Araç yine soruları sorar; hepsine Enter de, sonra dosyayı yükle. Kapalıyken düğmeler sayfada **görünmeye devam eder**,
ama sunucu `Demo access is disabled` / `Sign-up is closed` cevabı verir. **Jüri değerlendirmesi bitmeden `--no-demo`
kullanmayın** — jüri demo düğmeleriyle girer.

---

## Kaynaklar (Hostinger'ın kendi sayfaları, Kasım 2026'da okundu)

- Veritabanları (oluşturma, `localhost`, şifre değiştirme, phpMyAdmin): https://docs.hostinger.com/websites/databases
- MySQL veritabanı oluşturma (ön ek, şifre kuralı, eski ekran): https://www.hostinger.com/support/1583542-how-to-create-a-new-mysql-database-in-hostinger/
- File Manager (`domains/<alan-adı>`'nda açılır, `public_html` herkese açıktır, Deploy): https://docs.hostinger.com/websites/file-manager
- Dosya yükleme (To alanı, Replace / Keep both): https://docs.hostinger.com/websites/file-manager/upload-files.md
- Düzenleme ve Deploy: https://docs.hostinger.com/websites/file-manager/edit-and-deploy.md
- File Manager temel işlemler (Home klasörü, All hosting files): https://www.hostinger.com/support/4548688-basic-actions-in-the-file-manager/
- Site kök dizini yolları: https://www.hostinger.com/support/1583494-what-is-the-path-to-your-website-s-root-home-directory-and-how-to-change-it-in-hostinger/
- Git dağıtımı (Advanced → Git, her yayında dosyaları değiştirir, Redeploy): https://docs.hostinger.com/websites/git.md
- PHP sürümü ve `display_errors`: https://docs.hostinger.com/websites/php.md
- Posta kutusu oluşturma, şifre kuralları, App password: https://docs.hostinger.com/emails/mailboxes.md
- SMTP ayarları (`smtp.hostinger.com`, 465 SSL/TLS, kullanıcı adı = tam adres): https://docs.hostinger.com/emails/setup-devices
- SMTP portları 465 / 587: https://www.hostinger.com/tutorials/smtp-port/
- E-posta DNS kayıtları (MX, SPF, DKIM, DMARC): https://docs.hostinger.com/emails/domain-settings.md
- Email Logs (Delivery / Access): https://docs.hostinger.com/emails/email-logs.md
- Gerçek alan adını bağlama: https://www.hostinger.com/support/10085905-how-to-connect-a-preferred-domain-name-instead-of-a-temporary-one-at-hostinger/
