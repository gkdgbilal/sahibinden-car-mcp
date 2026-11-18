# Sahibinden URL şeması (doğrulama tarihi: 2026-11-18)

Kaynak: kullanıcının kendi Chrome oturumunda gerçek sahibinden sayfasından, sitenin kendi filtre bağlantıları okunarak elde edildi (etiket = değer). Bu projede ağ isteği kodu yoktur; değerler yalnızca URL üretmek için kullanılır. Tek doğruluk kaynağı: `src/sahibinden/url-schema.ts` (`verified:true/false`).

## Doğrulanmış

### Kategori yolu
- `/{marka}-{seri}-{motor}`, örn. `/opel-astra-1.3-cdti` (motor hacmindeki nokta korunur).
- Marka-seri: `/opel-astra`. Yalnızca marka: `/opel`. Tüm otomobil: `/otomobil`.
- Şehir filtresi sitede yola yönlendirilir: `/opel-astra-1.3-cdti/samsun`.

### Sayısal aralıklar, sıralama, sayfalama
| Parametre | Anlam | Değerler |
|---|---|---|
| `price_min`, `price_max` | Fiyat | TL |
| `price_currency` | Para birimi | 2 USD, 3 EUR, 4 GBP (TL için parametre yok) |
| `a5_min`, `a5_max` | Yıl | `a5_max=2011` çalıştı |
| `a4_min`, `a4_max` | KM | `a4_max=250000` ile sonuçların hepsi ≤ 250.000 |
| `sorting` | Sıralama | `price_asc`, `price_desc`, `date_desc`, `date_asc`, `km-nu_asc`, `km-nu_desc`, `yil-nu_asc`, `yil-nu_desc` (`price_asc` çalıştığı görüldü) |
| `pagingOffset` | Sayfalama | 20, 40, ... (sayfa başı 20) |
| `date` | İlan tarihi | `1day`, `3days`, `7days`, `15days`, `30days` |
| `exchange` | Takas | `yes`, `no` |
| `unpaintedParts` | Boyasız | `true` |
| `unchangingTracks` | Değişensiz | `true` |


### Kimlikli filtreler
| Parametre | Alan | Değerler |
|---|---|---|
| `a6` | Vites | 32467 Manuel, 32466 Otomatik (site `/manuel` yoluna yönlendirir; sorun değil) |
| `a17` | Yakıt | 21 Benzin, 22 Dizel, 50276 Benzin(LPG), 1202111 Elektrik, 1312756 Benzin(Hibrit), 1312757 Benzin(Plug-in Hibrit), 1312755 Benzin(Hafif Hibrit), 1312754 Dizel(Hafif Hibrit) |
| `a706` | Kimden | 32474 Sahibinden, 32475 Galeriden, 1160380 Yetkili Bayiden |
| `a8` | Kasa | 240 Cabrio, 48626 Coupe, 1263542 Coupe 4 kapı, 20 Hatchback 3 kapı, 62068 Hatchback 5 kapı, 250 Sedan, 19 Station Wagon, 1197465 MPV, 1197466 Roadster |
| `a3` | Renk | 655354 Bej, 33611 Beyaz, 33617 Bordo, 658878 Füme, 33612 Gri, 40948 Gümüş Gri, 33621 Kahverengi, 33613 Kırmızı, 33615 Lacivert, 33610 Mavi, 33624 Mor, 40167 Pembe, 33614 Sarı, 33616 Siyah, 675106 Şampanya, 44926 Turkuaz, 40148 Turuncu, 33618 Yeşil |
| `a113987` | Araç durumu | 1252385 İkinci El, 1252386 Yurtdışından İthal Sıfır, 1252387 Sıfır |
| `a2320` | Motor gücü aralığı (`a17` yakıt kimlikleriyle karıştırılmamalı) | 1096156 ≤50 hp, 1096158 51-75, 74344 76-100, 74345 101-125, 74346 126-150, 74347 151-175, 74348 176-200, 74349 201-225, 74350 226-250, 74351 251-275, 74352 276-300, 74353 301-325, 74354 326-350, 74355 351-375, 74356 376-400, 74357 401-425, 74358 426-450, 74359 451-475, 74360 476-500, 74361 501-525, 74362 526-550, 74363 551-575, 74364 576-600, 74365 601 hp ve üzeri (araç anahtarı `601-up`, açık uçlu) |
| `a1864` | Motor hacmi aralığı | 51977 ≤1300 cc, 1118042 1301-1600, 51979 1601-1800, 51980 1801-2000, 51981 2001-2500, 51982 2501-3000, 51983 3001-3500, 51984 3501-4000, 51985 4001-4500, 74366 4501-5000, 74367 5001-5500, 74368 5501-6000, 74369 6001 cc ve üzeri (`6001-up`, açık uçlu) |
| `a9213` | Çekiş | 136269 Önden, 136270 Arkadan, 136271 4WD, 136272 AWD |
| `a116445` | Ağır Hasar Kayıtlı | 1263353 Evet, 1263354 Hayır (araç: `noHeavyDamage` -> 1263354) |
| `a4054` | Servis Garantisi | 72906 Evet, 72907 Hayır (araç: `warranty`) |

