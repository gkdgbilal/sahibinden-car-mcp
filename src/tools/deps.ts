import type { Provider } from '../providers/provider.js';

export interface ToolDeps {
  provider: Provider;
  /** Yaş hesabı için geçerli yıl (testte sabitlenir). */
  nowYear: () => number;
}
