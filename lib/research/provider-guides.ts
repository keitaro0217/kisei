import type { ModelInfo, ProviderType } from './types';

// かんたん接続の対象（主要な AI サービス）。接続方式（種別・接続先）と、APIキーの取得方法の案内を持つ。
// モデルの一覧は接続後に各サービスの API から取得し、ここではモデル ID を固定しない
// （既定のモデルの候補を選ぶための目安だけを持つ）。

export type ProviderGuideId = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export type ProviderGuide = {
  id: ProviderGuideId;
  type: ProviderType;
  label: string;
  vendor: string;
  baseUrl: string;
  /** APIキーを発行する公式ページ */
  keyUrl: string;
  /** モデルの一覧（公式） */
  modelsUrl: string;
  steps: string[];
  keyPlaceholder: string;
  /** 研究に使える（文章を生成する）モデルの ID の目安 */
  chatModelPattern: RegExp;
};

export const PROVIDER_GUIDES: ProviderGuide[] = [
  {
    id: 'openai',
    type: 'openai',
    label: 'OpenAI',
    vendor: 'GPT シリーズ',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    modelsUrl: 'https://platform.openai.com/docs/models',
    steps: ['OpenAI Platform にログインします。', '「API keys」で「Create new secret key」を押します。', '表示されたキー（sk- で始まる文字列）をコピーして、下に貼り付けます。', '利用には支払い方法の登録（Billing）が必要です。'],
    keyPlaceholder: 'sk-...',
    chatModelPattern: /^(gpt-|o\d|chatgpt-)/,
  },
  {
    id: 'anthropic',
    type: 'anthropic',
    label: 'Anthropic',
    vendor: 'Claude シリーズ',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    steps: ['Anthropic Console にログインします。', '「API Keys」で「Create Key」を押します。', '表示されたキー（sk-ant- で始まる文字列）をコピーして、下に貼り付けます。', '利用にはクレジットの購入（Billing）が必要です。'],
    keyPlaceholder: 'sk-ant-...',
    chatModelPattern: /^claude-/,
  },
  {
    id: 'gemini',
    type: 'gemini',
    label: 'Google',
    vendor: 'Gemini シリーズ',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    steps: ['Google AI Studio に Google アカウントでログインします。', '「Get API key」→「Create API key」を押します。', '表示されたキー（AIza で始まる文字列）をコピーして、下に貼り付けます。'],
    keyPlaceholder: 'AIza...',
    chatModelPattern: /^gemini-/,
  },
  {
    id: 'openrouter',
    type: 'openai_compatible',
    label: 'OpenRouter',
    vendor: '複数社のモデル（OpenAI 互換）',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    modelsUrl: 'https://openrouter.ai/models',
    steps: ['OpenRouter にログインします。', '「Keys」で「Create Key」を押します。', '表示されたキー（sk-or- で始まる文字列）をコピーして、下に貼り付けます。'],
    keyPlaceholder: 'sk-or-...',
    chatModelPattern: /\//,
  },
];

export const guideOf = (id: string) => PROVIDER_GUIDES.find((g) => g.id === id) ?? null;

/** 接続先（種別と URL）から、どのかんたん接続に当たるかを判定する */
export function guideForProvider(p: { type: ProviderType; baseUrl: string }): ProviderGuide | null {
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  return PROVIDER_GUIDES.find((g) => g.type === p.type && norm(g.baseUrl) === norm(p.baseUrl)) ?? null;
}

/** 文章生成に使えないモデル（埋め込み・音声・画像など） */
const NON_CHAT = /(embed|embedding|tts|whisper|audio|image|dall-e|moderation|realtime|transcribe|search|vision-preview|davinci|babbage|aqa|imagen|veo|lyria|computer-use)/i;

/** 研究に使える候補のモデル（一覧の順序は保つ） */
export function chatModels(guide: ProviderGuide | null, models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => !NON_CHAT.test(m.id) && (!guide || guide.chatModelPattern.test(m.id)));
}

/**
 * 既定のモデルの候補（費用を抑えるため、軽量なモデル名を優先する）。
 * 該当がなければ候補の先頭。研究者はいつでも変更できる。
 */
export function suggestModel(guide: ProviderGuide | null, models: ModelInfo[]): string | null {
  const candidates = chatModels(guide, models);
  if (candidates.length === 0) return null;
  // 名前の区切り（- _ . /）単位で判定する（「gemini」の中の「mini」に一致させない）
  const light = candidates.filter((m) => /(^|[-_./])(mini|flash|haiku)([-_./]|$)/i.test(m.id) && !/(^|[-_./])(preview|exp|experimental)([-_./]|$)/i.test(m.id));
  const pick = (list: ModelInfo[]) => [...list].sort((a, b) => b.id.localeCompare(a.id))[0];
  return (light.length ? pick(light) : pick(candidates)).id;
}
