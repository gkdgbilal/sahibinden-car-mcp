import type { LiveProvider } from '../providers/live-provider.js';
import type { Provider } from '../providers/provider.js';
import type { InsightStore } from '../store/schema.js';

export interface ToolDeps {
  provider: Provider;
  /** Yaş hesabı için geçerli yıl (testte sabitlenir). */
  nowYear: () => number;
  /** Gözlem/yaşam döngüsü/izleme için dar store arayüzü (aynı JsonStore örneği). */
  store: InsightStore;
  /** Enjekte edilebilir saat (testte sabitlenir). */
  now: () => Date;
  /** Yalnızca tarayıcı modu açıkken verilir; yoksa canlı tool'lar kaydedilmez. */
  live?: LiveProvider;
}
