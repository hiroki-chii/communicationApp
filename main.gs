/**
 * 社内ランチ交流会マッチングシステム - メインサーバーロジック
 */

// Web Appへのアクセス時にHTMLを出力する
function doGet(e) {
  // 起動時に自動でスプレッドシートの初期化を行う（シートが存在しない場合のみ作成）
  initDatabase();
  
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('社内ランチ交流会 - マッチングポータル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

  // 1. 設定シート의作成・初期化
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

// -------------------------------------------------------------
// sheets.gs より統合されたデータベース操作ロジック
// -------------------------------------------------------------

/**
 * 管理者権限チェック
 */
function checkAdminPermission() {
  // getActiveUser() がセキュリティ制限で空を返す場合、デプロイオーナーの getEffectiveUser() を取得する
  var userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (!userEmail) {
    throw new Error('Googleアカウントにログインしていないか、メールアドレスの取得権限がありません。Webアプリのデプロイ設定をご確認ください。');
  }
  
  var settings = getSettings();
  var adminEmailsStr = settings.admin_emails || '';
  var adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim().toLowerCase(); });
  

  
  if (adminEmails.indexOf(userEmail.toLowerCase()) === -1) {
    throw new Error('管理者権限がありません。アカウント: ' + userEmail);
  }
  return true;
}

/**
 * 初期データ取得（メンバー、設定、履歴をまとめて取得）
 * 一般ユーザーと管理者で返却データを制御する
 */
function getInitialData() {
  try {
    initDatabase();
    
    // getActiveUser() が空の場合は getEffectiveUser() を使用
    var userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    var settings = getSettings();
    var members = getMembers();
    var history = getMatchingHistory();
    
    // 管理者判定
    var adminEmailsStr = settings.admin_emails || '';
    var adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim().toLowerCase(); });
    

    
    var isAdmin = userEmail && adminEmails.indexOf(userEmail.toLowerCase()) !== -1;
    
    // セキュリティ保護: 非管理者の場合はAPIキーを隠蔽する
    if (!isAdmin) {
      settings.gemini_api_key = settings.gemini_api_key ? '●●●●●●●●' : '';
    }
    
    var activeCount = members.filter(function(m) { return m.status === 'アクティブ'; }).length;
    
    // ログイン中の本人の登録プロフィールを取得
    var myProfile = null;
    if (userEmail) {
      myProfile = members.find(function(m) { 
        return m.email.toLowerCase() === userEmail.toLowerCase(); 
      }) || null;
    }
    
    return {
      success: true,
      members: members,
      settings: settings,
      history: history,
      totalCount: members.length,
      activeCount: activeCount,
      hasApiKey: !!settings.gemini_api_key && settings.gemini_api_key !== '●●●●●●●●',
      isAdmin: !!isAdmin,
      currentUserEmail: userEmail || '',
      myProfile: myProfile
    };
  } catch (e) {
    Logger.log('getInitialData エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバー一覧の取得
 */
function getMembers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('メンバー一覧');
  if (!sheet) return [];
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  var lastCol = sheet.getLastColumn();
  var colCount = Math.max(lastCol, 8); // 8列目（次回優先）まで安全に取得
  var data = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
  
  return data.map(function(row) {
    return {
      id: row[0],
      name: row[1],
      email: row[2],
      department: row[3],
      interests: row[4],
      purpose: row[5],
      status: row[6] || 'アクティブ',
      priority: !!row[7] // 8列目の「次回優先」フラグ (真偽値)
    };
  });
}

/**
 * 設定情報の取得
 */
function getSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('設定');
  if (!sheet) return {};
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};
  
  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var settings = {};
  
  data.forEach(function(row) {
    if (row[0]) {
      settings[row[0]] = row[1];
    }
  });
  
  return settings;
}

/**
 * 設定情報の保存 (管理者のみ)
 */
