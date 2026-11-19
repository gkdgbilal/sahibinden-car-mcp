# Araç kataloğu (marka → seri → motor) ve kategori filtre profilleri

Tarih: 2026-11-19. Kod: `src/sahibinden/catalog.ts`, `catalog-learn.ts`, `catalog.json`; üretim: `scripts/build-catalog.mjs` + `scripts/catalog-data/`.

## Neden
Sahibinden yolları marka/seri/motor için tek bir kalıba uymaz: Mercedes `mercedes-benz-c-serisi-c-200-d`, BMW `bmw-3-serisi-320d`, Opel `opel-astra-1.3-cdti`, SUV'lar ise ayrı kategoride `arazi-suv-pickup-bmw-x5`. Slug tahmini bu yüzden güvenilir değildir; yollar sitenin kendi kategori ağacından toplandı.

## Kaynak ve yapı
Kaynak: arama sayfasının sidebar'ındaki `#searchCategoryContainer` ağacı. Her `li` sınıfı seviyeyi verir: `cl2` marka, `cl3` seri/model, `cl4` motor, `cl5` donanım paketi (toplanmadı). Üç kategori aynı yapıdadır:

| Kategori | Yol öneki | Marka sayısı |
|---|---|---|
| Otomobil | (yok) `/bmw-3-serisi` | 96 |
| Arazi, SUV & Pickup | `arazi-suv-pickup-` | 72 |
| Minivan & Panelvan | `minivan-panelvan-` | 41 |

`catalog.json`: `{categories: {<kategori>: {<markaSlug>: {l, s: {<seriSlug>: {l, e: [motor...]|null}}, u?}}}}`. Yol = önek + marka + `-` + seri [+ `-` + motor]. `u: true` = markanın seri listesi bu kategoride taranmadı. Elektrikli araçlar ayrı kategori değil, yakıt filtresidir (`/otomobil/elektrik`).

## Çözümleme sırası (`Catalog.resolve`)
1. Marka (ad/slug/kısaltma: `Mercedes`, `Benz`, `VW`) → kategorilerdeki kayıtlar. Marka yoksa modelden çıkarılır (yalnızca **tam** seri/motor eşleşmesi).
2. Model, boşluk/tire/büyük-küçük harf yok sayılarak (`C200d` = `C 200 d` = `c-200-d`) sırayla: tam motor → tam seri → "motor + ek parça" (motor sayfası, paket not edilir) → "seri + bilinmeyen motor" (seri sayfası, benzer yollar not edilir). Tek harf/rakamlı seri anahtarları (`c`, `3`, `z`) kalan parça o serinin bir motoruna benzemiyorsa eşleşmez (`Zzz` ≠ Z Serisi).
3. Hiç eşleşme yoksa: marka sayfası + mevcut serilerin listesi (not). Marka `u` ise yol, taranan 566 serinin tamamında geçerli olan kuralla (`{marka}-{slug(model)}`) türetilir; **tek** kategoride (model ipucu `:suv`/`:minivan`, yoksa otomobil) ve `exact:false` + "doğrulanmadı" notuyla.
4. Katalogda marka bile yoksa eski yol tahmini (doğrulanmadı notu).

## Öğrenme
`ImportProvider` her arama sayfasının sidebar ağacını `CatalogLearner` ile kataloğa işler (tarayıcı modu da aynı `ingest` yolundan geçer). Yeni seri/motor `~/.sahibinden-car-mcp/catalog-learned.json` dosyasına yazılır ve açılışta yüklenir. Ek istek atılmaz; yalnızca zaten açılan sayfalar kullanılır.

## Kategori filtre profilleri (`CATEGORY_PROFILES`, canlı sidebar'dan)
Başka kategorinin kimliği sessizce yok sayılır; her kategori kendi parametrelerini kullanır.

| Alan | Otomobil | SUV | Minivan & Panelvan |
|---|---|---|---|
| Yıl / KM | `a5` / `a4` | `a277` / `a276` | `a767` / `a766` |
| Vites | `a6` | `a279` | `a3807` |
| Yakıt | `a17` | `a287` | `a1847` |
| Kimden | `a706` | `a448` | `a769` |
| Renk | `a3` | `a275` | `a2045` |
| Araç durumu | `a113987` | `a113988` | yok |
| Kasa | `a8` | `a107181` (Crossover 1209954, Pickup 1209952, SUV 1209956) | `a96780` (Camlı Van 1119668, Yarım Camlı 1180829, Panel Van 1119672, Frigorifik 1183345, Minibüs 1171677) |
| Motor gücü | `a2320` | `a2321` | `a4391` |
| Motor hacmi | `a1864` | `a2319` | `a4390` |
| Çekiş | `a9213` | `a95938` (4x2 arkadan 1105164, önden 1105162, 4x4 10122) | `a107201` (arkadan 1210973, önden 1210971, 4x4 1210972) |
| Ağır hasar | `a116445` | `a116446` | `a116447` |
| Servis garantisi | `a4054` | `a87472` | yok |

Aralık sınırları kategoriler arasında farklıdır: SUV hacminde 4001-5000 ve 5001-6000 cc tek kutu; minivan hacminde 5001 cc ve üzeri, güçte 501 hp ve üzeri tek kutu. URL bu durumda daha geniş aralığı getirir; `note` bunu söyler, yerel filtre kesindir. SUV/minivan'da AWD ayrı bir seçenek değildir, 4x4 kullanılır (not). Ortak parametreler (`price_min/max`, `price_currency`, `address_city`, `exchange`, `date`, `unpaintedParts`, `unchangingTracks`, `sorting`, `pagingOffset`) tüm kategorilerde aynıdır.

## Doğrulama durumu
- Canlı sidebar'dan okundu (2026-11-19): üç kategorinin tüm filtre kimlikleri (otomobil değerleri önceki doğrulamayla birebir aynı çıktı), 96 otomobil + 72 SUV + 41 minivan marka adı, 78 otomobil markasının seri listesi (566 seri), BMW SUV serileri, BMW 3 Serisi motorları.
- Önceki oturumda doğrulananlar: Mercedes A/B/C/E/S/R seri yolları ve C 200 d motorları, Opel Astra 1.3 CDTI, Land Rover SUV modelleri.
- **Doğrulanmadı / eksik:** 18 otomobil markasının seri listesi (Seat, Skoda, Smart, Subaru, Suzuki, Tata, Tesla, The London Taxi, Tofaş, TOGG, Toyota, Vanderhall, Volkswagen, Volta, Volvo, XEV, Yuki, Zlin Motors), SUV/minivan marka seri listeleri (BMW SUV ve Land Rover hariç), motor listeleri (birkaç seri hariç), donanım paketi (`cl5`) yolları.

## Tarama sınırı (önemli)
Tarama 82 istekte (~18 istek/dk, yaklaşık 5,5 dk) sahibinden'in **"2 Aşamalı Doğrulama"** sayfasıyla kesildi; 60 sn sonra yeniden denendiğinde de sürdü. Bu kapı artık challenge olarak tanınıyor (`detectPageType`, CDP hızlı kontrol). Kural: kataloğu toplu taramayla genişletme; tarayıcı modunun varsayılan sınırlarını (en az 5 sn aralık, saatte 30 istek) aşma. Eksikleri kapatmanın yolu, ilgili marka/seri sayfalarını `import_listing_html` ile içe aktarmaktır (katalog kendiliğinden öğrenir) ya da çok yavaş, kısa partilerle (`scripts/build-catalog.mjs` girdileri) elle eklemektir.
