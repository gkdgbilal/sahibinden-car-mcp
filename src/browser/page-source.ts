export interface NavResult {
  finalUrl: string | null;
  httpStatus: number | null;
  cfMitigated: boolean;
  /** Page.navigate hata metni (ağ hatası vb.); yoksa null. */
  errorText: string | null;
  quickKind: 'ready' | 'challenge' | 'timeout';
}

export interface Tab {
  readonly targetId: string;
  navigate(url: string, timeoutMs: number): Promise<NavResult>;
  /** Sayfanın mevcut HTML'i (yalnızca bellekte tutulur). */
  html(): Promise<string>;
  /** Ağ isteği atmadan sabit, salt-okuma kontrol. */
  currentKind(): Promise<'ready' | 'challenge' | 'other'>;
  close(): Promise<void>;
}

export interface BrowserSession {
  version(): Promise<string>;
  openTab(): Promise<Tab>;
  /** Yalnızca MCP'nin kendi açtığı sekmeye (durum dosyasındaki targetId) bağlanır; yoksa null. */
  attachTab(targetId: string): Promise<Tab | null>;
  /** Bağlantıyı kapatır (Chrome'u kapatmaz). */
  close(): Promise<void>;
}

export interface PageSource {
  /** Başarısızsa BrowserError('not-running'). */
  connect(): Promise<BrowserSession>;
}
