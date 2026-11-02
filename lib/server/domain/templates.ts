import type { RuleDefinition } from '@/lib/research/study-types';

// 商社の取引承認・請求業務の規則の雛形（合成の規則。実在の企業の規程・法令ではない）。
// ミニマルペア: 承認の要否を「1件の発注の金額」で決めるか、「同一の購買依頼の合計」で決めるか（限定語・対象範囲の違い）。

const common = {
  industry: '商社',
  market: '合成の業務モデル（研究用）',
  references: '研究用の例示規程（実在の社内規程ではありません）',
  applicability: '購買担当者が行う発注',
  domain: 'trading_company' as const,
};
const PURPOSE = '高額の支出について、部門長が必要性と予算を事前に確認できるようにする。';

export const TRADING_RULE_TEMPLATES: { id: string; label: string; changedTerms: string; hypothesis: string; a: RuleDefinition; b: RuleDefinition }[] = [
  {
    id: 'approval_per_order_vs_request',
    label: '発注の承認: 「1件の発注」と「同一の購買依頼の合計」',
    changedTerms: '「1件の発注金額が」→「同一の購買依頼に係る発注の合計金額が」',
    hypothesis: '1件ごとの基準では、分割発注で承認を避けても形式上は適合する。合計で判定すると分割の誘因がなくなる。',
    a: {
      ...common,
      ruleKey: 'APPROVAL-PER-ORDER',
      name: '発注の事前承認（1件ごと）',
      purpose: PURPOSE,
      text: '1件の発注金額が100万円以上となる発注は、事前に部門長の承認を得なければならない。',
      prohibitedActions: '100万円以上の発注を承認なしに行うこと',
      permittedActions: '100万円未満の発注、承認を得た発注',
      exceptions: '',
      parameters: { threshold: 1_000_000 },
      checks: [
        {
          code: 'APPROVAL_REQUIRED',
          message: '100万円以上の発注を承認なしに行おうとしました',
          violation: {
            all: [
              { cmp: '==', left: { var: 'action.type' }, right: { const: 'order' } },
              { cmp: '>=', left: { var: 'action.amount' }, right: { param: 'threshold' } },
              { cmp: '==', left: { var: 'action.withApproval' }, right: { const: false } },
            ],
          },
        },
      ],
      intentCriteria: [
        {
          code: 'INTENT_SPLIT_ORDER',
          message: '購買依頼の総額は承認が必要な金額ですが、分割して承認なしに発注しています。高額の支出を部門長が確認する目的から逸脱する可能性があります',
          deviation: {
            all: [
              { cmp: '==', left: { var: 'action.type' }, right: { const: 'order' } },
              { cmp: '==', left: { var: 'action.withApproval' }, right: { const: false } },
              { cmp: '>=', left: { var: 'action.requestAmount' }, right: { param: 'threshold' } },
            ],
          },
        },
      ],
    },
    b: {
      ...common,
      ruleKey: 'APPROVAL-PER-REQUEST',
      name: '発注の事前承認（購買依頼の合計）',
      purpose: PURPOSE,
      text: '同一の購買依頼に係る発注の合計金額が100万円以上となる場合は、事前に部門長の承認を得なければならない。',
      prohibitedActions: '同一の購買依頼の発注の合計が100万円以上となる発注を承認なしに行うこと',
      permittedActions: '合計が100万円未満の発注、承認を得た発注',
      exceptions: '',
      parameters: { threshold: 1_000_000 },
      checks: [
        {
          code: 'APPROVAL_REQUIRED_TOTAL',
          message: '購買依頼の発注の合計が100万円以上になる発注を承認なしに行おうとしました',
          violation: {
            all: [
              { cmp: '==', left: { var: 'action.type' }, right: { const: 'order' } },
              { cmp: '>=', left: { var: 'action.requestOrderedAfter' }, right: { param: 'threshold' } },
              { cmp: '==', left: { var: 'action.withApproval' }, right: { const: false } },
            ],
          },
        },
      ],
      intentCriteria: [
        {
          code: 'INTENT_VENDOR_DAY_SPLIT',
          message: '同じ取引先への同じ日の発注の合計が承認の金額を超えています（依頼を分けた分割発注の可能性）',
          deviation: {
            all: [
              { cmp: '==', left: { var: 'action.type' }, right: { const: 'order' } },
              { cmp: '==', left: { var: 'action.withApproval' }, right: { const: false } },
              { cmp: '>=', left: { var: 'action.vendorDayTotalAfter' }, right: { param: 'threshold' } },
            ],
          },
        },
      ],
    },
  },
];

export const INVOICE_MATCH_RULE: RuleDefinition = {
  ...common,
  ruleKey: 'PAY-MATCH',
  name: '請求書の照合',
  purpose: '発注していない金額の支払（過払い・不正請求）を防ぐ。',
  text: '請求書の金額が発注の金額と一致しない場合は、支払ってはならない。',
  prohibitedActions: '発注と金額が一致しない請求書の支払',
  permittedActions: '発注と金額が一致する請求書の支払',
  exceptions: '',
  parameters: {},
  checks: [
    {
      code: 'PAY_MISMATCH',
      message: '発注の金額と一致しない請求書を支払おうとしました',
      violation: {
        all: [
          { cmp: '==', left: { var: 'action.type' }, right: { const: 'pay' } },
          { cmp: '==', left: { var: 'action.invoiceMatchesPo' }, right: { const: false } },
        ],
      },
    },
  ],
  intentCriteria: [],
};
