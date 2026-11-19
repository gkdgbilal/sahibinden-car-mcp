# Yapılacaklar (son güncelleme: 2026-11-19)

Durum: v0.2.1 GitHub'da (`main`, 4fdb1df) ve kullanıcı kapsamında eklenti olarak kurulu; v0.2.2 (katalog) ve v0.3.0 (rank_cars + market_stats) yerelde commit'li, push/plugin update bekliyor
(`/plugin install sahibinden-car@sahibinden-car`). Hedef: kullanıcı "Claude, bu skill'i yükle" der,
sonra "2015 Mercedes C200d otomatik, 200 bin km altı, en mantıklı 5 ilanı listele" yazar.

## Yarın, sırayla

0. **Önce Chrome'da sahibinden'e elle gir.** 2026-11-19'da otomatik tarama (82 istek, ~18 istek/dk) "2 Aşamalı
   Doğrulama" kapısına takıldı. Kapı çıkıyorsa doğrulamayı elle tamamla. Toplu tarama YAPMA (bkz. docs/10-CATALOG.md).
1. **Katalog eksiklerini kapat (0.2.2'de eklendi, docs/10-CATALOG.md).** Seri listesi eksik: Seat, Skoda, Smart, Subaru,
   Suzuki, Tata, Tesla, The London Taxi, Tofaş, TOGG, Toyota, Vanderhall, Volkswagen, Volta, Volvo, XEV, Yuki, Zlin
   Motors; SUV/minivan marka serileri (BMW SUV ve Land Rover hariç); motor listeleri. Yol: önce yaygın markaların
   (VW, Toyota, Skoda, Volvo; SUV: Tiguan/X3/GLC/Qashqai/Duster) arama sayfalarını Cmd+S ile `inbox`'a kaydedip
   `import_listing_html` ile içe aktar (katalog kendiliğinden öğrenir, `~/.sahibinden-car-mcp/catalog-learned.json`).
   Gerekirse çok yavaş (15 sn+), kısa partilerle (en çok ~10 istek) `scripts/catalog-data/` girdilerini genişlet,
   `node scripts/build-catalog.mjs` çalıştır.
2. **SUV sayfası ayrıştırma testi.** SUV arama satırı sütun düzeni farklı (motor | başlık | yıl | km | renk | fiyat).
   Gerçek bir Discovery arama sayfasını (ve 1-2 ilan detayını) Cmd+S ile `~/.sahibinden-car-mcp/inbox`'a kaydet,
   `import_listing_html` ile içe aktar, parser sonuçlarını kontrol et (yıl/km/fiyat/seri). Gerekirse parser'ı düzelt.
   Örnek adres: `/arazi-suv-pickup-land-rover-discovery?a277_min=2015&a277_max=2015&a276_max=200000&a287=400&a279=33625`
3. **Üretilen URL'leri canlıda örnekle** (az sayıda, elle): BMW X5 SUV filtreleri (`a107181`, `a2321`, `a2319`,
   `a87472`), minivan (VW Caddy: `a767`, `a3807`, `a96780`), `bmw-3-serisi-320d`. Kimlikler sidebar'dan okundu ama
   bu URL'ler sonuç sayısıyla henüz denenmedi. Çoklu değer seçimi hâlâ doğrulanmadı.
4. **`rank_cars` / `market_stats` canlı denemesi (0.3.0'da eklendi).** Store'da henüz tek modelden ≥10-15 ilan
   yok (21 karışık ilan: Alexa, Taliant, Egea, Clio...), bu yüzden çoğu grup `insufficient`. Bir modelin (ör. Astra
   1.3 CDTI) 3-4 arama sayfasını + en iyi 8-10 ilanın detayını kaydedip `rank_cars` çıktısını gözle kontrol et.
   Sonra: açıklama kalıplarını gerçek ilan metinlerine göre ayarla (yanlış alarm/kaçırma), `strong-candidate`
   eşiği (%8) ve puan ağırlıklarını gerçek veriyle gözden geçir.
5. **Her kod değişikliğinde:** `npm run bundle`, `package.json` + `src/config.ts` + `.claude-plugin/plugin.json`
   sürümünü artır (sürüm aynı kalırsa `claude plugin update` önbelleği yenilemiyor), commit, push (gkdgbilal,
   HTTPS), `claude plugin marketplace update sahibinden-car && claude plugin update sahibinden-car@sahibinden-car`,
   sonra Claude Code'u yeniden başlat.

## Sonra / karar bekleyen

- **Agensi'de listeleme** (https://www.agensi.io/sell). `skills/sahibinden-car/` klasörünü zip'le
  (`cd skills && zip -r sahibinden-car.zip sahibinden-car`). Hesap + Creator Mode gerekir; ücretli için Stripe/USDC
  ödeme yöntemi ve KYC. **Çelişki:** README "kişisel, ticari olmayan kullanım" diyor, sahibinden kullanım koşulları
  da var. Öneri: ücretsiz listele ya da önce README uyarısını ve riski değerlendir. Karar kullanıcıda.
- 79 ilin `address_city=<plaka>` değerinin canlı sitede kabulü (plaka kodları listeyle doğrulandı, site tarafı
  yalnızca 55 ve 34 için denendi).
- Yarı otomatik vites kimliği bilinmiyor; çoklu değer seçimi (aynı filtrede birden çok değer) doğrulanmadı.
- Tarayıcı modu (`SAHIBINDEN_BROWSER_MODE=on`) deneysel, yalnızca sahte sayfalarla denendi.
- Skill'i Cursor/Copilot gibi diğer ajanlar için ayrıca paketleme (Agensi çoklu ajan destekliyor).

## Notlar

- Chrome'dan okurken sorgu dizeli adresler araç çıktısında maskeleniyor ("BLOCKED"); parametre adlarını
  `new URL(a.href).searchParams.keys()` ile çıkar, değerleri `label → değer` sözlüğü olarak döndür.
- Sahibinden kategori başına farklı filtre kimlikleri kullanıyor (otomobil `a5/a4/a6/a17`, SUV `a277/a276/a279/a287`);
  yeni kategori eklerken sidebar bağlantılarından kimlikleri oku, tahmin etme.
- gh'de iki hesap var; push için `GH_TOKEN="$(gh auth token --user gkdgbilal)"`, `gh auth switch` yapma.
