# search_cars filtre denetimi (2026-11-18)

Her `searchCarsInput` alanı için iki soru: (1) yerel mağazadaki ilanlara uygulanıyor mu, (2) sahibinden URL'sine yansıyor mu.
"Önce" sütunu 0.1.0 durumudur; "Sonra" sütunu 0.1.1'dir (hedef: her filtrede iki sütun da evet).

| Alan | Önce: yerel | Önce: URL | Sonra: yerel | Sonra: URL | Yerel kural |
|---|---|---|---|---|---|
| city | evet | evet | evet | evet | `foldTr` eşitliği; ilanın şehri yoksa bilinmiyor |
| brand | evet | evet | evet | evet | `foldTr` eşitliği; marka yoksa başlıkta geçiyorsa geçer, yoksa bilinmiyor |
| models[] | evet | evet | evet | evet | seri/model/başlıkta `foldTr` içerme (herhangi biri) |
| priceMin / priceMax | kısmen (yalnız TL; EUR ilan "bilinmiyor" diye içeri giriyordu) | evet | evet | evet | `priceCurrency` (varsayılan TL) cinsinden; farklı para birimli ilan elenir (dönüşüm yok), `excludedOtherCurrency` |
| priceCurrency | hayır | evet | evet | evet | fiyat filtresinin para birimi; filtre yoksa para birimi elemez |
| transmission | evet | kısmen | evet | kısmen | eşitlik. Yarı otomatik için sahibinden kimliği bilinmiyor: URL'ye eklenmez, `note` düşer |
| fuel | evet | evet | evet | evet | eşitlik |
| yearMin / yearMax | evet | evet | evet | evet | sayısal aralık |
| kmMin / kmMax | evet | evet | evet | evet | sayısal aralık |
| color | hayır | evet | evet | evet | `listing.color` etiketi (Bej, Beyaz, ... ) `foldTr` ile; 18 renk (Siyah, Sarı, Şampanya, Turkuaz, Turuncu, Yeşil dahil; Türkçe ve İngilizce etiket); dolu ama listede olmayan renk hiçbir renk filtresine uymaz |
| bodyType | hayır | evet | evet | evet | detay `bodyType` etiketi (`Hatchback 5 Kapı` vb.) |
| sellerType | hayır | evet | evet | evet | detay `sellerType` |
| vehicleCondition | hayır | evet | evet | evet | detay `vehicleCondition` (İkinci El / İthal Sıfır / Sıfır) |
| enginePower | hayır | evet | evet | evet | `url-schema` id anahtarlarından türetilen (alt, üst] hp aralığı; `engine.powerHp`; 24 aralık, "601-up" açık uçlu |
| engineVolume | hayır | evet | evet | evet | aynı şekilde cc aralığı; `engine.volumeCc`; "6001-up" açık uçlu |
| drivetrain | hayır | evet | evet | evet | detay `drivetrain` (Önden/Arkadan/4WD/AWD) |
| exchange | hayır | evet | evet | evet | detay `exchange` (true/false) |
| warranty (yeni) | - | - | evet | evet | detay `warranty`; URL `a4054` (72906 Evet, 72907 Hayır) |
| listedWithin | hayır | evet | evet | evet | `listingDate` ile "şimdi" arasındaki gün farkı <= 1/3/7/15/30 (gün hassasiyeti; `now` sağlayıcıdan gelir) |
| unpaintedOnly | hayır | evet | evet | evet | `damage`te `painted` veya `local-painted` parça yok; damage yoksa bilinmiyor |
| noReplacedParts | hayır | evet | evet | evet | `damage`te `changed` parça yok; damage yoksa bilinmiyor |
| noHeavyDamage (yeni) | - | - | evet | evet | `heavyDamage === false`; null/yok bilinmiyor; URL `a116445=1263354` |
| sort | evet | evet | evet | evet | 8 sıralama, null sona |
| limit | evet | hayır | evet | hayır | doğası gereği yalnızca yerel (sonuç sayısı) |
| unknown / includeUnknown | evet | hayır | evet | hayır | doğası gereği yalnızca yerel (bilinmeyen alan politikası) |
| page | hayır | evet | hayır | evet | doğası gereği yalnızca URL (sahibinden sayfası, 20 ilan); yerel sonuç `limit` ile sınırlanır. `urlOnlyFilters` içinde sayılmaz |

## Yerel kurallar

- Bilinen ve uyuşmayan alan her zaman eler. Bilinmeyen alan (özet kaydında olmayan detay alanları dahil) `unknown` politikasına göre: `include` (varsayılan) ilanı `unknownFields` ile işaretleyip döner, `exclude` eler ve `excludedUnknown` sayılır. `includeUnknown: false` eski ad olarak `unknown: 'exclude'` demektir.
- Detay alanları (bodyType, drivetrain, vehicleCondition, sellerType, exchange, warranty, heavyDamage, engine, damage) yalnızca detay sayfası içe aktarılmış ilanlarda bilinir; arama sonucu satırından gelen özet kayıtlarda bu alanlar bilinmiyor sayılır (arama satırında yalnızca renk vardır).
- `excludedOtherCurrency` yalnızca ilanı sadece para birimi eleyince artar (başka kural da eleyecekse sayılmaz). `excludedUnknown` için de aynı.
- Çıktı: `appliedFilters` (yerelde uygulanan filtre adları), `urlOnlyFilters` (yalnızca URL'ye yansıyan; şu an her zaman boş).

## Kalan sınırlar

- Motor hacmi 2501-5500 cc aralıklarının sahibinden kimlikleri alınmadı; yalnızca 5501-6000 ve 6001+ var (bu aralıklar için filtre sunulmuyor).
- Hibrit türleri (Plug-in, Hafif Hibrit) ayrı seçilemez: `fuel: hybrid` yalnızca Benzin(Hibrit) (a17=1312756) olur; diğer kimlikler URL `note`unda listelenir. Yerel `hybrid` hepsini kapsar.
- Yarı otomatik vites URL'ye yansımaz (kimlik bilinmiyor); yerelde uygulanır.
- 55 ve 34 dışındaki il plaka kodları URL'de doğrulanmadı (yerel şehir filtresi etkilenmez).
- Etiket eşlemeleri (renk, kasa, çekiş, araç durumu) sahibinden'in Türkçe metnine dayanır; tanınmayan çekiş/araç durumu etiketi, dolu ama eşleşmeyen değer sayıldığı için o filtreyle eler.
- Para birimi dönüşümü yoktur; farklı para birimli ilanlar fiyat filtresinde elenir.
- Boyasız/değişensiz filtresi sahibinden'in kendi tanımıyla birebir aynı olmayabilir (yerelde: boyalı = painted + local-painted).