function saveSettings(settingsObj) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('設定');
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName('設定');
    }
    
    var lastRow = sheet.getLastRow();
    var keys = [];
    if (lastRow > 1) {
      keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
    }
    
    for (var key in settingsObj) {
      var val = settingsObj[key];
      
      // フロントエンドからマスク文字（●●●●●●●●）が送られてきた場合は、保存せずにスキップする（元の値を保持）
      if (key === 'gemini_api_key' && val === '●●●●●●●●') {
        continue;
      }
      
      var index = keys.indexOf(key);
      if (index !== -1) {
        sheet.getRange(index + 2, 2).setValue(val);
      } else {
        sheet.appendRow([key, val, '']);
      }
    }
    
    // スプレッドシートへ確実に書き込みを同期させる
    SpreadsheetApp.flush();
    
    var updatedSettings = getSettings();
    
    // 自身が管理者かどうかでAPIキーの有無を正しく判定して返す
    var userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    var adminEmailsStr = updatedSettings.admin_emails || '';
    var adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim().toLowerCase(); });

    var isAdmin = userEmail && adminEmails.indexOf(userEmail.toLowerCase()) !== -1;
    
    return {
      success: true,
      settings: updatedSettings,
      hasApiKey: !!updatedSettings.gemini_api_key && updatedSettings.gemini_api_key !== '●●●●●●●●',
      isAdmin: isAdmin
    };
  } catch (e) {
    Logger.log('saveSettings エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング履歴の取得
 */
function getMatchingHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('マッチング履歴');
  if (!sheet) return [];
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  
  return data.map(function(row) {
    return {
      date: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : row[0].toString(),
      groupId: row[1],
      memberIds: row[2].toString().split(',').map(function(s) { return s.trim(); }),
      memberNames: row[3].toString().split(',').map(function(s) { return s.trim(); }),
      method: row[4],
      memo: row[5]
    };
  }).reverse();
}

/**
 * 新規メンバーの追加 (管理者のみ代理登録)
 */
function addMember(memberObj) {
  try {
    checkAdminPermission(); // 権限チェック
    return addMemberToSheet(memberObj);
  } catch (e) {
    Logger.log('addMember エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// 内部的なメンバー追加処理
function addMemberToSheet(memberObj) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('メンバー一覧');
  if (!sheet) return { success: false, error: 'メンバー一覧シートが見つかりません。' };
  
  var lastRow = sheet.getLastRow();
  var newId = 'M001';
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
    var maxNum = 0;
    ids.forEach(function(id) {
      var match = id.match(/^M(\d+)$/);
      if (match) {
        var num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    newId = 'M' + ('000' + (maxNum + 1)).slice(-3);
  }
  
  var newRow = [
    newId,
    memberObj.name || '',
    memberObj.email || '',
    memberObj.department || '',
    memberObj.interests || '',
    memberObj.purpose || '',
    memberObj.status || 'アクティブ',
    !!memberObj.priority
  ];
  
  sheet.appendRow(newRow);
  
  // チェックボックスを挿入
  var targetRow = sheet.getLastRow();
  sheet.getRange(targetRow, 8).insertCheckboxes().setValue(!!memberObj.priority);
  
  sheet.autoResizeColumns(1, 8);
  
  return { success: true, member: getMembers().find(function(m) { return m.id === newId; }) };
}

/**
 * メンバー情報の更新 (管理者のみ)
 */
function updateMember(memberObj) {
  try {
    checkAdminPermission(); // 権限チェック
    return updateMemberInSheet(memberObj);
  } catch (e) {
    Logger.log('updateMember エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// 内部的なメンバー更新処理
function updateMemberInSheet(memberObj) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('メンバー一覧');
  if (!sheet) return { success: false, error: 'メンバー一覧シートが見つかりません。' };
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'メンバーデータが存在しません。' };
  
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
  var rowIndex = ids.indexOf(memberObj.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'メンバーIDが見つかりません。ID: ' + memberObj.id };
  }
  
  var rowNum = rowIndex + 2;
  var range = sheet.getRange(rowNum, 1, 1, 8); // 8列目まで更新
  range.setValues([[
    memberObj.id,
    memberObj.name || '',
    memberObj.email || '',
    memberObj.department || '',
    memberObj.interests || '',
    memberObj.purpose || '',
    memberObj.status || 'アクティブ',
    !!memberObj.priority
  ]]);
  
  return { success: true, member: memberObj };
}

/**
 * メンバーの削除 (管理者のみ)
 */
function deleteMember(memberId) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('メンバー一覧');
    if (!sheet) return { success: false, error: 'メンバー一覧シートが見つかりません。' };
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: 'メンバーデータが存在しません。' };
    
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
    var rowIndex = ids.indexOf(memberId);
    
    if (rowIndex === -1) {
      return { success: false, error: 'メンバーIDが見つかりません。ID: ' + memberId };
    }
    
    var rowNum = rowIndex + 2;
    sheet.deleteRow(rowNum);
    
    return { success: true, deletedId: memberId };
  } catch (e) {
    Logger.log('deleteMember エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの参加ステータストグル (管理者のみ)
 */
function toggleMemberStatus(memberId) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('メンバー一覧');
    if (!sheet) return { success: false, error: 'メンバー一覧シートが見つかりません。' };
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: 'メンバーデータが存在しません。' };
    
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var rowIndex = -1;
    var currentStatus = 'アクティブ';
    
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === memberId) {
        rowIndex = i;
        currentStatus = data[i][6]; // 7列目(インデックス6)がステータス！
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'メンバーIDが見つかりません。ID: ' + memberId };
    }
    
    var nextStatus = currentStatus === 'アクティブ' ? '非アクティブ' : 'アクティブ';
    var rowNum = rowIndex + 2;
    sheet.getRange(rowNum, 7).setValue(nextStatus); // 7列目を更新！
    
    return { success: true, memberId: memberId, nextStatus: nextStatus };
  } catch (e) {
    Logger.log('toggleMemberStatus エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの次回優先ステータストグル (管理者のみ)
 */
function toggleMemberPriority(memberId) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('メンバー一覧');
    if (!sheet) return { success: false, error: 'メンバー一覧シートが見つかりません。' };
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: 'メンバーデータが存在しません。' };
    
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var rowIndex = -1;
    var currentPriority = false;
    
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === memberId) {
        rowIndex = i;
        currentPriority = !!data[i][7]; // 8列目(インデックス7)が次回優先フラグ！
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'メンバーIDが見つかりません。ID: ' + memberId };
    }
    
    var nextPriority = !currentPriority;
    var rowNum = rowIndex + 2;
    sheet.getRange(rowNum, 8).setValue(nextPriority);
    
    return { success: true, memberId: memberId, nextPriority: nextPriority };
  } catch (e) {
    Logger.log('toggleMemberPriority エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング結果履歴の確定・保存 (管理者のみ)
 */
function saveMatchingHistory(groups, matchingMethod) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('マッチング履歴');
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName('マッチング履歴');
    }
    
    var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    
    // 今回マッチングされたメンバーIDを収集
    var matchedMemberIds = [];
    groups.forEach(function(group) {
      var memberIds = group.members.map(function(m) { return m.id; }).join(',');
      var memberNames = group.members.map(function(m) { return m.name; }).join(', ');
      
      sheet.appendRow([
        todayStr,
        group.groupId,
        memberIds,
        memberNames,
        matchingMethod || 'Gemini',
        group.memo || ''
      ]);
      
      group.members.forEach(function(m) {
        matchedMemberIds.push(m.id);
      });
    });
    
    sheet.autoResizeColumns(1, 6);
    
    // --- 優先フラグ（次回優先）の自動更新処理 ---
    var allMembers = getMembers();
    var activeMembers = allMembers.filter(function(m) { return m.status === 'アクティブ'; });
    
    var memberSheet = ss.getSheetByName('メンバー一覧');
    if (memberSheet) {
      var lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        var memberIdsInSheet = memberSheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
        var priorityRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
        var priorities = priorityRange.getValues();
        
        for (var i = 0; i < memberIdsInSheet.length; i++) {
          var mId = memberIdsInSheet[i];
          
          if (matchedMemberIds.indexOf(mId) !== -1) {
            // 今回マッチングされた人は「次回優先」を解除
            priorities[i][0] = false;
          } else {
            // 今回マッチングされず、かつ「アクティブ」なメンバーは「次回優先」に設定
            var isActive = activeMembers.some(function(m) { return m.id === mId; });
            if (isActive) {
              priorities[i][0] = true;
            }
          }
        }
        // スプレッドシートへ一括書き込みし、即時同期
        priorityRange.setValues(priorities);
        SpreadsheetApp.flush();
      }
    }
    
    return { success: true };
  } catch (e) {
    Logger.log('saveMatchingHistory エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Gemini API接続の疎通テスト用関数 (管理者のみ)
 */
function testGeminiConnection(apiKey) {
  try {
    checkAdminPermission(); // 権限チェック
    
    if (!apiKey) {
      return { success: false, error: 'APIキーが入力されていません。' };
    }
    
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=' + apiKey;
    var payload = {
      contents: [{
        parts: [{ text: 'Hello, this is a test. Reply with one word "OK" if you hear me.' }]
      }]
    };
    
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();
    
    if (responseCode === 200) {
      var json = JSON.parse(responseBody);
      var text = json.candidates[0].content.parts[0].text.trim();
      return { success: true, message: '接続テスト成功: ' + text };
    } else {
      var errorJson;
      try {
        errorJson = JSON.parse(responseBody);
      } catch(ex) {}
      var errorMsg = errorJson && errorJson.error && errorJson.error.message 
        ? errorJson.error.message 
        : 'ステータスコード ' + responseCode;
      return { success: false, error: 'APIエラー: ' + errorMsg };
    }
  } catch (e) {
    return { success: false, error: '接続エラー: ' + e.toString() };
  }
}

/**
 * ==========================================
 * 一般ユーザー向け API（認証不要・自己管理用）
 * ==========================================
 */

/**
 * ログインユーザー自身のプロフィールの自己登録・更新
 * セキュリティ保護のため、ログイン中のSessionメールアドレスを強制適用する
 */
function registerSelfProfile(profileObj) {
  try {
    var userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      return { success: false, error: 'Googleアカウントにログインしていないか、メールアドレスが取得できません。ポータルのデプロイ設定をご確認ください。' };
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('メンバー一覧');
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName('メンバー一覧');
    }
    
    var members = getMembers();
    var myProfile = members.find(function(m) { 
      return m.email.toLowerCase() === userEmail.toLowerCase(); 
    });
    
    var result;
    
    if (myProfile) {
      // 既存プロフィールの更新
      var updateObj = {
        id: myProfile.id,
        name: profileObj.name,
        email: userEmail, // メールアドレスは強制的に自分のものにする
        department: profileObj.department,
        interests: profileObj.interests || '',
        purpose: profileObj.purpose || '',
        status: profileObj.status || 'アクティブ',
        priority: myProfile.priority || false // 優先フラグを引き継ぐ
      };
      result = updateMemberInSheet(updateObj);
    } else {
      // 新規自己登録
      var addObj = {
        name: profileObj.name,
        email: userEmail, // メールアドレスは強制的に自分のものにする
        department: profileObj.department,
        interests: profileObj.interests || '',
        purpose: profileObj.purpose || '',
        status: profileObj.status || 'アクティブ',
        priority: false // 新規登録時は優先ではない
      };
      result = addMemberToSheet(addObj);
    }
    
    if (result.success) {
      return { success: true, myProfile: result.member };
    } else {
      return { success: false, error: result.error };
    }
  } catch (e) {
    Logger.log('registerSelfProfile エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * 特定のチャットルーム（グループ）に対するアクセス権があるか判定する
 */
function checkRoomAccess(userEmail, roomId) {
  if (!userEmail) return false;
  
  // 管理者はすべてのルームにアクセス可能にする (閲覧・送信のガード解除)
  try {
    var settings = getSettings();
    var adminEmailsStr = settings.admin_emails || '';
    var adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim().toLowerCase(); });
    

    
    if (adminEmails.indexOf(userEmail.toLowerCase()) !== -1) {
      return true; // 管理者なので無条件でアクセス許可
    }
  } catch (e) {
    Logger.log('checkRoomAccess内での管理者判定エラー: ' + e.toString());
  }
  
  // ルームIDから開催日とグループIDをパース (例: "2026-05-24_G-1" -> "2026-05-24", "G-1")
  var parts = roomId.split('_');
  if (parts.length < 2) return false;
  var dateStr = parts[0];
  var groupId = parts[1];
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('マッチング履歴');
  if (!sheet) return false;
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  
  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  
  // 指定した開催日＆グループIDのマッチング履歴行を探す
  var targetRow = null;
  for (var i = 0; i < data.length; i++) {
    var val = data[i][0];
    var rowDate = val instanceof Date ? Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd') : val.toString();
    var rowGroupId = data[i][1];
    if (rowDate === dateStr && rowGroupId === groupId) {
      targetRow = data[i];
      break;
    }
  }
  
  if (!targetRow) return false;
  
  // そのグループに所属するメンバーID一覧 (カンマ区切り)
  var memberIdsStr = targetRow[2] || '';
  var memberIds = memberIdsStr.split(',').map(function(id) { return id.trim(); });
  
  // ログインユーザーのメンバー情報を取得
  var members = getMembers();
  var currentUser = members.find(function(m) { return m.email.toLowerCase() === userEmail.toLowerCase(); });
  
  if (!currentUser) return false;
  
  // ログインユーザーのメンバーIDが、グループのメンバーリストに含まれているか判定
  return memberIds.indexOf(currentUser.id) !== -1;
}

/**
 * チャットメッセージ履歴を取得する
 */
function getChatMessages(roomId) {
  try {
    var userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    if (!userEmail) {
      return { success: false, error: 'Googleアカウントにログインしていません。' };
    }
    
    // アクセス権のチェック
    if (!checkRoomAccess(userEmail, roomId)) {
      return { success: false, error: 'このチャットルームへのアクセス権限がありません。' };
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('チャットメッセージ');
    if (!sheet) {
      return { success: true, messages: [] };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, messages: [] };
    }
    
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var messages = [];
    
    data.forEach(function(row) {
      if (row[1] === roomId) {
        messages.push({
          id: row[0],
          roomId: row[1],
          senderId: row[2],
          senderName: row[3],
          senderEmail: row[4],
          department: row[5],
          message: row[6],
          timestamp: row[7]
        });
      }
    });
    
    // 送信日時でソート (古い順)
    messages.sort(function(a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    
    return { success: true, messages: messages };
  } catch (e) {
    Logger.log('getChatMessages エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * チャットメッセージを送信する
 */
function sendChatMessage(roomId, messageText) {
  try {
    var userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    if (!userEmail) {
      return { success: false, error: 'Googleアカウントにログインしていません。' };
    }
    
    if (!messageText || messageText.trim() === '') {
      return { success: false, error: 'メッセージ内容が空です。' };
    }
    
    // アクセス権のチェック
    if (!checkRoomAccess(userEmail, roomId)) {
      return { success: false, error: 'このチャットルームへのアクセス権限がありません。' };
    }
    
    var members = getMembers();
    var currentUser = members.find(function(m) { return m.email.toLowerCase() === userEmail.toLowerCase(); });
    if (!currentUser) {
      return { success: false, error: 'メンバーとして登録されていません。プロフィールを設定してください。' };
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('チャットメッセージ');
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName('チャットメッセージ');
    }
    
    var lastRow = sheet.getLastRow();
    var newId = 'MSG001';
    if (lastRow > 1) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; });
      var maxNum = 0;
      ids.forEach(function(id) {
        var match = id.match(/^MSG(\d+)$/);
        if (match) {
          var num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      newId = 'MSG' + ('000' + (maxNum + 1)).slice(-3);
    }
    
    var timestamp = new Date().toISOString();
    var newRow = [
      newId,
      roomId,
      currentUser.id,
      currentUser.name,
      currentUser.email,
      currentUser.department,
      messageText.trim(),
      timestamp
    ];
    
    sheet.appendRow(newRow);
    SpreadsheetApp.flush(); // 即時同期
    
    // 新しいメッセージ一覧を取得して返す
    return getChatMessages(roomId);
  } catch (e) {
    Logger.log('sendChatMessage エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング履歴とチャットメッセージをクリアする (管理者のみ)
 * ヘッダー行は保持し、データ行のみ削除する
 */
function clearMatchingHistory() {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // マッチング履歴シートのクリア
    var historySheet = ss.getSheetByName('マッチング履歴');
    if (historySheet && historySheet.getLastRow() > 1) {
      historySheet.deleteRows(2, historySheet.getLastRow() - 1);
    }
    
    // チャットメッセージシートのクリア
    var chatSheet = ss.getSheetByName('チャットメッセージ');
    if (chatSheet && chatSheet.getLastRow() > 1) {
      chatSheet.deleteRows(2, chatSheet.getLastRow() - 1);
    }
    
    // 全メンバーの「次回優先」フラグもリセット
    var memberSheet = ss.getSheetByName('メンバー一覧');
    if (memberSheet && memberSheet.getLastRow() > 1) {
      var lastRow = memberSheet.getLastRow();
      var priorityRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
      var priorities = priorityRange.getValues();
      for (var i = 0; i < priorities.length; i++) {
        priorities[i][0] = false;
      }
      priorityRange.setValues(priorities);
    }
    
    SpreadsheetApp.flush();
    
    return { success: true };
  } catch (e) {
    Logger.log('clearMatchingHistory エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * 特定のマッチンググループを履歴から削除する (管理者のみ)
 */
function deleteMatchingGroup(dateStr, groupId) {
  try {
    checkAdminPermission(); // 権限チェック
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('マッチング履歴');
    if (!sheet) return { success: false, error: 'マッチング履歴シートが見つかりません。' };
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: '履歴が存在しません。' };
    
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var rowIndexToDelete = -1;
    
    for (var i = 0; i < data.length; i++) {
      var rowDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], 'Asia/Tokyo', 'yyyy-MM-dd') : data[i][0].toString();
      var rowGroupId = data[i][1];
      
      if (rowDate === dateStr && rowGroupId === groupId) {
        rowIndexToDelete = i + 2; // ヘッダー分+1, 0-indexで+1 => i + 2
        break;
      }
    }
    
    if (rowIndexToDelete === -1) {
      return { success: false, error: '指定されたグループが見つかりません。日付: ' + dateStr + ', グループID: ' + groupId };
    }
    
    // 行の削除
    sheet.deleteRow(rowIndexToDelete);
    
    // チャットメッセージシートからも、該当ルームIDのチャットメッセージを削除してクリーンアップ
    var chatSheet = ss.getSheetByName('チャットメッセージ');
    if (chatSheet) {
      var chatLastRow = chatSheet.getLastRow();
      if (chatLastRow > 1) {
        var roomId = dateStr + '_' + groupId;
        var chatData = chatSheet.getRange(2, 2, chatLastRow - 1, 1).getValues();
        // 下から順に削除 (行番号がズレるのを防ぐため)
        for (var j = chatData.length - 1; j >= 0; j--) {
          if (chatData[j][0] === roomId) {
            chatSheet.deleteRow(j + 2);
          }
        }
      }
    }
    
    SpreadsheetApp.flush();
    return { success: true };
  } catch (e) {
    Logger.log('deleteMatchingGroup エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// -------------------------------------------------------------
// matching.gs より統合されたマッチングロジック
// -------------------------------------------------------------

/**
 * フロントエンドから呼び出されるマッチング実行のエントリーポイント
 * @param {Object} params - { groupSize, groupCount, mode, additionalPrompt }
 */
function runMatching(params) {
  try {
    checkAdminPermission(); // 管理者権限チェック
    
    var settings = getSettings();
    var groupSize = parseInt(params.groupSize || settings.default_group_size || 4, 10);
    var groupCount = parseInt(params.groupCount || settings.default_group_count || 4, 10);
    var mode = params.mode || 'gemini';
    var additionalPrompt = params.additionalPrompt || '';
    
    // アクティブなメンバー一覧の取得
    var allMembers = getMembers();
    var activeMembers = allMembers.filter(function(m) { return m.status === 'アクティブ'; });
    
    if (activeMembers.length < 2) {
      return { success: false, error: 'アクティブなメンバーが少なすぎます（最低2名必要です）。' };
    }
    
    // --- 優先参加 & あふれメンバー選出制御 ---
    var maxParticipants = groupSize * groupCount;
    var selectedMembers = [];
    var unmatchedMembers = [];
    
    // 優先メンバーと通常メンバーの分類 (同じ優先度内でもシャッフルして公平性を保つ)
    var priorityMembers = activeMembers.filter(function(m) { return !!m.priority; });
    var regularMembers = activeMembers.filter(function(m) { return !m.priority; });
    
    priorityMembers = arrayShuffle(priorityMembers);
    regularMembers = arrayShuffle(regularMembers);
    
    // 優先メンバーを先に選出
    selectedMembers = selectedMembers.concat(priorityMembers);
    
    if (selectedMembers.length >= maxParticipants) {
      // 優先メンバーだけで最大枠を超える場合
      // 超えた分はあふれ、次回も優先される
      unmatchedMembers = selectedMembers.slice(maxParticipants);
      selectedMembers = selectedMembers.slice(0, maxParticipants);
      
      // 通常メンバーは全員あぶれて次回優先に回る
      unmatchedMembers = unmatchedMembers.concat(regularMembers);
    } else {
      // 優先メンバー全員を入れても枠に余裕がある場合
      var neededCount = maxParticipants - selectedMembers.length;
      var additionals = regularMembers.slice(0, neededCount);
      selectedMembers = selectedMembers.concat(additionals);
      
      // 選ばれなかった通常メンバーはあふれて次回優先に回る
      unmatchedMembers = regularMembers.slice(neededCount);
    }
    
    // グループ数が選択されたメンバー数を超える場合は、空グループを防ぐためにクランプ
    if (selectedMembers.length < groupCount) {
      groupCount = selectedMembers.length;
    }
    
    // 過去のマッチング履歴の取得
    var history = getMatchingHistory();
    
    var result;
    var finalMethod = mode;
    var apiKey = settings.gemini_api_key;
    
    if (mode === 'gemini') {
      if (!apiKey) {
        Logger.log('APIキーが設定されていないため、独自プログラムロジックにフォールバックします。');
        result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
        finalMethod = 'logic_fallback';
      } else {
        result = runGeminiMatching(selectedMembers, history, groupSize, groupCount, apiKey, additionalPrompt);
        if (!result.success) {
          Logger.log('Gemini API呼び出しが失敗したため、独自プログラムロジックにフォールバックします。エラー: ' + result.error);
          result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
          finalMethod = 'logic_fallback';
        }
      }
    } else {
      result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
      finalMethod = 'logic';
    }
    
    if (result && result.success && result.groups) {
      // グループIDを通算のユニークな連番にする (例: 前回がG-4までなら、今回はG-5から開始)
      var maxGroupIdNum = 0;
      history.forEach(function(h) {
        var match = h.groupId.match(/^G-(\d+)$/);
        if (match) {
          var num = parseInt(match[1], 10);
          if (num > maxGroupIdNum) {
            maxGroupIdNum = num;
          }
        }
      });

      result.groups.forEach(function(group, idx) {
        group.groupId = 'G-' + (maxGroupIdNum + idx + 1);
      });
    }

    return {
      success: true,
      method: finalMethod,
      groups: result.groups,
      unmatched: unmatchedMembers // 今回選出枠からあふれたメンバー
    };
  } catch (e) {
    Logger.log('runMatching エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Engine A: Gemini API によるインテリジェントマッチング
 */
function runGeminiMatching(members, history, groupSize, groupCount, apiKey, additionalPrompt) {
  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=' + apiKey;
    
    // プロンプトに渡すためのデータをコンパクトに整理
    var membersData = members.map(function(m) {
      return {
        id: m.id,
        name: m.name,
        dept: m.department,
        interests: m.interests,
        purpose: m.purpose
      };
    });
    
    // 過去履歴のコンパクト化 (直近8回分程度で十分)
    var compactHistory = history.slice(0, 8).map(function(h) {
      return {
        date: h.date,
        groups: h.memberIds
      };
    });
    
    var systemInstruction = 
      "あなたは優秀な社内交流ファシリテーターです。提示されたメンバーのリストから、ランチ交流会のグループ分けを決定してください。\n" +
      "【制約ルール】\n" +
      "1. グループ数は【厳密に " + groupCount + " 組】（groupIdは \"G-1\" から \"G-" + groupCount + "\"）作成してください。提示されたメンバー全員（総勢 " + members.length + " 名）を、いずれかのグループに漏れなく割り当ててください。\n" +
      "2. 1グループあたりの目標人数は " + groupSize + " 名ですが、総人数が少ない場合は各グループが均等な人数（例：総数8名で3組なら、3名、3名、2名など、サイズ差が最大1以内）になるように美しく均してください。\n" +
      "3. 異なる部署・チームのメンバーが極力同じグループになるように「部署の多様性」を最優先してください。\n" +
      "4. 趣味、自己紹介、参加目的などを考慮し、共通点がある人同士を組み合わせると会話が弾みやすいので、適度に「趣味・関心の合致」を考慮してください。\n" +
      "5. 過去のマッチング履歴（ compactHistory ）を確認し、直近で同じグループになった人同士ができるだけ被らないように配慮してください。\n" +
      "6. 出力フォーマットは指定された厳密なJSONスキーマのみとし、余計な説明文やMarkdown ofコードブロック（```json など）は含めず、純粋なJSON文字列として返してください。";

    var prompt = 
      "【メンバーリスト】\n" + JSON.stringify(membersData) + "\n\n" +
      "【過去のマッチング履歴】\n" + JSON.stringify(compactHistory) + "\n\n" +
      "【管理者からの追加指示】\n" + (additionalPrompt ? additionalPrompt : "特になし") + "\n\n" +
      "【期待する出力フォーマット(JSON)】\n" +
      "{\n" +
      "  \"groups\": [\n" +
      "    {\n" +
      "      \"groupId\": \"G-1\",\n" +
      "      \"members\": [\"M001\", \"M002\", \"M003\"],\n" +
      "      \"memo\": \"（日本語で1〜2文）なぜこの組み合わせにしたのか、共通の話題やおすすめの雑談テーマなど\"\n" +
      "    }\n" +
      "  ]\n" +
      "}\n\n" +
      "では、グループ分けを実行し、上記のJSONフォーマットに従って返答してください。";

    var payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };
    
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();
    
    if (responseCode !== 200) {
      return { success: false, error: 'Gemini APIエラー: ステータスコード ' + responseCode + '\n' + responseBody };
    }
    
    var jsonResult = JSON.parse(responseBody);
    var generatedText = jsonResult.candidates[0].content.parts[0].text;
    
    // JSONのパース
    var parsedData = JSON.parse(generatedText.trim());
    
    if (!parsedData.groups || !Array.isArray(parsedData.groups)) {
      return { success: false, error: 'Geminiの返却データ構造が正しくありません。' };
    }
    
    // IDから詳細なメンバー情報を復元してフロントに返す形にする
    var finalGroups = parsedData.groups.map(function(g, idx) {
      var matchedMembers = g.members.map(function(id) {
        return members.find(function(m) { return m.id === id; });
      }).filter(Boolean); // nullやundefinedを除外
      
      return {
        groupId: 'G-' + (idx + 1), // Geminiの出力ゆらぎに依存せず、連番のグループIDを強制適用する
        members: matchedMembers,
        memo: g.memo || ''
      };
    });
    
    return { success: true, groups: finalGroups };
  } catch (e) {
    Logger.log('runGeminiMatching エラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Engine B: 独自プログラムロジックによるマッチング（山登り法）
 */
function runLogicMatching(members, history, targetSize, targetCount) {
  var totalMembers = members.length;
  
  // 1. グループ数の決定 (指定された組数を厳密に使用)
  var numGroups = targetCount || Math.max(1, Math.round(totalMembers / targetSize));
  
  // 実態に合わせた目標グループ人数（均等に均すための目標サイズ）
  var actualTargetSize = Math.ceil(totalMembers / numGroups);
  
  // 2. ペアごとの被りペナルティマップの構築
  var penaltyMap = {};
  
  // 履歴から被りカウントを計算
  history.forEach(function(h) {
    var ids = h.memberIds;
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var key1 = ids[i] + '-' + ids[j];
        var key2 = ids[j] + '-' + ids[i];
        penaltyMap[key1] = (penaltyMap[key1] || 0) + 1;
        penaltyMap[key2] = (penaltyMap[key2] || 0) + 1;
      }
    }
  });

  // メンバーIDリストのシャッフル
  var shuffledIds = members.map(function(m) { return m.id; });
  shuffledIds = arrayShuffle(shuffledIds);
  
  // 初期グループ割り当て
  var groups = [];
  for (var g = 0; g < numGroups; g++) {
    groups.push([]);
  }
  
  for (var i = 0; i < shuffledIds.length; i++) {
    groups[i % numGroups].push(shuffledIds[i]);
  }
  
  // スコア計算関数（低いほど良い）
  function calculateTotalPenalty(currentGroups) {
    var totalPenalty = 0;
    
    currentGroups.forEach(function(group) {
      for (var i = 0; i < group.length; i++) {
        var m1 = members.find(function(m) { return m.id === group[i]; });
        if (!m1) continue;
        
        for (var j = i + 1; j < group.length; j++) {
          var m2 = members.find(function(m) { return m.id === group[j]; });
          if (!m2) continue;
          
          // 1) 過去の被りペナルティ (1回被るごとに +100点)
          var key = m1.id + '-' + m2.id;
          var historyCount = penaltyMap[key] || 0;
          totalPenalty += historyCount * 100;
          
          // 2) 同一部署ペナルティ (同一部署なら +40点)
          if (m1.department === m2.department) {
            totalPenalty += 40;
          }
          
          // 3) 趣味の簡易的な共通点ボーナス (趣味の文字列の中に共通の名詞等があれば -10点)
          var interests1 = m1.interests || '';
          var interests2 = m2.interests || '';
          var commonWord = findCommonWord(interests1, interests2);
          if (commonWord) {
            totalPenalty -= 10;
          }
        }
      }
      
      // グループ内の人数の偏りペナルティ (実態目標サイズから離れるほどペナルティ)
      var sizeDiff = Math.abs(group.length - actualTargetSize);
      totalPenalty += sizeDiff * 20;
    });
    
    return totalPenalty;
  }
  
  // 山登り法による最適化ループ (2500回試行)
  var currentScore = calculateTotalPenalty(groups);
  var maxIterations = 2500;
  
  for (var iter = 0; iter < maxIterations; iter++) {
    // ランダムに2つのグループを選択
    var g1Idx = Math.floor(Math.random() * numGroups);
    var g2Idx = Math.floor(Math.random() * numGroups);
    
    if (g1Idx === g2Idx || groups[g1Idx].length === 0 || groups[g2Idx].length === 0) {
      continue;
    }
    
    // それぞれのグループからランダムに1人ずつ選択してスワップ
    var p1Idx = Math.floor(Math.random() * groups[g1Idx].length);
    var p2Idx = Math.floor(Math.random() * groups[g2Idx].length);
    
    // スワップ
    var temp = groups[g1Idx][p1Idx];
    groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
    groups[g2Idx][p2Idx] = temp;
    
    // 新しいスコアの計算
    var newScore = calculateTotalPenalty(groups);
    
    if (newScore < currentScore) {
      // 改善されたので確定
      currentScore = newScore;
    } else {
      // 悪化したのでスワップを元に戻す
      var tempBack = groups[g1Idx][p1Idx];
      groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
      groups[g2Idx][p2Idx] = tempBack;
    }
  }
  
  // 3. 結果の整形
  var finalGroups = groups.map(function(grpIds, idx) {
    var matchedMembers = grpIds.map(function(id) {
      return members.find(function(m) { return m.id === id; });
    }).filter(Boolean);
    
    // グループ内の同一部署の割合を計算し、メモを自動生成
    var depts = matchedMembers.map(function(m) { return m.department; });
    var uniqueDepts = depts.filter(function(v, i, self) { return self.indexOf(v) === i; });
    
    var memo = '【独自ロジック選出】過去の履歴を考慮し、重複を極力回避して最適化しました。';
    if (uniqueDepts.length === matchedMembers.length) {
      memo += '全員が異なる部署（' + uniqueDepts.join(', ') + '）から選出された多様性重視のグループです。';
    } else {
      memo += '一部同部署が含まれますが、過去の被り回数を最小限に抑えています。部署：' + depts.join('、') + '。';
    }
    
    return {
      groupId: 'G-' + (idx + 1),
      members: matchedMembers,
      memo: memo
    };
  });
  
  return { success: true, groups: finalGroups };
}

/**
 * 配列をシャッフルするヘルパー関数
 */
function arrayShuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;
  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }
  return array;
}

/**
 * 簡易的な趣味の共通キーワード検出（サウナ、ゲーム、読書、カメラ、キャンプなど）
 */
function findCommonWord(str1, str2) {
  if (!str1 || !str2) return null;
  var keywords = ['サウナ', 'カフェ', 'ゴルフ', 'テニス', '旅行', 'キャンプ', '料理', 'カレー', '読書', '映画', 'ゲーム', 'デザイン', 'カメラ', 'コーヒー', 'ピラティス', 'ヨガ', '筋トレ'];
  for (var i = 0; i < keywords.length; i++) {
    var kw = keywords[i];
    if (str1.indexOf(kw) !== -1 && str2.indexOf(kw) !== -1) {
      return kw;
    }
  }
  return null;
}
