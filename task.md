# タスク管理表 (ユーザー/管理者分離版)

本プロジェクトの開発タスク一覧と現在の進捗状況です。

---

## 進捗サマリー

- [x] Phase 1: サーバーサイド認証 & DB拡張の実装 (完了)
- [x] Phase 2: 一般ユーザー向けAPIの実装 (完了)
- [x] Phase 3: 一般ユーザー向けUIの構築 (完了)
- [x] Phase 4: 管理者UIの認証連携 (完了)
- [x] Phase 5: テストと最終調整 (完了)

---

## 各フェーズの詳細タスク

### Phase 1: サーバーサイド認証 & DB拡張の実装

- [x] `main.gs` の `initDatabase` 処理を拡張
  - [x] `設定` シートに `admin_emails` の追加
  - [x] 初期実行ユーザーのメールアドレスを自動的に `admin_emails` に登録するロジック
- [x] `sheets.gs` に認証ヘルパー `checkAdminPermission()` を追加
  - [x] 現在のユーザー `Session.getActiveUser().getEmail()` を取得して管理者メールリストと照合
- [x] 管理者専用APIのアクセス保護
  - [x] `saveSettings`, `addMember`, `updateMember`, `deleteMember`, `saveMatchingHistory`, `runMatching` 等の関数冒頭に `checkAdminPermission` チェックを追加

### Phase 2: 一般ユーザー向けAPIの実装

- [x] `sheets.gs` に一般ユーザー向けAPIを実装
  - [x] `registerSelfProfile(profileObj)`: 一般ユーザーからのプロフィール自己登録・更新（セキュリティ保護不要）
  - [x] `getSelfProfile(email)`: メールアドレスを指定して登録済みの自己プロフィールを返却する関数

### Phase 3: 一般ユーザー向けUIの構築 (デフォルト画面)

- [x] `index.html` のレイアウト変更
  - [x] デフォルトナビゲーションを一般ユーザー向け（「次回マッチング」「プロフィール登録」）に変更
  - [x] 管理者メニュー用コンテナを追加（管理者のみ動的に表示）
- [x] `scripts.html` の拡張
  - [x] ルーティングに `#user-matching`, `#user-profile` を追加（デフォルトは `#user-matching`）
  - [x] **次回マッチング確認ビュー**の描画
    - [x] 最新のマッチング結果の表示
    - [x] 「自分を探す」検索窓の設置と、マッチしたグループカードのハイライト表示機能
  - [x] **プロフィール登録・変更ビュー**の描画
    - [x] 自己登録用フォーム（名前、部署、趣味、参加目的、参加ステータスの選択）
    - [x] メールアドレス入力による既存情報の自動読み込み処理

### Phase 4: 管理者UIの認証連携

- [x] `scripts.html` の状態管理 (`state`) の拡張
  - [x] `isAdmin`, `currentUserEmail` を管理
  - [x] 初期データロード時に `isAdmin` 判定を受け取り、管理者用サイドバー/ボトムナビを動的に表示する
- [x] 管理者専用ビューの保護（フロント側で遷移を制限）

### Phase 5: テストと最終調整

- [x] 管理者アカウントと非管理者アカウント（またはシミュレーション）での表示切り替え・権限制限のテスト
- [x] 一般ユーザー画面での「自分を探す」ハイライト表示の検証
- [x] 自己プロフィール登録・更新が正しくスプレッドシートに反映されるかの検証
- [x] Web Appをデプロイし、最終疎通確認
