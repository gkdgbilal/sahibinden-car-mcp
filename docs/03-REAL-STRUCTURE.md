# Gerçek sayfa yapısı (2026-11-18, kullanıcının kendi Chrome oturumundan gözlem)

Yalnızca yapı bilgisi; gerçek ilan verisi/satıcı bilgisi burada yok. Fixture'lar bu yapıyı taklit eden UYDURMA verilerle yazılmalı.

## Arama sonuç sayfası (örn. /opel-astra-1.3-cdti)
- `<title>`: "Opel Astra 1.3 CDTI Fiyatları & Modelleri sahibinden.com'da"
- Toplam: metin "aramanızda 2.836 ilan bulundu." (binlik ayraç nokta)
- Sonuç tablosu satırları: `<tr class="searchResultsItem ">`, **`data-id="<ilanNo>"` özniteliği** ilan numarasıdır.
- Reklam satırları: `<tr class="searchResultsItem nativeAd classicNativeAd">` — `data-id` YOK, tek boş `<td>`; ATLANMALI.
- Hücreler (sırayla `td` sınıfları):
  1. `searchResultsLargeThumbnail` — içinde `<a href="/ilan/vasita-otomobil-opel-2006-astra-...-1351425350/detay" title="<başlık>">` + `<img>`
  2. `searchResultsTagAttributeValue` — model/donanım, örn. "1.3 CDTI Enjoy"
  3. `searchResultsTitleValue` — başlık metni (içinde favori butonları/hidden input'lar var; başlık için `a.classifiedTitle` ya da td metni, favori metinlerini dışla). Bu hücredeki `a.classifiedTitle`'ın href'i bazı satırlarda "#" olabilir → URL'yi thumbnail `a[href^="/ilan/"]`'dan al.
  4. `searchResultsAttributeValue` ×3 — sırayla **yıl**, **km** ("226.000"), **renk**
  5. `searchResultsPriceValue` — "549.000 TL"
  6. `searchResultsDateValue` — "18 Kasım 2026"
  7. `searchResultsLocationValue` — şehir filtresiz sayfada "Kocaeli Körfez" (il + ilçe), şehir filtreli sayfada "İlkadım Merkez" (ilçe + mahalle); bkz. docs/04-URL-SCHEMA.md
  8. `ignore-me`
- Başlık satırı (thead) etiketleri gözlemlenemedi; sütun sırası yukarıdaki gibi (yıl, km, renk). Vites bu listede YOK.
- Sayfalama: `<ul class="pageNaviButtons">`, bağlantılar `?pagingOffset=20`, `40`, ... (sayfa başı 20 ilan).
- Kategori URL şeması: `/{marka}-{seri}-{motor}` slug'ları, örn. `/opel-astra-1.3-cdti`.

## İlan detay sayfası (/ilan/vasita-otomobil-...-<ilanNo>/detay)
- `<title>`: "Opel / Astra / 1.3 CDTI / Enjoy / <başlık> sahibinden.comda - <ilanNo>"
- Başlık: `h1` (`.classifiedDetailTitle h1`)
- Fiyat: `h3.classifiedPriceValue` ("549.000 TL"), üst eleman `.classifiedPrice`. Aynı alanda `h3.price-all` ("Tüm Fiyat Değişimlerini Gör") gürültüsü var.
- Özellikler: **`<dl>` içinde `<dt>` etiket + sonraki `<dd>` değer** çiftleri. Gözlenen etiketler (tam yazılış):
  `İlan No`, `İlan Tarihi` ("18 Kasım 2026"), `Marka`, `Seri`, `Model`, `Yıl`, `Yakıt / Motor Tipi`, `Vites`, `Araç Durumu`, **`KM`** (not "Kilometre"), `Kasa Tipi`, `Motor Gücü` ("90 hp"), `Motor Hacmi` ("1248 cc"), `Çekiş`, `Renk`, `Servis Garantisi`, `Ağır Hasar Kayıtlı`, `Plaka / Uyruk`, `Kimden` ("Sahibinden"/galeriden; = satıcı TİPİ, saklanabilir), `Takas`.
  - NOT: `dt` etiketlerinde baş/son boşluk var (örn. `<dt> Motor Gücü</dt>`) → trim et.
  - NOT: sayfada başka `<dl>`/`dt` blokları (giriş formu hata satırları vb.) var → yalnızca bilinen etiketlere göre eşle, gerisini yok say.
- Açıklama: `<div id="classifiedDescription">`
- Boya/değişen şeması: `<div class="damage-area">` içinde
  - lejant: `<div class="car-damage-info"><span class="original">Orijinal</span><span class="local-painted-new">Lokal Boyalı</span><span class="painted-new">Boyalı</span><span class="changed-new">Değişen</span></div>` — bunlar LEJANT, parça sonucu değil.
  - parça durumu: parça elemanlarında sınıf = `<parça-adı> <durum-sınıfı>` örn. `front-right-mudguard painted-new` (metin "B"), durum sınıfları: `original`, `local-painted-new`, `painted-new`, `changed-new`. Parça adları: front-right-mudguard, front-right-door, rear-right-mudguard, front-left-mudguard ... (tam liste gözlemlenemedi; sınıf kalıbıyla genel çöz: lejant dışındaki elemanlarda `*-new`/`original` sınıfı olan her eleman bir parçadır).
  - Metin kısaltmaları: "B" = boyalı, "D" = değişen, "L" = lokal boyalı (varsayım; doğrulanmadı).
- Konum (doğrulandı: 2026-11-18): `<p>` içinde `a[data-click-label^="Adres Breadcrumb |"]` bağlantıları sırayla il / ilçe / mahalle ("Kocaeli / Körfez / Çamlıtepe Mh." biçimi; araya semt/bölge halkası girebilir → ilk = il, ikinci = ilçe, SON = mahalle; ikiden azsa eldeki kullanılır). Yedek: `<div id="gmap" data-city="<plaka>" data-town-name="..." data-quarter-name="...">`. Parser önce breadcrumb, sonra gmap kullanır; ikisi de yoksa null + "konum okunamadı" uyarısı.
- Satıcı adı/telefon: parse ETME (sayfada "Hesap açma tarihi", "Cep" vb. alanlar var; yok say).
- JSON-LD yalnızca BreadcrumbList; ilan verisi içermiyor.
- Sayfada ilanı favoriye ekleme bildirimi vb. gizli metinler ("İlan Favori Listenize Eklendi") olabilir; yok say.

## Erişim notu
Sunucudan curl ile 403 Cloudflare challenge; kullanıcının kendi giriş yapmış Chrome oturumunda sayfalar sorunsuz açılıyor. MCP ağ isteği atmaz; akış: kullanıcı Cmd+S → inbox → import.
