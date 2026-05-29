/**
 * 社内ランチ交流会マッチングシステム - メインサーバーロジック
 */

// Web Appへのアクセス時にHTMLを出力する
function doGet(e) {
  // 起動時に自動でスプレッドシートの初期化を行う（シートが存在しない場合のみ作成）
  initDatabase();

  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("社内ランチ交流会 - マッチングポータル")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// スプレッドシートが開かれたときのメニュー追加
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("ランチ交流会")
    .addItem("管理者画面の初期化/デモデータ挿入", "initDatabase")
    .addItem("ポータル画面のURLを表示", "showWebAppUrl")
    .addToUi();
}

// Webポータル画面のURLを取得する関数（設定シートに値があれば優先し、無ければ自動取得）
function getPortalUrl() {
  try {
    const settings = getSettings();
    if (settings.webapp_url && settings.webapp_url.trim() !== "") {
      return settings.webapp_url.trim();
    }
  } catch (e) {
    Logger.log(`getPortalUrl エラー: ${e.toString()}`);
  }
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    Logger.log(`Web App URLの自動取得に失敗しました: ${e.toString()}`);
    return "";
  }
}

// Web Appの公開URLをポップアップ表示する関数
function showWebAppUrl() {
  const url = getPortalUrl();
  const ui = SpreadsheetApp.getUi();
  if (url) {
    const htmlOutput = HtmlService.createHtmlOutput(
      `<p>以下のURLからマッチングポータル（ユーザー/管理者画面）にアクセスできます：</p><p><a href="${url}" target="_blank" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">ポータルを開く</a></p>`
    )
      .setWidth(400)
      .setHeight(150);
    ui.showModalDialog(htmlOutput, "ポータル画面のURL");
  } else {
    ui.alert(
      "Webアプリケーションとしてデプロイされていないか、URLが設定されていません。「設定」シートに webapp_url を手動で設定するか、デプロイを行ってください。"
    );
  }
}

