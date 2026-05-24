/**
 * 社内ランチ交流会マッチングシステム - メインサーバーロジック
 */

// Web Appへのアクセス時にHTMLを出力する
function doGet(e) {
  // 起動時に自動でスプレッドシートの初期化を行う（シートが存在しない場合のみ作成）
  initDatabase();
  
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('社内ランチ交流会 - マッチングポータル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 他のHTMLファイルをインクルードするためのヘルパー関数
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// スプレッドシートが開かれたときのメニュー追加
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('ランチ交流会')
    .addItem('管理者画面の初期化/デモデータ挿入', 'initDatabase')
    .addItem('ポータル画面のURLを表示', 'showWebAppUrl')
    .addToUi();
}

// Web Appの公開URLをポップアップ表示する関数
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (url) {
    var htmlOutput = HtmlService
      .createHtmlOutput('<p>以下のURLからマッチングポータル（ユーザー/管理者画面）にアクセスできます：</p><p><a href="' + url + '" target="_blank" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">ポータルを開く</a></p>')
      .setWidth(400)
      .setHeight(150);
    ui.showModalDialog(htmlOutput, 'ポータル画面のURL');
  } else {
    ui.alert('Webアプリケーションとしてデプロイされていません。「デプロイ」メニューからデプロイを行ってください。');
  }
}

