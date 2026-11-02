#!/usr/bin/env bash
# kisei のデータベースのバックアップと復旧の確認。
#   バックアップ:   DATABASE_URL=... scripts/db-backup.sh backup  [出力ファイル]
#   復旧（検証用）: DATABASE_URL=... RESTORE_URL=... scripts/db-backup.sh restore <ファイル>
#   往復の検証:     DATABASE_URL=... RESTORE_URL=... scripts/db-backup.sh verify
# - 接続文字列は環境変数で渡す（コマンドラインやログに出さない）。
# - restore / verify は RESTORE_URL のデータベース（空の検証用 DB）に復元する。本番の DB には復元しない。
# - pg_dump / pg_restore（PostgreSQL 16 以上のクライアント）が必要。
set -euo pipefail

cmd="${1:-}"
: "${DATABASE_URL:?DATABASE_URL を設定してください}"

# libpq が解釈しない・不要なパラメーターはそのままでよい（pg_dump は libpq を使う）
counts() {
  psql "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'rc_studies' t, count(*) n FROM rc_studies UNION ALL
  SELECT 'rc_study_sessions', count(*) FROM rc_study_sessions UNION ALL
  SELECT 'rc_decisions', count(*) FROM rc_decisions UNION ALL
  SELECT 'rc_traces', count(*) FROM rc_traces UNION ALL
  SELECT 'rc_failures', count(*) FROM rc_failures UNION ALL
  SELECT 'rc_patches', count(*) FROM rc_patches UNION ALL
  SELECT 'rc_audit', count(*) FROM rc_audit UNION ALL
  SELECT 'rc_jobs', count(*) FROM rc_jobs UNION ALL
  SELECT 'rc_schema_migrations', count(*) FROM rc_schema_migrations
) x;
SELECT 'audit_chain=' || coalesce(md5(string_agg(hash, '' ORDER BY seq)), 'none') FROM rc_audit WHERE seq IS NOT NULL;
SELECT 'decisions_md5=' || coalesce(md5(string_agg(data::text, '' ORDER BY study_id, condition_id, replicate, step)), 'none') FROM rc_decisions;
SQL
}

case "$cmd" in
  backup)
    out="${2:-kisei-$(date -u +%Y%m%dT%H%M%SZ).dump}"
    pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
    sha256sum "$out"
    echo "バックアップを作成しました: $out"
    ;;
  restore)
    : "${RESTORE_URL:?RESTORE_URL（復元先の空のデータベース）を設定してください}"
    file="${2:?復元するファイルを指定してください}"
    # トリガー（監査ログの保護）はデータの投入後に作られるため、復元は保護に妨げられない
    pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$RESTORE_URL" "$file"
    echo "復元しました"
    ;;
  verify)
    : "${RESTORE_URL:?RESTORE_URL（復元先の空のデータベース）を設定してください}"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    pg_dump --format=custom --no-owner --no-privileges --file="$tmp/db.dump" "$DATABASE_URL"
    pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$RESTORE_URL" "$tmp/db.dump"
    a="$(counts "$DATABASE_URL")"
    b="$(counts "$RESTORE_URL")"
    echo "元:     $a" | tr '\n' ' '; echo
    echo "復元後: $b" | tr '\n' ' '; echo
    if [ "$a" = "$b" ]; then echo "検証に成功しました（件数・監査ログの連鎖・判断の記録が一致）"; else echo "検証に失敗しました（不一致）" >&2; exit 1; fi
    ;;
  *)
    sed -n '2,8p' "$0"; exit 2 ;;
esac