// スプレッドシートデータベースの自動初期化
function initDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("アクティブなスプレッドシートが見つかりません。");
    return;
  }

  // 現在実行しているユーザーのメールアドレスを取得して初期の管理者にする
  const activeEmail = Session.getActiveUser().getEmail();

  // 1. 設定シートの作成・初期化
  let setupSheet = ss.getSheetByName("設定");
  if (!setupSheet) {
    setupSheet = ss.insertSheet("設定");
    setupSheet.appendRow(["設定キー", "設定値", "説明"]);
    setupSheet.appendRow([
      "admin_emails",
      activeEmail || "",
      "管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）",
    ]);
    setupSheet.appendRow([
      "gemini_api_key",
      "",
      "Google AI Studioから取得したGemini APIキー。空の場合は独自ロジックで動作します。",
    ]);
    setupSheet.appendRow([
      "matching_mode",
      "gemini",
      'マッチングモード ("gemini" または "logic")',
    ]);
    setupSheet.appendRow([
      "default_group_size",
      "4",
      "1グループあたりの基本目標人数",
    ]);
    setupSheet.appendRow([
      "default_group_count",
      "4",
      "標準の目標グループ数（組数）",
    ]);
    setupSheet.appendRow([
      "additional_prompt",
      "部署ができるだけ被らないようにしてください。共通の趣味がある人を同じグループに混ぜると盛り上がるので考慮してください。",
      "Geminiへの追加指示プロンプト",
    ]);
    setupSheet.appendRow([
      "webapp_url",
      "",
      "Webポータル画面の公開URL（未入力の場合は自動取得のURLを使用します。/dev を指定したい場合は手動で入力してください）",
    ]);

    // 見栄えの調整
    setupSheet.getRange("A1:C1").setBackground("#f1f5f9").setFontWeight("bold");
    setupSheet.autoResizeColumns(1, 3);
  } else {
    // 既存の設定シートがある場合、足りないキーがあれば追加する
    const lastRow = setupSheet.getLastRow();
    const keys = setupSheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .map(r => r[0]);

    if (!keys.includes("admin_emails")) {
      setupSheet.appendRow([
        "admin_emails",
        activeEmail || "",
        "管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）",
      ]);
    }
    if (!keys.includes("default_group_count")) {
      setupSheet.appendRow([
        "default_group_count",
        "4",
        "標準の目標グループ数（組数）",
      ]);
    }
    if (!keys.includes("webapp_url")) {
      setupSheet.appendRow([
        "webapp_url",
        "",
        "Webポータル画面の公開URL（未入力の場合は自動取得のURLを使用します。/dev を指定したい場合は手動で入力してください）",
      ]);
    }
  }

  // 1.5. 部署マスタシートの作成・初期化
  let deptSheet = ss.getSheetByName("部署マスタ");
  if (!deptSheet) {
    deptSheet = ss.insertSheet("部署マスタ");
    deptSheet.appendRow(["部署ID", "部署名"]);
    const initialDepts = [
      ["D001", "管理室"],
      ["D002", "BPO統括部"],
      ["D003", "東京統括部"],
      ["D004", "ST開発部"],
      ["D005", "営業統括部"],
      ["D006", "印刷統括部"],
      ["D007", "その他"]
    ];
    initialDepts.forEach(row => deptSheet.appendRow(row));

    // 見栄えの調整
    deptSheet.getRange("A1:B1").setBackground("#f1f5f9").setFontWeight("bold");
    deptSheet.autoResizeColumns(1, 2);
  }

  // 2. メンバー一覧シートの作成・初期化
  let memberSheet = ss.getSheetByName("メンバー一覧");
  let isNewMemberSheet = false;
  if (!memberSheet) {
    memberSheet = ss.insertSheet("メンバー一覧");
    memberSheet.appendRow([
      "メンバーID",
      "名前",
      "メールアドレス",
      "部署・チーム",
      "趣味・自己紹介・興味のあること",
      "配慮事項",
      "ステータス",
      "次回優先",
    ]);
    memberSheet
      .getRange("A1:H1")
      .setBackground("#f1f5f9")
      .setFontWeight("bold");
    isNewMemberSheet = true;
  } else {
    // 既存のシートのアップグレードとカラムの順序整理
    // 目的: 「配慮事項」を「趣味・自己紹介・興味のあること」の右（＝6列目：F列）に配置する。
    let headers = memberSheet
      .getRange(1, 1, 1, Math.max(memberSheet.getLastColumn(), 8))
      .getValues()[0];

    // 0. 「参加目的」列があれば削除する
    const purposeColIdx = headers.indexOf("参加目的");
    if (purposeColIdx !== -1) {
      memberSheet.deleteColumn(purposeColIdx + 1);
      // ヘッダーを再取得
      headers = memberSheet
        .getRange(1, 1, 1, Math.max(memberSheet.getLastColumn(), 8))
        .getValues()[0];
    }

    // 1. まず「次回優先」が無ければ追加（新8列目：H列になる）
    const priorityIndex = headers.indexOf("次回優先");
    if (priorityIndex === -1) {
      memberSheet.getRange(1, 8).setValue("次回優先");
      memberSheet.getRange("H1").setBackground("#f1f5f9").setFontWeight("bold");
      const lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        const checkboxRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
        checkboxRange.insertCheckboxes();
        checkboxRange.setValue(false);
      }
      headers = memberSheet
        .getRange(1, 1, 1, memberSheet.getLastColumn())
        .getValues()[0]; // 再取得
    }

    // 2. 「配慮事項」の位置を確認し、6列目（F列、インデックス5）に移設または新規挿入する
    const considerationsIndex = headers.indexOf("配慮事項");
    if (considerationsIndex === -1) {
      // 存在しない場合は6列目に挿入
      memberSheet.insertColumnAfter(5); // E列の後に空列を挿入（＝新6列目・F列になる）
      memberSheet.getRange(1, 6).setValue("配慮事項");
      memberSheet.getRange("F1").setBackground("#f1f5f9").setFontWeight("bold");
    } else if (considerationsIndex !== 5) {
      // 6列目以外にある場合、6列目に挿入してデータを移動する
      memberSheet.insertColumnAfter(5); // E列の後に新F列（6列目）を挿入。
      headers = memberSheet
        .getRange(1, 1, 1, memberSheet.getLastColumn())
        .getValues()[0]; // ズレた後のヘッダーを再取得
      const oldColIdx = headers.indexOf("配慮事項") + 1; // 1-based の新しい列インデックス

      const lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        const oldRange = memberSheet.getRange(2, oldColIdx, lastRow - 1, 1);
        const newRange = memberSheet.getRange(2, 6, lastRow - 1, 1);
        oldRange.copyTo(newRange);
      }

      memberSheet.getRange(1, 6).setValue("配慮事項");
      memberSheet.getRange("F1").setBackground("#f1f5f9").setFontWeight("bold");

      // 元の「配慮事項」列を削除
      memberSheet.deleteColumn(oldColIdx);
    }
  }

  // 既存のステータス列（7列目、G列）のブーリアン移行＆チェックボックス化のマイグレーション
  // ※ 既にブーリアン型(true/false)が入っているセルは変換対象外
  if (memberSheet) {
    const lastRow = memberSheet.getLastRow();
    if (lastRow > 1) {
      const statusRange = memberSheet.getRange(2, 7, lastRow - 1, 1);
      const statusValues = statusRange.getValues();
      let dataChanged = false;
      for (let i = 0; i < statusValues.length; i++) {
        const val = statusValues[i][0];
        // 既にブーリアン型の場合はスキップ（チェックボックスの値を壊さない）
        if (typeof val === "boolean") continue;
        // 文字列型のみ変換対象とする
        if (val === "アクティブ" || val === "TRUE" || val === "true") {
          statusValues[i][0] = true;
          dataChanged = true;
        } else if (
          val === "非アクティブ" ||
          val === "FALSE" ||
          val === "false" ||
          val === ""
        ) {
          statusValues[i][0] = false;
          dataChanged = true;
        }
      }
      if (dataChanged) {
        statusRange.setValues(statusValues);
      }
      statusRange.insertCheckboxes(); // チェックボックスを挿入（すでに挿入されていても安全）
    }
  }

  // デモデータの投入（メンバー一覧シートが空、または新規作成された場合）
  if (isNewMemberSheet || memberSheet.getLastRow() <= 1) {
    const demoMembers = [
      ["M001", "山田 太郎", "yamada.t@example.com", "開発部", "趣味はサウナとTypeScript。最近はDIYにハマっています。", "", true, false],
      ["M002", "佐藤 美咲", "sato.m@example.com", "人事部", "休日はカフェ巡りやヨガをしています。旅行が大好きです。", "", true, false],
      ["M003", "鈴木 健一", "suzuki.k@example.com", "開発部", "GolangとAWSが得意。コーヒーを自分で焙煎して淹れるのが趣味。", "", true, false],
      ["M004", "高橋 玲子", "takahashi.r@example.com", "マーケティング部", "映画鑑賞（SF・サスペンス）とピラティス。新しいトレンド分析が好き。", "", true, false],
      ["M005", "田中 達也", "tanaka.t@example.com", "営業部", "学生時代からゴルフをしています。週末はだいたいグリーンにいます。", "", true, false],
      ["M006", "渡辺 奈々", "watanabe.n@example.com", "総務部", "料理（特にスパイスカレー作り）と猫の動画を見るのが癒やし。", "", true, false],
      ["M007", "伊藤 淳", "ito.j@example.com", "開発部", "Figmaでのデザイン、カメラ（スナップ写真）、ガジェット集め。", "", true, false],
      ["M008", "山本 結衣", "yamamoto.y@example.com", "営業部", "読書（ビジネス書から小説まで）とアロマテラピー。美味しいパン屋探し。", "", true, false],
      ["M009", "中村 翔", "nakamura.s@example.com", "マーケティング部", "キャンプ、BBQ、ロードバイク。分析ツールを触るのが好き。", "", true, false],
      ["M010", "小林 直樹", "kobayashi.n@example.com", "人事部", "テニスと筋トレ。最近は健康食作りにも取り組んでいます。", "", true, false],
      ["M011", "加藤 沙織", "kato.s@example.com", "開発部", "Flutter、Swift。趣味はゲーム（RPG、インディーゲーム）と謎解き。", "", true, false],
      ["M012", "吉田 拓海", "yoshida.t@example.com", "新規事業部", "サウナ、ポッドキャストを聴くこと、スタートアップ研究。", "", true, false],
      ["M013", "佐々木 萌", "sasaki.m@example.com", "広報部", "美術館巡り、イラストを描くこと、SNS運用。美味しいワインが好き。", "", true, false],
      ["M014", "山口 健太", "yamaguchi.k@example.com", "開発部", "Kubernetes、Terraform。趣味はボードゲームとキャンプです。", "", true, false],
      ["M015", "松本 恵", "matsumoto.m@example.com", "営業部", "ピラティス、韓国ドラマ鑑賞、激辛グルメの開拓。", "", true, false],
      ["M016", "斎藤 翼", "saito.t@example.com", "開発部", "自動テスト、バグハント。趣味はランニングと麻雀です。", "", true, false],
    ];

    demoMembers.forEach(member => memberSheet.appendRow(member));

    // チェックボックスを挿入（7列目のステータス、8列目の次回優先）
    const lastRow = memberSheet.getLastRow();
    if (lastRow > 1) {
      memberSheet.getRange(2, 7, lastRow - 1, 1).insertCheckboxes();
      memberSheet.getRange(2, 8, lastRow - 1, 1).insertCheckboxes();
    }

    memberSheet.autoResizeColumns(1, 8);
  }

  // 3. マッチング履歴シートの作成・初期化
  let historySheet = ss.getSheetByName("マッチング履歴");
  if (!historySheet) {
    historySheet = ss.insertSheet("マッチング履歴");
    historySheet.appendRow([
      "開催日",
      "グループID",
      "メンバーID一覧",
      "メンバー名一覧",
      "マッチング方法",
      "選出理由 / メモ",
    ]);
    historySheet
      .getRange("A1:F1")
      .setBackground("#f1f5f9")
      .setFontWeight("bold");

    // ダミー履歴を1回分投入してタイムラインが動くようにする
    const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    historySheet.appendRow([
      todayStr,
      "G-1",
      "M001,M003,M007,M011",
      "山田 太郎, 鈴木 健一, 伊藤 淳, 加藤 沙織",
      "Logic (Demo)",
      "全員が開発部に所属するメンバー。TypeScript, Golang, Figma, Flutterなどの技術的興味が近く、技術雑談が非常に盛り上がるグループとしてマッチングしました。",
    ]);
    historySheet.appendRow([
      todayStr,
      "G-2",
      "M002,M004,M005,M006",
      "佐藤 美咲, 高橋 玲子, 田中 達也, 渡辺 奈々",
      "Logic (Demo)",
      "人事、マーケ、営業、総務と、多様な部署のメンバーをマッチング。他部署交流に最適で、映画やサウナなどの共通の休日趣味もあり会話が弾む構成です。",
    ]);

    historySheet.autoResizeColumns(1, 6);
  }

  // 4. チャットメッセージシートの作成・初期化
  let chatSheet = ss.getSheetByName("チャットメッセージ");
  if (!chatSheet) {
    chatSheet = ss.insertSheet("チャットメッセージ");
    chatSheet.appendRow([
      "メッセージID",
      "ルームID",
      "送信者ID",
      "送信者名",
      "送信者メール",
      "部署名",
      "メッセージ内容",
      "送信日時",
    ]);
    chatSheet.getRange("A1:H1").setBackground("#f1f5f9").setFontWeight("bold");

    // デモ履歴のグループG-1用のデモチャットデータを投入
    const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    const demoRoomId = `${todayStr}_G-1`;
    const now = new Date();

    chatSheet.appendRow([
      "MSG001",
      demoRoomId,
      "M001",
      "山田 太郎",
      "yamada.t@example.com",
      "開発部",
      "はじめまして！山田です。みなさん、次回のランチ会よろしくお願いします！サウナとTypeScriptが趣味です。",
      new Date(now.getTime() - 3600000).toISOString(), // 1時間前
    ]);
    chatSheet.appendRow([
      "MSG002",
      demoRoomId,
      "M003",
      "鈴木 健一",
      "suzuki.k@example.com",
      "開発部",
      "鈴木です！よろしくお願いします。僕はコーヒーの自家焙煎が趣味なので、コーヒーについて語りましょう！",
      new Date(now.getTime() - 1800000).toISOString(), // 30分前
    ]);
    chatSheet.appendRow([
      "MSG003",
      demoRoomId,
      "M007",
      "伊藤 淳",
      "ito.j@example.com",
      "開発部",
      "デザイナーの伊藤です。よろしくお願いします！僕もサウナ大好きなので、おすすめのサウナ施設についてお話ししたいです！",
      new Date(now.getTime() - 600000).toISOString(), // 10分前
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
  const userEmail =
    Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (!userEmail) {
    throw new Error(
      "Googleアカウントにログインしていないか、メールアドレスの取得権限がありません。Webアプリのデプロイ設定をご確認ください。"
    );
  }

  const adminEmails = getAdminEmails();

  if (!adminEmails.includes(userEmail.toLowerCase())) {
    throw new Error(`管理者権限がありません。アカウント: ${userEmail}`);
  }
  return true;
}

/**
 * 初期データ取得（メンバー、設定、履歴をまとめて取得）
 * 一般ユーザーと管理者で返却データを制御する
 */
function getInitialData() {
  try {
    // ※ initDatabase() はここでは呼ばない（doGet で1回のみ呼び出す設計）
    // 毎回呼ぶとマイグレーション処理がアクセスのたびに実行されステータスが壊れる恐れがある

    // getActiveUser() が空の場合は getEffectiveUser() を使用
    const userEmail =
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail();
    const settings = getSettings();
    const members = getMembers();
    const history = getMatchingHistory();
    const departments = getDepartments();

    // 管理者判定
    const adminEmails = getAdminEmails(settings);
    const isAdmin = userEmail && adminEmails.includes(userEmail.toLowerCase());

    // セキュリティ保護: 非管理者の場合はAPIキーを隠蔽する
    if (!isAdmin) {
      settings.gemini_api_key = settings.gemini_api_key ? "●●●●●●●●" : "";
    }

    const activeCount = members.filter(m => m.status === true).length;

    // ログイン中の本人の登録プロフィールを取得
    let myProfile = null;
    if (userEmail) {
      myProfile =
        members.find(m => m.email.toLowerCase() === userEmail.toLowerCase()) || null;
    }

    return {
      success: true,
      members: members,
      settings: settings,
      history: history,
      departments: departments,
      totalCount: members.length,
      activeCount: activeCount,
      hasApiKey:
        !!settings.gemini_api_key && settings.gemini_api_key !== "●●●●●●●●",
      isAdmin: !!isAdmin,
      currentUserEmail: userEmail || "",
      myProfile: myProfile,
    };
  } catch (e) {
    Logger.log(`getInitialData エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 部署一覧の取得
 */
function getDepartments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("部署マスタ");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data.map(row => ({
    id: row[0],
    name: row[1],
  }));
}


/**
 * メンバー一覧の取得
 */
function getMembers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("メンバー一覧");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const colCount = Math.max(lastCol, 8); // 8列目まで安全に取得
  const data = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
 
  return data.map(row => ({
    id: row[0],
    name: row[1],
    email: row[2],
    department: row[3],
    interests: row[4],
    considerations: row[5] || "", // 6列目の「配慮事項」
    status: row[6] === true || row[6] === "アクティブ", // 7列目の「ステータス」 (ブーリアン)
    priority: !!row[7], // 8列目の「次回優先」フラグ (真偽値)
  }));
}

/**
 * 設定情報の取得
 */
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("設定");
  if (!sheet) return {};

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const settings = {};

  data.forEach(row => {
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("設定");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("設定");
    }

    const lastRow = sheet.getLastRow();
    let keys = [];
    if (lastRow > 1) {
      keys = sheet
        .getRange(2, 1, lastRow - 1, 1)
        .getValues()
        .map(r => r[0]);
    }

    for (const key in settingsObj) {
      const val = settingsObj[key];

      // フロントエンドからマスク文字（●●●●●●●●）が送られてきた場合は、保存せずにスキップする（元の値を保持）
      // （※非管理者からのAPIキー隠蔽や、管理者画面でAPIキーを変更せずに保存した場合に誤ってマスク文字で上書き保存されるのを防ぐ）
      if (key === "gemini_api_key" && val === "●●●●●●●●") {
        continue;
      }

      const index = keys.indexOf(key);
      if (index !== -1) {
        sheet.getRange(index + 2, 2).setValue(val);
      } else {
        sheet.appendRow([key, val, ""]);
      }
    }

    // スプレッドシートへ確実に書き込みを同期させる
    SpreadsheetApp.flush();

    const updatedSettings = getSettings();

    // 自身が管理者かどうかでAPIキーの有無を正しく判定して返す
    const userEmail =
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail();
    const adminEmails = getAdminEmails(updatedSettings);
    const isAdmin = userEmail && adminEmails.includes(userEmail.toLowerCase());

    return {
      success: true,
      settings: updatedSettings,
      hasApiKey:
        !!updatedSettings.gemini_api_key &&
        updatedSettings.gemini_api_key !== "●●●●●●●●",
      isAdmin: isAdmin,
    };
  } catch (e) {
    Logger.log(`saveSettings エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング履歴の取得
 */
function getMatchingHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("マッチング履歴");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  return data
    .map(row => {
      const cleanMemo = cleanMatchingMemo(row[5]);
      const dateFormatted = row[0] instanceof Date
        ? Utilities.formatDate(row[0], "Asia/Tokyo", "yyyy-MM-dd")
        : row[0].toString();

      return {
        date: dateFormatted,
        groupId: row[1],
        memberIds: row[2].toString().split(",").map(s => s.trim()),
        memberNames: row[3].toString().split(",").map(s => s.trim()),
        method: row[4],
        memo: cleanMemo,
      };
    })
    .reverse();
}

/**
 * 新規メンバーの追加 (管理者のみ代理登録)
 */
function addMember(memberObj) {
  try {
    checkAdminPermission(); // 権限チェック
    return addMemberToSheet(memberObj);
  } catch (e) {
    Logger.log(`addMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

// 内部的なメンバー追加処理
function addMemberToSheet(memberObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("メンバー一覧");
  if (!sheet) {
    return { success: false, error: "メンバー一覧シートが見つかりません。" };
  }

  const newId = getNextId(sheet, "M", /^M(\d+)$/);

  const newRow = [
    newId,
    memberObj.name || "",
    memberObj.email || "",
    memberObj.department || "",
    memberObj.interests || "",
    memberObj.considerations || "",
    memberObj.status !== false,
    !!memberObj.priority,
  ];

  sheet.appendRow(newRow);

  // チェックボックスを挿入（7列目のステータス、8列目の次回優先）
  const targetRow = sheet.getLastRow();
  sheet
    .getRange(targetRow, 7)
    .insertCheckboxes()
    .setValue(memberObj.status !== false);
  sheet
    .getRange(targetRow, 8)
    .insertCheckboxes()
    .setValue(!!memberObj.priority);

  sheet.autoResizeColumns(1, 8);

  return {
    success: true,
    member: getMembers().find(m => m.id === newId),
  };
}

/**
 * メンバー情報の更新 (管理者のみ)
 */
function updateMember(memberObj) {
  try {
    checkAdminPermission(); // 権限チェック
    return updateMemberInSheet(memberObj);
  } catch (e) {
    Logger.log(`updateMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

// 内部的なメンバー更新処理
function updateMemberInSheet(memberObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("メンバー一覧");
  if (!sheet) {
    return { success: false, error: "メンバー一覧シートが見つかりません。" };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: false, error: "メンバーデータが存在しません。" };
  }

  const ids = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .map(r => r[0]);
  const rowIndex = ids.indexOf(memberObj.id);

  if (rowIndex === -1) {
    return {
      success: false,
      error: `メンバーIDが見つかりません。ID: ${memberObj.id}`,
    };
  }

  const rowNum = rowIndex + 2;
  const range = sheet.getRange(rowNum, 1, 1, 8); // 8列目まで更新
  range.setValues([
    [
      memberObj.id,
      memberObj.name || "",
      memberObj.email || "",
      memberObj.department || "",
      memberObj.interests || "",
      memberObj.considerations || "",
      memberObj.status !== false, // ステータス (ブーリアン)
      !!memberObj.priority,
    ],
  ]);

  return { success: true, member: memberObj };
}

/**
 * メンバーの削除 (管理者のみ)
 */
function deleteMember(memberId) {
  try {
    checkAdminPermission(); // 権限チェック

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const ids = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .map(r => r[0]);
    const rowIndex = ids.indexOf(memberId);

    if (rowIndex === -1) {
      return {
        success: false,
        error: `メンバーIDが見つかりません。ID: ${memberId}`,
      };
    }

    const rowNum = rowIndex + 2;
    sheet.deleteRow(rowNum);

    return { success: true, deletedId: memberId };
  } catch (e) {
    Logger.log(`deleteMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの参加ステータストグル (管理者のみ)
 */
function toggleMemberStatus(memberId) {
  try {
    checkAdminPermission(); // 権限チェック

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    let rowIndex = -1;
    let currentStatus = true;

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === memberId) {
        rowIndex = i;
        currentStatus = data[i][7] === true || data[i][7] === "アクティブ"; // 8列目(インデックス7)がステータス！
        break;
      }
    }

    if (rowIndex === -1) {
      return {
        success: false,
        error: `メンバーIDが見つかりません。ID: ${memberId}`,
      };
    }

    const nextStatus = !currentStatus;
    const rowNum = rowIndex + 2;
    sheet.getRange(rowNum, 8).setValue(nextStatus); // 8列目を更新！

    return { success: true, memberId: memberId, nextStatus: nextStatus };
  } catch (e) {
    Logger.log(`toggleMemberStatus エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの次回優先ステータストグル (管理者のみ)
 */
function toggleMemberPriority(memberId) {
  try {
    checkAdminPermission(); // 権限チェック

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    let rowIndex = -1;
    let currentPriority = false;

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === memberId) {
        rowIndex = i;
        currentPriority = !!data[i][8]; // 9列目(インデックス8)が次回優先フラグ！
        break;
      }
    }

    if (rowIndex === -1) {
      return {
        success: false,
        error: `メンバーIDが見つかりません。ID: ${memberId}`,
      };
    }

    const nextPriority = !currentPriority;
    const rowNum = rowIndex + 2;
    sheet.getRange(rowNum, 9).setValue(nextPriority); // 9列目を更新！

    return { success: true, memberId: memberId, nextPriority: nextPriority };
  } catch (e) {
    Logger.log(`toggleMemberPriority エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング結果履歴の確定・保存 (管理者のみ)
 */
function saveMatchingHistory(groups, matchingMethod) {
  try {
    checkAdminPermission(); // 権限チェック

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("マッチング履歴");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("マッチング履歴");
    }

    const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");

    // 今回マッチングされたメンバーIDを収集
    const matchedMemberIds = [];
    groups.forEach(group => {
      // members が空のグループはスキップ（フロントエンドで除外済みのはずだが念のため）
      if (!group.members || group.members.length === 0) return;

      const memberIds = group.members.map(m => m.id).join(",");
      const memberNames = group.members.map(m => m.name).join(", ");

      Logger.log(`saveMatchingHistory: グループ保存 groupId=${group.groupId} members=${memberIds}`);

      const cleanMemo = cleanMatchingMemo(group.memo);

      sheet.appendRow([
        todayStr,
        group.groupId,
        memberIds,
        memberNames,
        matchingMethod || "Gemini",
        cleanMemo,
      ]);

      group.members.forEach(m => {
        matchedMemberIds.push(m.id);
      });
    });

    // 書き込みを即時同期（次の読み込みに確実に反映させる）
    SpreadsheetApp.flush();

    sheet.autoResizeColumns(1, 6);

    // --- 優先フラグ（次回優先）の自動更新処理 ---
    const allMembers = getMembers();
    const activeMembers = allMembers.filter(m => m.status === true);

    const memberSheet = ss.getSheetByName("メンバー一覧");
    if (memberSheet) {
      const lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        const memberIdsInSheet = memberSheet
          .getRange(2, 1, lastRow - 1, 1)
          .getValues()
          .map(r => r[0]);
        const priorityRange = memberSheet.getRange(2, 9, lastRow - 1, 1);
        const priorities = priorityRange.getValues();

        for (let i = 0; i < memberIdsInSheet.length; i++) {
          const mId = memberIdsInSheet[i];

          if (matchedMemberIds.includes(mId)) {
            // 今回マッチングされた人は「次回優先」を解除
            priorities[i][0] = false;
          } else {
            // 今回マッチングされず、かつ「アクティブ」なメンバーは「次回優先」に設定
            const isActive = activeMembers.some(m => m.id === mId);
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

    // 各メンバーへのマッチング確定メール通知の送信
    try {
      sendMatchingEmails(groups, todayStr, matchingMethod);
    } catch (mailError) {
      Logger.log(`メール通知の送信処理でエラーが発生しました: ${mailError.toString()}`);
    }

    return { success: true };
  } catch (e) {
    Logger.log(`saveMatchingHistory エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 確定したマッチング結果を各グループメンバーにメールで通知する
 * @param {Array} groups 確定したグループ配列
 * @param {string} dateStr 開催日文字列
 * @param {string} matchingMethod マッチング方法 (gemini / logic)
 */
function sendMatchingEmails(groups, dateStr, matchingMethod) {
  const webAppUrl = getPortalUrl();

  groups.forEach(group => {
    const members = group.members;
    if (!members || members.length === 0) return;

    members.forEach(recipient => {
      if (!recipient.email) {
        Logger.log(`メールアドレスが登録されていないため送信をスキップ: ${recipient.name}`);
        return;
      }

      // 自分以外のメンバー一覧テキスト
      const otherMembers = members.filter(m => m.id !== recipient.id);
      const otherMembersText = otherMembers
        .map(m => `・${m.name} さん (${m.department || "部署未設定"})`)
        .join("\n");

      const subject = `【ランチ交流会】マッチング確定のお知らせ（${dateStr}）`;

      let body = `${recipient.name} さん

お疲れ様です。ランチ交流会事務局です。
次回ランチ交流会のマッチングが確定しましたのでお知らせいたします。

■ 開催予定日
${dateStr}

■ あなたのグループ（${group.groupId}）のメンバー
・${recipient.name} さん (${recipient.department || "部署未設定"} ・あなた)
${otherMembersText}

■ ランチ交流会について
部署の重なりなどを考慮して選出されたグループです。メンバーの皆様で調整の上、ぜひランチ交流会をお楽しみください！

`;

      if (webAppUrl) {
        body += `■ ポータル画面（チャット・プロフィール確認など）
${webAppUrl}

`;
      }

      body += `※ 本メールはシステムより自動送信されています。
何かご不明な点や不都合がございましたら、ランチ交流会事務局までご連絡ください。
`;

      try {
        GmailApp.sendEmail(recipient.email, subject, body, {
          name: "ランチ交流会事務局",
          noReply: true,
        });
        Logger.log(`メール送信成功: ${recipient.email}`);
      } catch (err) {
        Logger.log(`メール送信失敗: ${recipient.email} エラー: ${err.toString()}`);
      }
    });
  });
}

/**
 * Gemini API接続の疎通テスト用関数 (管理者のみ)
 */
function testGeminiConnection(apiKey) {
  try {
    checkAdminPermission(); // 権限チェック

    if (!apiKey) {
      return { success: false, error: "APIキーが入力されていません。" };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            {
              text: 'Hello, this is a test. Reply with one word "OK" if you hear me.',
            },
          ],
        },
      ],
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const json = JSON.parse(responseBody);
      const text = json.candidates[0].content.parts[0].text.trim();
      return { success: true, message: `接続テスト成功: ${text}` };
    } else {
      let errorJson;
      try {
        errorJson = JSON.parse(responseBody);
      } catch (ex) {}
      const errorMsg =
        errorJson && errorJson.error && errorJson.error.message
          ? errorJson.error.message
          : `ステータスコード ${responseCode}`;
      return { success: false, error: `APIエラー: ${errorMsg}` };
    }
  } catch (e) {
    return { success: false, error: `接続エラー: ${e.toString()}` };
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
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      return {
        success: false,
        error:
          "Googleアカウントにログインしていないか、メールアドレスが取得できません。ポータルのデプロイ設定をご確認ください。",
      };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("メンバー一覧");
    }

    const members = getMembers();
    const myProfile = members.find(m => m.email.toLowerCase() === userEmail.toLowerCase());

    let result;

    if (myProfile) {
      // 既存プロフィールの更新
      const updateObj = {
        id: myProfile.id,
        name: profileObj.name,
        email: userEmail, // メールアドレスは強制的に自分のものにする
        department: profileObj.department,
        interests: profileObj.interests || "",
        status: profileObj.status !== false,
        priority: myProfile.priority || false, // 優先フラグを引き継ぐ
        considerations: profileObj.considerations || "",
      };
      result = updateMemberInSheet(updateObj);
    } else {
      // 新規自己登録
      const addObj = {
        name: profileObj.name,
        email: userEmail, // メールアドレスは強制的に自分のものにする
        department: profileObj.department,
        interests: profileObj.interests || "",
        status: profileObj.status !== false,
        priority: false, // 新規登録時は優先ではない
        considerations: profileObj.considerations || "",
      };
      result = addMemberToSheet(addObj);
    }

    if (result.success) {
      return { success: true, myProfile: result.member };
    } else {
      return { success: false, error: result.error };
    }
  } catch (e) {
    Logger.log(`registerSelfProfile エラー: ${e.toString()}`);
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
    const adminEmails = getAdminEmails();
    if (adminEmails.includes(userEmail.toLowerCase())) {
      return true; // 管理者なので無条件でアクセス許可
    }
  } catch (e) {
    Logger.log(`checkRoomAccess内での管理者判定エラー: ${e.toString()}`);
  }

  // ルームIDから開催日とグループIDをパース (例: "2026-05-24_G-1" -> "2026-05-24", "G-1")
  const parts = roomId.split("_");
  if (parts.length < 2) return false;
  const dateStr = parts[0];
  const groupId = parts[1];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("マッチング履歴");
  if (!sheet) return false;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 指定した開催日＆グループIDのマッチング履歴行を探す
  let targetRow = null;
  for (let i = 0; i < data.length; i++) {
    const val = data[i][0];
    const rowDate =
      val instanceof Date
        ? Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd")
        : val.toString();
    const rowGroupId = data[i][1];
    if (rowDate === dateStr && rowGroupId === groupId) {
      targetRow = data[i];
      break;
    }
  }

  if (!targetRow) return false;

  // そのグループに所属するメンバーID一覧 (カンマ区切り)
  const memberIdsStr = targetRow[2] || "";
  const memberIds = memberIdsStr.split(",").map(id => id.trim());

  // ログインユーザーのメンバー情報を取得
  const members = getMembers();
  const currentUser = members.find(m => m.email.toLowerCase() === userEmail.toLowerCase());

  if (!currentUser) return false;

  // ログインユーザーのメンバーIDが、グループのメンバーリストに含まれているか判定
  return memberIds.includes(currentUser.id);
}

/**
 * チャットメッセージ履歴を取得する
 */
function getChatMessages(roomId) {
  try {
    const userEmail =
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail();
    if (!userEmail) {
      return {
        success: false,
        error: "Googleアカウントにログインしていません。",
      };
    }

    // アクセス権のチェック
    if (!checkRoomAccess(userEmail, roomId)) {
      return {
        success: false,
        error: "このチャットルームへのアクセス権限がありません。",
      };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("チャットメッセージ");
    if (!sheet) {
      return { success: true, messages: [] };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, messages: [] };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    const messages = [];

    data.forEach(row => {
      if (row[1] === roomId) {
        messages.push({
          id: row[0],
          roomId: row[1],
          senderId: row[2],
          senderName: row[3],
          senderEmail: row[4],
          department: row[5],
          message: row[6],
          timestamp: row[7],
        });
      }
    });

    // 送信日時でソート (古い順)
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    ret    // プロンプトに渡すためのデータをコンパクトに整理
    const membersData = members.map(m => ({
      id: m.id,
      name: m.name,
      dept: m.department,
      interests: m.interests,
      considerations: m.considerations || "",
    }));

    // 過去履歴のコンパクト化 (直近8回分程度で十分)
    const compactHistory = history.slice(0, 8).map(h => ({
      date: h.date,
      groups: h.memberIds,
    }));

    const systemInstruction = `あなたは優秀な社内交流ファシリテーターです。提示されたメンバーのリストから、ランチ交流会のグループ分けを決定してください。
【制約ルール】
1. グループ数は【厳密に ${groupCount} 組】（groupIdは "G-1" から "G-${groupCount}"）作成してください。提示されたメンバー全員（総勢 ${members.length} 名）を、いずれかのグループに漏れなく割り当ててください。
2. 1グループあたりの目標人数は ${groupSize} 名ですが、総人数が少ない場合は各グループが均等な人数（例：総数8名で3組なら、3名、3名、2名など、サイズ差が最大1以内）になるように美しく均してください。
3. 異なる部署・チームのメンバーが極力同じグループになるように「部署の多様性」を最優先してください。
4. 趣味、自己紹介などを考慮し、共通点がある人同士を組み合わせると会話が弾みやすいので、適度に「趣味・関心の合致」を考慮してください。
5. 過去のマッチング履歴（ compactHistory ）を確認し、直近で同じグループになった人同士ができるだけ被らないように配慮してください。
6. メンバーに「配慮事項 (considerations)」が記載されている場合は、アレルギーや苦手なもの、時間制限、その他の要望を極力尊重して、可能な限り配慮が満たされるような組み合わせを行ってください。ただし、アレルギー、苦手なもの、健康状態、時間制限、心理的安全性、その他の配慮事項に関する具体的な内容は、生成するAIコメント（memo）には絶対に含めないでください。
7. 出力フォーマットは指定された厳密なJSONスキーマのみとし、余計な説明文やMarkdownのコードブロック（\`\`\`json など）は含めず、純粋なJSON文字列として返してください。`;

    const prompt = `【メンバーリスト】
${JSON.stringify(membersData)}

【過去のマッチング履歴】
${JSON.stringify(compactHistory)}

【管理者からの追加指示】
${additionalPrompt ? additionalPrompt : "特になし"}

【期待する出力フォーマット(JSON)】
{
  "groups": [
    {
      "groupId": "G-1",
      "members": ["M001", "M002", "M003"],
      "memo": "（日本語で1〜2文）なぜこの組み合わせにしたのか、共通の話題やおすすめの雑談テーマなど。※注意：メンバーの配慮事項（健康、アレルギー、時間制限、心理的安全性など）に関する内容は絶対に含めないでください。"
    }
  ]
}

では、グループ分けを実行し、上記のJSONフォーマットに従って返答してください。`;

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      throw new Error(`Gemini API エラー (ステータス: ${responseCode}): ${responseBody}`);
    }

    const resultJson = JSON.parse(responseBody);
    const candidateText = resultJson.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(candidateText.trim());

    // 返却されたグループリストを加工して、実際のメンバーオブジェクト配列を紐付ける
    const mappedGroups = parsed.groups.map(g => {
      const actualMembers = g.members.map(mId => {
        return members.find(m => m.id === mId) || { id: mId, name: "不明", department: "不明", interests: "" };
      });
      return {
        groupId: g.groupId,
        members: actualMembers,
        memo: g.memo || "",
      };
    });

    return { success: true, groups: mappedGroups };
  } catch (e) {
    Logger.log(`runGeminiMatching エラー: ${e.toString()}`);
    // エラー時は自動で Engine B (Logic) にフォールバックする
    Logger.log("Engine A (Gemini) が失敗したため、Engine B (Logic) に自動フォールバックします...");
    const fallbackResult = runLogicMatching(members, history, groupSize, groupCount);
    return {
      success: true,
      method: "logic_fallback",
      groups: fallbackResult.groups,
    };
  }
}

/**
 * チャットメッセージを送信する
 */
function sendChatMessage(roomId, messageText) {
  try {
    const userEmail =
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail();
    if (!userEmail) {
      return {
        success: false,
        error: "Googleアカウントにログインしていません。",
      };
    }

    if (!messageText || messageText.trim() === "") {
      return { success: false, error: "メッセージ内容が空です。" };
    }

    // アクセス権のチェック
    if (!checkRoomAccess(userEmail, roomId)) {
      return {
        success: false,
        error: "このチャットルームへのアクセス権限がありません。",
      };
    }

    const members = getMembers();
    const currentUser = members.find(m => m.email.toLowerCase() === userEmail.toLowerCase());
    if (!currentUser) {
      return {
        success: false,
        error:
          "メンバーとして登録されていません。プロフィールを設定してください。",
      };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("チャットメッセージ");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("チャットメッセージ");
    }

    const newId = getNextId(sheet, "MSG", /^MSG(\d+)$/);
    const timestamp = new Date().toISOString();
    const newRow = [
      newId,
      roomId,
      currentUser.id,
      currentUser.name,
      currentUser.email,
      currentUser.department,
      messageText.trim(),
      timestamp,
    ];

    sheet.appendRow(newRow);
    SpreadsheetApp.flush(); // 即時同期

    // 新しいメッセージ一覧を取得して返す
    return getChatMessages(roomId);
  } catch (e) {
    Logger.log(`sendChatMessage エラー: ${e.toString()}`);
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // マッチング履歴シートのクリア
    const historySheet = ss.getSheetByName("マッチング履歴");
    if (historySheet && historySheet.getLastRow() > 1) {
      historySheet.deleteRows(2, historySheet.getLastRow() - 1);
    }

    // チャットメッセージシートのクリア
    const chatSheet = ss.getSheetByName("チャットメッセージ");
    if (chatSheet && chatSheet.getLastRow() > 1) {
      chatSheet.deleteRows(2, chatSheet.getLastRow() - 1);
    }

    // 全メンバーの「次回優先」フラグもリセット
    const memberSheet = ss.getSheetByName("メンバー一覧");
    if (memberSheet && memberSheet.getLastRow() > 1) {
      const lastRow = memberSheet.getLastRow();
      const priorityRange = memberSheet.getRange(2, 9, lastRow - 1, 1); // 9列目が「次回優先」列
      const priorities = priorityRange.getValues();
      for (let i = 0; i < priorities.length; i++) {
        priorities[i][0] = false;
      }
      priorityRange.setValues(priorities);
    }

    SpreadsheetApp.flush();

    return { success: true };
  } catch (e) {
    Logger.log(`clearMatchingHistory エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 特定のマッチンググループを履歴から削除する (管理者のみ)
 */
function deleteMatchingGroup(dateStr, groupId) {
  try {
    checkAdminPermission(); // 権限チェック

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("マッチング履歴");
    if (!sheet) {
      return {
        success: false,
        error: "マッチング履歴シートが見つかりません。",
      };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: "履歴が存在しません。" };

    const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    let rowIndexToDelete = -1;

    for (let i = 0; i < data.length; i++) {
      const rowDate =
        data[i][0] instanceof Date
          ? Utilities.formatDate(data[i][0], "Asia/Tokyo", "yyyy-MM-dd")
          : data[i][0].toString();
      const rowGroupId = data[i][1];

      if (rowDate === dateStr && rowGroupId === groupId) {
        rowIndexToDelete = i + 2; // ヘッダー分+1, 0-indexで+1 => i + 2
        break;
      }
    }

    if (rowIndexToDelete === -1) {
      return {
        success: false,
        error: `指定されたグループが見つかりません。日付: ${dateStr}, グループID: ${groupId}`,
      };
    }

    // 行の削除
    sheet.deleteRow(rowIndexToDelete);

    // チャットメッセージシートからも、該当ルームIDのチャットメッセージを削除してクリーンアップ
    const chatSheet = ss.getSheetByName("チャットメッセージ");
    if (chatSheet) {
      const chatLastRow = chatSheet.getLastRow();
      if (chatLastRow > 1) {
        const roomId = `${dateStr}_${groupId}`;
        const chatData = chatSheet.getRange(2, 2, chatLastRow - 1, 1).getValues();
        // 下から順に削除 (行番号がズレるのを防ぐため)
        for (let j = chatData.length - 1; j >= 0; j--) {
          if (chatData[j][0] === roomId) {
            chatSheet.deleteRow(j + 2);
          }
        }
      }
    }

    SpreadsheetApp.flush();
    return { success: true };
  } catch (e) {
    Logger.log(`deleteMatchingGroup エラー: ${e.toString()}`);
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

    const settings = getSettings();
    const groupSize = parseInt(
      params.groupSize || settings.default_group_size || 4,
      10
    );
    let groupCount = parseInt(
      params.groupCount || settings.default_group_count || 4,
      10
    );
    const mode = params.mode || "gemini";
    const additionalPrompt = params.additionalPrompt || "";

    // アクティブなメンバー一覧の取得
    const allMembers = getMembers();
    const activeMembers = allMembers.filter(m => m.status === true);

    if (activeMembers.length < 2) {
      return {
        success: false,
        error: "アクティブなメンバーが少なすぎます（最低2名必要です）。",
      };
    }

    // --- 優先参加 & あふれメンバー選出制御 ---
    const maxParticipants = groupSize * groupCount;
    let selectedMembers = [];
    let unmatchedMembers = [];

    // 優先メンバーと通常メンバーの分類 (同じ優先度内でもシャッフルして公平性を保つ)
    let priorityMembers = activeMembers.filter(m => !!m.priority);
    let regularMembers = activeMembers.filter(m => !m.priority);

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
      const neededCount = maxParticipants - selectedMembers.length;
      const additionals = regularMembers.slice(0, neededCount);
      selectedMembers = selectedMembers.concat(additionals);

      // 選ばれなかった通常メンバーはあふれて次回優先に回る
      unmatchedMembers = regularMembers.slice(neededCount);
    }

    // グループ数が選択されたメンバー数を超える場合は、空グループを防ぐためにクランプ
    if (selectedMembers.length < groupCount) {
      groupCount = selectedMembers.length;
    }

    // 過去のマッチング履歴の取得
    const history = getMatchingHistory();

    let result;
    let finalMethod = mode;
    const apiKey = settings.gemini_api_key;

    if (mode === "gemini") {
      if (!apiKey) {
        Logger.log(
          "APIキーが設定されていないため、独自プログラムロジックにフォールバックします。"
        );
        result = runLogicMatching(
          selectedMembers,
          history,
          groupSize,
          groupCount
        );
        finalMethod = "logic_fallback";
      } else {
        result = runGeminiMatching(
          selectedMembers,
          history,
          groupSize,
          groupCount,
          apiKey,
          additionalPrompt
        );
        if (!result.success) {
          Logger.log(
            `Gemini API呼び出しが失敗したため、独自プログラムロジックにフォールバックします。エラー: ${result.error}`
          );
          result = runLogicMatching(
            selectedMembers,
            history,
            groupSize,
            groupCount
          );
          finalMethod = "logic_fallback";
        }
      }
    } else {
      result = runLogicMatching(
        selectedMembers,
        history,
        groupSize,
        groupCount
      );
      finalMethod = "logic";
    }

    if (result && result.success && result.groups) {
      // グループIDを通算のユニークな連番にする (例: 前回がG-4までなら、今回はG-5から開始)
      let maxGroupIdNum = 0;
      history.forEach(h => {
        const match = h.groupId.match(/^G-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxGroupIdNum) {
            maxGroupIdNum = num;
          }
        }
      });

      result.groups.forEach((group, idx) => {
        group.groupId = `G-${maxGroupIdNum + idx + 1}`;
      });
    }

    return {
      success: true,
      method: finalMethod,
      groups: result.groups,
      unmatched: unmatchedMembers, // 今回選出枠からあふれたメンバー
    };
  } catch (e) {
    Logger.log(`runMatching エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * Engine A: Gemini API によるインテリジェントマッチング
 */
function runGeminiMatching(
  members,
  history,
  groupSize,
  groupCount,
  apiKey,
  additionalPrompt
) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    // プロンプトに渡すためのデータをコンパクトに整理
    const membersData = members.map(m => ({
      id: m.id,
      name: m.name,
      dept: m.department,
      interests: m.interests,
      considerations: m.considerations || "",
    }));

    // 過去履歴のコンパクト化 (直近8回分程度で十分)
    const compactHistory = history.slice(0, 8).map(h => ({
      date: h.date,
      groups: h.memberIds,
    }));

    const systemInstruction = `あなたは優秀な社内交流ファシリテーターです。提示されたメンバーのリストから、ランチ交流会のグループ分けを決定してください。
【制約ルール】
1. グループ数は【厳密に ${groupCount} 組】（groupIdは "G-1" から "G-${groupCount}"）作成してください。提示されたメンバー全員（総勢 ${members.length} 名）を、いずれかのグループに漏れなく割り当ててください。
2. 1グループあたりの目標人数は ${groupSize} 名ですが、総人数が少ない場合は各グループが均等な人数（例：総数8名で3組なら、3名、3名、2名など、サイズ差が最大1以内）になるように美しく均してください。
3. 異なる部署・チームのメンバーが極力同じグループになるように「部署の多様性」を最優先してください。
4. 趣味、自己紹介などを考慮し、共通点がある人同士を組み合わせると会話が弾みやすいので、適度に「趣味・関心の合致」を考慮してください。
5. 過去のマッチング履歴（ compactHistory ）を確認し、直近で同じグループになった人同士ができるだけ被らないように配慮してください。
6. メンバーに「配慮事項 (considerations)」が記載されている場合は、アレルギーや苦手なもの、時間制限、その他の要望を極力尊重して、可能な限り配慮が満たされるような組み合わせを行ってください。ただし、アレルギー、苦手なもの、健康状態、時間制限、心理的安全性、その他の配慮事項に関する具体的な内容は、生成するAIコメント（memo）には絶対に含めないでください。
7. 出力フォーマットは指定された厳密なJSONスキーマのみとし、余計な説明文やMarkdownのコードブロック（\`\`\`json など）は含めず、純粋なJSON文字列として返してください。`;

    const prompt = `【メンバーリスト】
${JSON.stringify(membersData)}

【過去のマッチング履歴】
${JSON.stringify(compactHistory)}

【管理者からの追加指示】
${additionalPrompt ? additionalPrompt : "特になし"}

【期待する出力フォーマット(JSON)】
{
  "groups": [
    {
      "groupId": "G-1",
      "members": ["M001", "M002", "M003"],
      "memo": "（日本語で1〜2文）なぜこの組み合わせにしたのか、共通の話題やおすすめの雑談テーマなど。※注意：メンバーの配慮事項（健康、アレルギー、時間制限、心理的安全性など）に関する内容は絶対に含めないでください。"
    }
  ]
}

では、グループ分けを実行し、上記のJSONフォーマットに従って返答してください。`;

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      return {
        success: false,
        error: `Gemini APIエラー: ステータスコード ${responseCode}\n${responseBody}`,
      };
    }

    const jsonResult = JSON.parse(responseBody);
    const generatedText = jsonResult.candidates[0].content.parts[0].text;

    // JSONのパース
    const parsedData = JSON.parse(generatedText.trim());

    if (!parsedData.groups || !Array.isArray(parsedData.groups)) {
      return {
        success: false,
        error: "Geminiの返却データ構造が正しくありません。",
      };
    }

    // IDから詳細なメンバー情報を復元してフロントに返す形にする
    const finalGroups = parsedData.groups.map((g, idx) => {
      const matchedMembers = g.members
        .map(id => members.find(m => m.id === id))
        .filter(Boolean); // nullやundefinedを除外

      return {
        groupId: `G-${idx + 1}`, // Geminiの出力ゆらぎに依存せず、連番のグループIDを強制適用する
        members: matchedMembers,
        memo: g.memo || "",
      };
    });

    return { success: true, groups: finalGroups };
  } catch (e) {
    Logger.log(`runGeminiMatching エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * Engine B: 独自プログラムロジックによるマッチング（山登り法）
 */
function runLogicMatching(members, history, targetSize, targetCount) {
  const totalMembers = members.length;

  // 1. グループ数の決定 (指定された組数を厳密に使用)
  const numGroups =
    targetCount || Math.max(1, Math.round(totalMembers / targetSize));

  // 実態に合わせた目標グループ人数（均等に均すための目標サイズ）
  const actualTargetSize = Math.ceil(totalMembers / numGroups);

  // 2. ペアごとの被りペナルティマップの構築
  const penaltyMap = {};

  // 履歴から被りカウントを計算
  history.forEach(h => {
    const ids = h.memberIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key1 = `${ids[i]}-${ids[j]}`;
        const key2 = `${ids[j]}-${ids[i]}`;
        penaltyMap[key1] = (penaltyMap[key1] || 0) + 1;
        penaltyMap[key2] = (penaltyMap[key2] || 0) + 1;
      }
    }
  });

  // メンバーIDリストのシャッフル
  let shuffledIds = members.map(m => m.id);
  shuffledIds = arrayShuffle(shuffledIds);

  // 初期グループ割り当て
  const groups = Array.from({ length: numGroups }, () => []);

  for (let i = 0; i < shuffledIds.length; i++) {
    groups[i % numGroups].push(shuffledIds[i]);
  }

  // スコア計算関数（低いほど良い）
  function calculateTotalPenalty(currentGroups) {
    let totalPenalty = 0;

    currentGroups.forEach(group => {
      for (let i = 0; i < group.length; i++) {
        const m1 = members.find(m => m.id === group[i]);
        if (!m1) continue;

        for (let j = i + 1; j < group.length; j++) {
          const m2 = members.find(m => m.id === group[j]);
          if (!m2) continue;

          // 1) 過去の被りペナルティ (1回被るごとに +100点)
          const key = `${m1.id}-${m2.id}`;
          const historyCount = penaltyMap[key] || 0;
          totalPenalty += historyCount * 100;

          // 2) 同一部署ペナルティ (同一部署なら +40点)
          if (m1.department === m2.department) {
            totalPenalty += 40;
          }

          // 3) 趣味の簡易的な共通点ボーナス (趣味の文字列の中に共通の名詞等があれば -10点)
          const interests1 = m1.interests || "";
          const interests2 = m2.interests || "";
          const commonWord = findCommonWord(interests1, interests2);
          if (commonWord) {
            totalPenalty -= 10;
          }
        }
      }

      // グループ内の人数の偏りペナルティ (実態目標サイズから離れるほどペナルティ)
      const sizeDiff = Math.abs(group.length - actualTargetSize);
      totalPenalty += sizeDiff * 20;
    });

    return totalPenalty;
  }

  // 山登り法による最適化ループ (2500回試行)
  let currentScore = calculateTotalPenalty(groups);
  const maxIterations = 2500;

  for (let iter = 0; iter < maxIterations; iter++) {
    // ランダムに2つのグループを選択
    const g1Idx = Math.floor(Math.random() * numGroups);
    const g2Idx = Math.floor(Math.random() * numGroups);

    if (
      g1Idx === g2Idx ||
      groups[g1Idx].length === 0 ||
      groups[g2Idx].length === 0
    ) {
      continue;
    }

    // それぞれのグループからランダムに1人ずつ選択してスワップ
    const p1Idx = Math.floor(Math.random() * groups[g1Idx].length);
    const p2Idx = Math.floor(Math.random() * groups[g2Idx].length);

    // スワップ
    const temp = groups[g1Idx][p1Idx];
    groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
    groups[g2Idx][p2Idx] = temp;

    // 新しいスコアの計算
    const newScore = calculateTotalPenalty(groups);

    if (newScore < currentScore) {
      // 改善されたので確定
      currentScore = newScore;
    } else {
      // 悪化したのでスワップを元に戻す
      const tempBack = groups[g1Idx][p1Idx];
      groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
      groups[g2Idx][p2Idx] = tempBack;
    }
  }

  // 3. 結果の整形
  const finalGroups = groups.map((grpIds, idx) => {
    const matchedMembers = grpIds
      .map(id => members.find(m => m.id === id))
      .filter(Boolean);

    // グループ内の同一部署の割合を計算し、メモを自動生成
    const depts = matchedMembers.map(m => m.department);
    const uniqueDepts = depts.filter((v, i, self) => self.indexOf(v) === i);

    let memo = "過去の履歴を考慮し、重複を極力回避して最適化しました。";
    if (uniqueDepts.length === matchedMembers.length) {
      memo += `全員が異なる部署（${uniqueDepts.join(", ")}）から選出された多様性重視のグループです。`;
    } else {
      memo += `一部同部署が含まれますが、過去の被り回数を最小限に抑えています。部署：${depts.join("、")}。`;
    }

    return {
      groupId: `G-${idx + 1}`,
      members: matchedMembers,
      memo: memo,
    };
  });

  return { success: true, groups: finalGroups };
}

/**
 * 配列をシャッフルするヘルパー関数
 */
function arrayShuffle(array) {
  let currentIndex = array.length;
  while (currentIndex !== 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    // 分割代入によるスワップ
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

/**
 * 簡易的な趣味の共通キーワード検出（サウナ、ゲーム、読書、カメラ、キャンプなど）
 */
function findCommonWord(str1, str2) {
  if (!str1 || !str2) return null;
  const keywords = [
    "サウナ",
    "カフェ",
    "ゴルフ",
    "テニス",
    "旅行",
    "キャンプ",
    "料理",
    "カレー",
    "読書",
    "映画",
    "ゲーム",
    "デザイン",
    "カメラ",
    "コーヒー",
    "ピラティス",
    "ヨガ",
    "筋トレ",
  ];
  for (const kw of keywords) {
    if (str1.includes(kw) && str2.includes(kw)) {
      return kw;
    }
  }
  return null;
}

function triggerAuth() {
  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    "認証テスト",
    "Gmail送信権限を有効化します。"
  );
}

// -------------------------------------------------------------
// リファクタリングによる新設共通ヘルパー関数
// -------------------------------------------------------------

/**
 * 管理者のメールアドレス一覧を設定シートの情報から配列として取得する
 * @param {Object} [settings] - 既存の設定オブジェクト（省略時は再取得）
 * @returns {Array<string>} 管理者メールアドレス（小文字）の配列
 */
function getAdminEmails(settings) {
  const currentSettings = settings || getSettings();
  const adminEmailsStr = currentSettings.admin_emails || "";
  return adminEmailsStr.split(",").map(e => e.trim().toLowerCase());
}

/**
 * 表示・保存用のメモからシステム用のタグ情報をきれいに除去する
 * @param {string} memo - 元のメモ文字列
 * @returns {string} タグがクリーンアップされたメモ文字列
 */
function cleanMatchingMemo(memo) {
  if (!memo) return "";
  return memo.toString()
    .replace(/【手動微調整あり】/g, "")
    .replace(/【独自ロジック選出】/g, "")
    .replace(/\[手動微調整あり\]/g, "")
    .replace(/\[独自ロジック選出\]/g, "")
    .trim();
}

/**
 * スプレッドシートの指定列の最大採番番号から、次の連番IDを自動生成する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 対象のシートオブジェクト
 * @param {string} prefix - IDの接頭辞（"M"や"MSG"など）
 * @param {RegExp} regexPattern - 数値部分をキャプチャする正規表現
 * @returns {string} 生成された次のID（例: "M017", "MSG004"）
 */
function getNextId(sheet, prefix, regexPattern) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return `${prefix}001`;
  }
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  let maxNum = 0;
  ids.forEach(id => {
    const match = id.toString().match(regexPattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  return `${prefix}${("000" + (maxNum + 1)).slice(-3)}`;
}
