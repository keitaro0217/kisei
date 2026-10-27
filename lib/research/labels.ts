import type { ConnectionStatus, ExperimentStatus, LlmErrorCategory, ProviderType, ResearchRole } from './types';

export const providerTypeLabels: Record<ProviderType, string> = {
  openai: 'OpenAI API',
  anthropic: 'Anthropic Claude API',
  gemini: 'Google Gemini API',
  openai_compatible: 'OpenAI互換API',
  ollama: 'ローカルLLM（Ollama）',
};

export const defaultBaseUrls: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai_compatible: '',
  ollama: 'http://localhost:11434',
};

/** APIキーが必須かどうか（Ollamaは任意） */
export const apiKeyRequired: Record<ProviderType, boolean> = {
  openai: true,
  anthropic: true,
  gemini: true,
  openai_compatible: true,
  ollama: false,
};

/** プロバイダー種別ごとに送信可能な推論設定 */
export const reasoningSupport: Record<ProviderType, 'effort' | 'thinkingBudget' | 'none'> = {
  openai: 'effort',
  anthropic: 'effort',
  gemini: 'thinkingBudget',
  openai_compatible: 'effort',
  ollama: 'none',
};

export const connectionStatusLabels: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: '接続済み', className: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30' },
  failed: { label: '接続失敗', className: 'bg-rose-500/10 text-rose-300 ring-rose-400/30' },
  unconfigured: { label: '未設定', className: 'bg-ink-800 text-ink-200 ring-ink-400/30' },
  untested: { label: '未確認', className: 'bg-amber-500/10 text-amber-300 ring-amber-400/30' },
};

export const errorCategoryLabels: Record<LlmErrorCategory, string> = {
  not_configured: '未設定（APIキーまたはモデルが登録されていません）',
  auth: '認証エラー（APIキーが無効です）',
  permission: '権限エラー（このキーでは利用できません）',
  model_unavailable: 'モデル未対応（指定モデルが存在しないか利用できません）',
  rate_limit: '利用上限（レート制限に達しました）',
  quota: '利用上限（クォータまたは残高が不足しています）',
  budget_exceeded: '予算上限（このアプリで設定した月間予算に達しました）',
  network: '通信障害（接続先に到達できません）',
  timeout: 'タイムアウト（応答が時間内に返りませんでした）',
  ssrf_blocked: '接続先が許可されていません（安全上の理由で拒否）',
  invalid_request: 'リクエスト不正（設定値を確認してください）',
  server_error: 'プロバイダー側の障害',
  refusal: '応答が拒否されました',
  invalid_response: '応答形式が不正です',
  provider_changed: '接続先設定が実験開始時から変更されています',
  unknown: '不明なエラー',
};

export const roleLabels: Record<ResearchRole, { label: string; description: string }> = {
  trading_agent: { label: '取引エージェント', description: '仮想金融市場で規則を解釈し、取引判断を行うAI' },
  llm_judge: { label: 'LLM Judge', description: 'エージェントの判断説明、参照文書、取引ログを分析する評価用AI' },
  auto_patch: { label: 'Auto-Patch', description: '規則や定義文書の修正候補を生成するAI' },
  document_analysis: { label: '文書分析', description: '規制文書の構造解析、条文比較、関連文書検索などを支援するAI' },
};

export const researchRoles: ResearchRole[] = ['trading_agent', 'llm_judge', 'auto_patch', 'document_analysis'];

export const experimentStatusLabels: Record<ExperimentStatus, { label: string; className: string }> = {
  queued: { label: '待機中', className: 'bg-ink-800 text-ink-200 ring-ink-400/30' },
  running: { label: '実行中', className: 'bg-ink-800 text-white ring-white/25' },
  pausing: { label: '一時停止中…', className: 'bg-amber-500/10 text-amber-300 ring-amber-400/30' },
  paused: { label: '一時停止', className: 'bg-amber-500/10 text-amber-300 ring-amber-400/30' },
  stopping: { label: '停止中…', className: 'bg-ink-800 text-ink-200 ring-ink-400/30' },
  stopped: { label: '停止', className: 'bg-ink-800 text-ink-200 ring-ink-400/30' },
  completed: { label: '完了', className: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30' },
  failed: { label: '失敗', className: 'bg-rose-500/10 text-rose-300 ring-rose-400/30' },
};