// スプレッドシートデータベースの自動初期化
function initDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('アクティブなスプレッドシートが見つかりません。');
    return;
  }

  // 現在実行しているユーザーのメールアドレスを取得して初期の管理者にする
  var activeEmail = Session.getActiveUser().getEmail();

  // 1. 設定シートの作成・初期化
  var setupSheet = ss.getSheetByName('設定');
  if (!setupSheet) {
    setupSheet = ss.insertSheet('設定');
    setupSheet.appendRow(['設定キー', '設定値', '説明']);
    setupSheet.appendRow(['admin_emails', activeEmail || '', '管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）']);
    setupSheet.appendRow(['gemini_api_key', '', 'Google AI Studioから取得したGemini APIキー。空の場合は独自ロジックで動作します。']);
    setupSheet.appendRow(['matching_mode', 'gemini', 'マッチングモード ("gemini" または "logic")']);
    setupSheet.appendRow(['default_group_size', '4', '1グループあたりの基本目標人数']);
    setupSheet.appendRow(['default_group_count', '4', '標準の目標グループ数（組数）']);
    setupSheet.appendRow(['additional_prompt', '部署ができるだけ被らないようにしてください。共通の趣味がある人を同じグループに混ぜると盛り上がるので考慮してください。', 'Geminiへの追加指示プロンプト']);
    
    // 見栄えの調整
    setupSheet.getRange('A1:C1').setBackground('#f1f5f9').setFontWeight('bold');
    setupSheet.autoResizeColumns(1, 3);
  } else {
    // 既存の設定シートがある場合、足りないキーがあれば追加する
    var lastRow = setupSheet.getLastRow();
    var keys = setupSheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
    if (keys.indexOf('admin_emails') === -1) {
      setupSheet.appendRow(['admin_emails', activeEmail || '', '管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）']);
    }
    if (keys.indexOf('default_group_count') === -1) {
      setupSheet.appendRow(['default_group_count', '4', '標準の目標グループ数（組数）']);
    }
  }

  // 2. メンバー一覧シートの作成・初期化
  var memberSheet = ss.getSheetByName('メンバー一覧');
  var isNewMemberSheet = false;
  if (!memberSheet) {
    memberSheet = ss.insertSheet('メンバー一覧');
    memberSheet.appendRow(['メンバーID', '名前', 'メールアドレス', '部署・チーム', '趣味・自己紹介・興味のあること', '参加目的', 'ステータス', '次回優先']);
    memberSheet.getRange('A1:H1').setBackground('#f1f5f9').setFontWeight('bold');
    isNewMemberSheet = true;
  } else {
    // 既存のシートのアップグレード（8列目が無ければ追加）
    var lastCol = memberSheet.getLastColumn();
    var lastRow = memberSheet.getLastRow();
    if (lastCol === 7) {
      memberSheet.getRange(1, 8).setValue('次回優先');
      memberSheet.getRange('H1').setBackground('#f1f5f9').setFontWeight('bold');
      if (lastRow > 1) {
        var checkboxRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
        checkboxRange.insertCheckboxes();
        checkboxRange.setValue(false);
      }
    }
  }

  // デモデータの投入（メンバー一覧シートが空、または新規作成された場合）
  if (isNewMemberSheet || memberSheet.getLastRow() <= 1) {
    var demoMembers = [
      ['M001', '山田 太郎', 'yamada.t@example.com', '開発部', '趣味はサウナとTypeScript。最近はDIYにハマっています。', '技術的な雑談, 他部署の交流', 'アクティブ', false],
      ['M002', '佐藤 美咲', 'sato.m@example.com', '人事部', '休日はカフェ巡りやヨガをしています。旅行が大好きです。', '他部署の交流', 'アクティブ', false],
      ['M003', '鈴木 健一', 'suzuki.k@example.com', '開発部', 'GolangとAWSが得意。コーヒーを自分で焙煎して淹れるのが趣味。', '技術的な雑談, キャリア相談', 'アクティブ', false],
      ['M004', '高橋 玲子', 'takahashi.r@example.com', 'マーケティング部', '映画鑑賞（SF・サスペンス）とピラティス。新しいトレンド分析が好き。', '他部署の交流, 雑談で息抜き', 'アクティブ', false],
      ['M005', '田中 達也', 'tanaka.t@example.com', '営業部', '学生時代からゴルフをしています。週末はだいたいグリーンにいます。', '他部署の交流', 'アクティブ', false],
      ['M006', '渡辺 奈々', 'watanabe.n@example.com', '総務部', '料理（特にスパイスカレー作り）と猫の動画を見るのが癒やし。', '雑談で息抜き', 'アクティブ', false],
      ['M007', '伊藤 淳', 'ito.j@example.com', '開発部', 'Figmaでのデザイン、カメラ（スナップ写真）、ガジェット集め。', '技術的な雑談, 他部署の交流', 'アクティブ', false],
      ['M008', '山本 結衣', 'yamamoto.y@example.com', '営業部', '読書（ビジネス書から小説まで）とアロマテラピー。美味しいパン屋探し。', '他部署の交流', 'アクティブ', false],
      ['M009', '中村 翔', 'nakamura.s@example.com', 'マーケティング部', 'キャンプ、BBQ、ロードバイク。分析ツールを触るのが好き。', '技術的な雑談, 雑談で息抜き', 'アクティブ', false],
      ['M010', '小林 直樹', 'kobayashi.n@example.com', '人事部', 'テニスと筋トレ。最近は健康食作りにも取り組んでいます。', '他部署の交流, キャリア相談', 'アクティブ', false],
      ['M011', '加藤 沙織', 'kato.s@example.com', '開発部', 'Flutter、Swift。趣味はゲーム（RPG、インディーゲーム）と謎解き。', '技術的な雑談, 他部署の交流', 'アクティブ', false],
      ['M012', '吉田 拓海', 'yoshida.t@example.com', '新規事業部', 'サウナ、ポッドキャストを聴くこと、スタートアップ研究。', 'キャリア相談, 他部署の交流', 'アクティブ', false],
      ['M013', '佐々木 萌', 'sasaki.m@example.com', '広報部', '美術館巡り、イラストを描くこと、SNS運用。美味しいワインが好き。', '他部署の交流, 雑談で息抜き', 'アクティブ', false],
      ['M014', '山口 健太', 'yamaguchi.k@example.com', '開発部', 'Kubernetes、Terraform。趣味はボードゲームとキャンプです。', '技術的な雑談, 他部署の交流', 'アクティブ', false],
      ['M015', '松本 恵', 'matsumoto.m@example.com', '営業部', 'ピラティス、韓国ドラマ鑑賞、激辛グルメの開拓。', '他部署の交流, 雑談で息抜き', 'アクティブ', false],
      ['M016', '斎藤 翼', 'saito.t@example.com', '開発部', '自動テスト、バグハント。趣味はランニングと麻雀です。', '技術的な雑談', 'アクティブ', false]
    ];

    for (var i = 0; i < demoMembers.length; i++) {
      memberSheet.appendRow(demoMembers[i]);
    }
    
    // チェックボックスを挿入
    var lastRow = memberSheet.getLastRow();
    if (lastRow > 1) {
      memberSheet.getRange(2, 8, lastRow - 1, 1).insertCheckboxes();
    }
    
    memberSheet.autoResizeColumns(1, 8);
  }

  // 3. マッチング履歴シートの作成・初期化
  var historySheet = ss.getSheetByName('マッチング履歴');
  if (!historySheet) {
    historySheet = ss.insertSheet('マッチング履歴');
    historySheet.appendRow(['開催日', 'グループID', 'メンバーID一覧', 'メンバー名一覧', 'マッチング方法', '選出理由 / メモ']);
    historySheet.getRange('A1:F1').setBackground('#f1f5f9').setFontWeight('bold');
    
    // ダミー履歴を1回分投入してタイムラインが動くようにする
    var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    historySheet.appendRow([
      todayStr, 
      'G-1', 
      'M001,M003,M007,M011', 
      '山田 太郎, 鈴木 健一, 伊藤 淳, 加藤 沙織', 
      'Logic (Demo)', 
      '全員が開発部に所属するメンバー。TypeScript, Golang, Figma, Flutterなどの技術的興味が近く、技術雑談が非常に盛り上がるグループとしてマッチングしました。'
    ]);
    historySheet.appendRow([
      todayStr, 
      'G-2', 
      'M002,M004,M005,M006', 
      '佐藤 美咲, 高橋 玲子, 田中 達也, 渡辺 奈々', 
      'Logic (Demo)', 
      '人事、マーケ、営業、総務と、多様な部署のメンバーをマッチング。他部署交流に最適で、映画やサウナなどの共通の休日趣味もあり会話が弾む構成です。'
    ]);
    
    historySheet.autoResizeColumns(1, 6);
  }

  // 4. チャットメッセージシートの作成・初期化
  var chatSheet = ss.getSheetByName('チャットメッセージ');
  if (!chatSheet) {
    chatSheet = ss.insertSheet('チャットメッセージ');
    chatSheet.appendRow(['メッセージID', 'ルームID', '送信者ID', '送信者名', '送信者メール', '部署名', 'メッセージ内容', '送信日時']);
    chatSheet.getRange('A1:H1').setBackground('#f1f5f9').setFontWeight('bold');
    
    // デモ履歴のグループG-1用のデモチャットデータを投入
    var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var demoRoomId = todayStr + '_G-1';
    var now = new Date();
    
    chatSheet.appendRow([
      'MSG001', 
      demoRoomId, 
      'M001', 
      '山田 太郎', 
      'yamada.t@example.com', 
      '開発部', 
      'はじめまして！山田です。みなさん、次回のランチ会よろしくお願いします！サウナとTypeScriptが趣味です。', 
      new Date(now.getTime() - 3600000).toISOString() // 1時間前
    ]);
    chatSheet.appendRow([
      'MSG002', 
      demoRoomId, 
      'M003', 
      '鈴木 健一', 
      'suzuki.k@example.com', 
      '開発部', 
      '鈴木です！よろしくお願いします。僕はコーヒーの自家焙煎が趣味なので、コーヒーについて語りましょう！', 
      new Date(now.getTime() - 1800000).toISOString() // 30分前
    ]);
    chatSheet.appendRow([
      'MSG003', 
      demoRoomId, 
      'M007', 
      '伊藤 淳', 
      'ito.j@example.com', 
      '開発部', 
      'デザイナーの伊藤です。よろしくお願いします！僕もサウナ大好きなので、おすすめのサウナ施設についてお話ししたいです！', 
      new Date(now.getTime() - 600000).toISOString() // 10分前
    ]);
    
    chatSheet.autoResizeColumns(1, 8);
  }
}
