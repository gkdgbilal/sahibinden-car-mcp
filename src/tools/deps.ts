import type { LiveProvider } from '../providers/live-provider.js';
import type { Provider } from '../providers/provider.js';

export interface ToolDeps {
  provider: Provider;
  /** Yaş hesabı için geçerli yıl (testte sabitlenir). */
  nowYear: () => number;
  /** Yalnızca tarayıcı modu açıkken verilir; yoksa canlı tool'lar kaydedilmez. */
  live?: LiveProvider;
}