### Şehir
- `address_city={plaka kodu}`; **yalnızca 55 (Samsun) ve 34 (İstanbul) doğrulandı** (site yola yönlendirir, sonuçlar o şehirden).
- Diğer 79 ilin plaka kodu (`CITIES` tablosu) **varsayımdır, doğrulanmadı**: araç, bu şehirler için URL'ye kodu ekler ama `note` içinde uyarır.
- Şehir adı Türkçe katlama ile eşlenir (`izmir`, `İZMİR`, `Izmir` -> İzmir); plaka kodu da girilebilir. Tanınmayan şehir URL'ye eklenmez, not düşülür.

### Birleşik filtre (doğrulandı)
`/opel-astra-1.3-cdti/samsun?a6=32467&price_max=600000&a4_max=250000&a5_min=2008&sorting=price_asc` -> 3 ilan, hepsi kısıtlara uyuyor.

## Doğrulanmamış / bilinmeyen
- 55 ve 34 dışındaki il plaka kodlarının `address_city` değeri olarak kabulü.
- Yarı otomatik vites kimliği (bilinmiyor; URL'ye eklenmez).
- Aynı parametrede birden çok değer (ör. birden çok renk/yakıt) ve hibrit türlerinin birlikte seçimi; araç tek değer üretir. `hybrid` -> `1312756`; diğer hibrit kimlikleri `note` içinde listelenir.
- `pagingSize` (eski varsayım) kaldırıldı; sayfa boyutu 20 sabittir.
- Motor segmenti yolu (`-1.3-cdti`) yalnızca model metnine yazılırsa üretilir; ayrı bir filtre alanı yoktur.

## Araç alan eşlemesi (`search_cars`)
`transmission`->a6, `fuel`->a17, `sellerType`->a706, `bodyType`->a8, `color`->a3, `vehicleCondition`->a113987, `enginePower`->a2320, `engineVolume`->a1864, `drivetrain`->a9213, `exchange`->exchange, `listedWithin`->date, `unpaintedOnly`->unpaintedParts, `noReplacedParts`->unchangingTracks, `noHeavyDamage`->a116445, `warranty`->a4054, `priceCurrency`->price_currency, `city`->address_city, `page`->pagingOffset, `sort`->sorting. Bu alanların hepsi 0.1.1'den beri yerel mağaza filtresinde de uygulanır (tablo ve kurallar: `docs/05-FILTER-AUDIT.md`); `page` yalnızca URL'ye yansır.

## Arama sonucundaki konum hücresi (parser)
`searchResultsLocationValue` biçimi sayfa bağlamına göre değişir:
- Şehir filtresiz sayfa: **"İl İlçe"** (örn. "Kocaeli Körfez").
- Şehir filtreli sayfa: **"İlçe Mahalle"** (örn. "İlkadım Merkez", "Atakum Altınkum").

Parser bağlamı şu sırayla belirler: (1) çağıranın verdiği `cityHint` (`import_listing_html` aracında da var), (2) sayfa URL'si (canonical/`og:url`/`sourceUrl`): son yol parçası şehir slug'ı ya da `address_city=<plaka>`, (3) `<title>` şehir adıyla başlıyorsa ("Samsun Opel Astra ... Fiyatları"). Sinyal yoksa filtresiz varsayılır (il = ilk sözcük; ilk sözcük bir il adı değilse belirsiz sayılır). Çelişen sinyaller ya da şehir filtreli sayfada il adıyla başlayan hücre -> il/ilçe `null`, ham metin `locationRaw`'da, `warnings`'e uyarı; tahmin yürütülmez. Şehir filtreli sayfada ilçe = ilk sözcük (sayıyla başlıyorsa ilk iki, "19 Mayıs"), kalanı `neighborhood`; ayrım sezgisel olduğundan `locationRaw` de yazılır.
