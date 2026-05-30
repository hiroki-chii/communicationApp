/**
 * 社内ランチ交流会マッチングシステム - メインサーバーロジック
 */

/**
 * Web Appへのアクセス時にHTMLを出力する。
 * 起動時に自動でスプレッドシートの初期化を行う（シートが存在しない場合のみ作成）。
 * 
 * @param {Object} e イベントオブジェクト
 * @return {HtmlOutput} HTML出力オブジェクト
 */
function doGet(e) {
  initDatabase();

  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("社内ランチ交流会 - マッチングポータル")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * スプレッドシートが開かれたときに、カスタムメニューを追加する。
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("ランチ交流会")
    .addItem("管理者画面の初期化/デモデータ挿入", "initDatabase")
    .addItem("ポータル画面のURLを表示", "showWebAppUrl")
    .addToUi();
}

/**
 * ログイン中または有効なユーザーのメールアドレスを取得する。
 * 
 * @return {string} ユーザーのメールアドレス
 */
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || "";
}

/**
 * 管理者のメールアドレス一覧を設定から取得する。
 * 
 * @param {Object} [settings] 事前に取得した設定オブジェクト（省略時は自動取得）
 * @return {string[]} 管理者メールアドレスの配列（小文字統一）
 */
function getAdminEmails(settings) {
  const currentSettings = settings || getSettings();
  const adminEmailsStr = currentSettings.admin_emails || "";
  return adminEmailsStr.split(",").map(e => e.trim().toLowerCase());
}

/**
 * 指定されたメールアドレスが管理者権限を持っているか判定する。
 * 
 * @param {string} email 判定対象のメールアドレス
 * @param {Object} [settings] 事前に取得した設定オブジェクト
 * @return {boolean} 管理者である場合はtrue
 */
function isAdminUser(email, settings) {
  if (!email) return false;
  const adminEmails = getAdminEmails(settings);
  return adminEmails.includes(email.toLowerCase());
}

/**
 * 管理者権限の有無をチェックし、権限がない場合はエラーをスローする。
 * 
 * @return {boolean} 管理者権限がある場合はtrue
 */
function checkAdminPermission() {
  const userEmail = getCurrentUserEmail();
  if (!userEmail) {
    throw new Error("Googleアカウントにログインしていないか、メールアドレスの取得権限がありません。ポータルのデプロイ設定をご確認ください。");
  }

  if (!isAdminUser(userEmail)) {
    throw new Error(`管理者権限がありません。アカウント: ${userEmail}`);
  }
  return true;
}

/**
 * Webポータル画面のURLを取得する。
 * 設定シートに `webapp_url` があればそれを優先し、無ければ自動取得する。
 * 
 * @return {string} Web AppのURL
 */
function getPortalUrl() {
  try {
    const settings = getSettings();
    if (settings.webapp_url && settings.webapp_url.trim() !== "") {
      return settings.webapp_url.trim();
    }
  } catch (e) {
    Logger.log(`getPortalUrl 設定取得エラー: ${e.toString()}`);
  }

  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    Logger.log(`Web App URLの自動取得に失敗しました: ${e.toString()}`);
    return "";
  }
}

/**
 * Web Appの公開URLをポップアップモーダルで表示する。
 */
function showWebAppUrl() {
  const url = getPortalUrl();
  const ui = SpreadsheetApp.getUi();
  
  if (url) {
    const htmlOutput = HtmlService.createHtmlOutput(
      `<p>以下のURLからマッチングポータル（ユーザー/管理者画面）にアクセスできます：</p>
       <p><a href="${url}" target="_blank" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">ポータルを開く</a></p>`
    )
      .setWidth(400)
      .setHeight(150);
    ui.showModalDialog(htmlOutput, "ポータル画面のURL");
  } else {
    ui.alert("Webアプリケーションとしてデプロイされていないか、URLが設定されていません。「設定」シートに webapp_url を手動で設定するか、デプロイを行ってください。");
  }
}

/**
 * スプレッドシートデータベース（各シートおよびデモデータ）の自動初期化・マイグレーション。
 */
function initDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("アクティブなスプレッドシートが見つかりません。");
    return;
  }

  const activeEmail = getCurrentUserEmail();

  // 1. 「設定」シートの初期化
  let setupSheet = ss.getSheetByName("設定");
  if (!setupSheet) {
    setupSheet = ss.insertSheet("設定");
    setupSheet.appendRow(["設定キー", "設定値", "説明"]);
    const defaultSettings = [
      ["admin_emails", activeEmail, "管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）"],
      ["gemini_api_key", "", "Google AI Studioから取得したGemini APIキー。空の場合は独自ロジックで動作します。"],
      ["matching_mode", "gemini", 'マッチングモード ("gemini" または "logic")'],
      ["default_group_size", "4", "1グループあたりの基本目標人数"],
      ["default_group_count", "4", "標準の目標グループ数（組数）"],
      ["additional_prompt", "部署ができるだけ被らないようにしてください。共通の趣味がある人を同じグループに混ぜると盛り上がるので考慮してください。", "Geminiへの追加指示プロンプト"],
      ["webapp_url", "", "Webポータル画面の公開URL（未入力の場合は自動取得のURLを使用します。/dev を指定したい場合は手動で入力してください）"]
    ];
    defaultSettings.forEach(row => setupSheet.appendRow(row));

    // スタイル調整
    setupSheet.getRange("A1:C1").setBackground("#f1f5f9").setFontWeight("bold");
    setupSheet.autoResizeColumns(1, 3);
  } else {
    // 既存の設定シートに対して、不足しているキーがあれば補完する
    const lastRow = setupSheet.getLastRow();
    const keys = lastRow > 1 ? setupSheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]) : [];

    const appendMissingKey = (key, defaultValue, description) => {
      if (!keys.includes(key)) {
        setupSheet.appendRow([key, defaultValue, description]);
      }
    };

    appendMissingKey("admin_emails", activeEmail, "管理者権限を持つGoogle Workspaceアカウントのメールアドレス（カンマ区切りで複数登録可能）");
    appendMissingKey("default_group_count", "4", "標準の目標グループ数（組数）");
    appendMissingKey("webapp_url", "", "Webポータル画面の公開URL（未入力の場合は自動取得のURLを使用します。/dev を指定したい場合は手動で入力してください）");
  }

  // 2. 「部署マスタ」シートの初期化（「その他」はUI専用項目のためマスタには持たない）
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
      ["D006", "印刷統括部"]
    ];
    initialDepts.forEach(row => deptSheet.appendRow(row));

    // スタイル調整
    deptSheet.getRange("A1:B1").setBackground("#f1f5f9").setFontWeight("bold");
    deptSheet.autoResizeColumns(1, 2);
  }

  // 3. 「メンバー一覧」シートの初期化とマイグレーション
  let memberSheet = ss.getSheetByName("メンバー一覧");
  let isNewMemberSheet = false;
  
  if (!memberSheet) {
    memberSheet = ss.insertSheet("メンバー一覧");
    memberSheet.appendRow([
      "メンバーID",
      "名前",
      "メールアドレス",
      "部署・チーム",
      "趣味",
      "配慮事項",
      "ステータス",
      "次回優先",
    ]);
    memberSheet.getRange("A1:H1").setBackground("#f1f5f9").setFontWeight("bold");
    isNewMemberSheet = true;
  } else {
    // 既存シートのヘッダー取得とマイグレーション
    let headers = memberSheet.getRange(1, 1, 1, Math.max(memberSheet.getLastColumn(), 8)).getValues()[0];

    // 旧趣味ヘッダー（「趣味・自己紹介・興味のあること」「趣味・自己紹介」等）の自動移行
    const legacyHobbyHeaders = ["趣味・自己紹介・興味のあること", "趣味・自己紹介"];
    let headerUpdated = false;
    legacyHobbyHeaders.forEach(oldHeader => {
      const idx = headers.indexOf(oldHeader);
      if (idx !== -1) {
        memberSheet.getRange(1, idx + 1).setValue("趣味");
        headerUpdated = true;
      }
    });

    if (headerUpdated) {
      headers = memberSheet.getRange(1, 1, 1, Math.max(memberSheet.getLastColumn(), 8)).getValues()[0];
    }

    // 「参加目的」列の自動削除
    const purposeColIdx = headers.indexOf("参加目的");
    if (purposeColIdx !== -1) {
      memberSheet.deleteColumn(purposeColIdx + 1);
      headers = memberSheet.getRange(1, 1, 1, Math.max(memberSheet.getLastColumn(), 8)).getValues()[0];
    }

    // 「次回優先」列（8列目: H列）の補完
    const priorityIndex = headers.indexOf("次回優先");
    if (priorityIndex === -1) {
      memberSheet.getRange(1, 8).setValue("次回優先");
      memberSheet.getRange("H1").setBackground("#f1f5f9").setFontWeight("bold");
      const lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        const checkboxRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
        checkboxRange.insertCheckboxes().setValue(false);
      }
      headers = memberSheet.getRange(1, 1, 1, memberSheet.getLastColumn()).getValues()[0];
    }

    // 「配慮事項」列（6列目: F列）の位置自動調整
    const considerationsIndex = headers.indexOf("配慮事項");
    if (considerationsIndex === -1) {
      memberSheet.insertColumnAfter(5); // E列の後ろに空列を挿入
      memberSheet.getRange(1, 6).setValue("配慮事項");
      memberSheet.getRange("F1").setBackground("#f1f5f9").setFontWeight("bold");
    } else if (considerationsIndex !== 5) {
      memberSheet.insertColumnAfter(5); // 正しい位置へ退避用の空列を挿入
      headers = memberSheet.getRange(1, 1, 1, memberSheet.getLastColumn()).getValues()[0];
      const oldColIdx = headers.indexOf("配慮事項") + 1;

      const lastRow = memberSheet.getLastRow();
      if (lastRow > 1) {
        const oldRange = memberSheet.getRange(2, oldColIdx, lastRow - 1, 1);
        const newRange = memberSheet.getRange(2, 6, lastRow - 1, 1);
        oldRange.copyTo(newRange);
      }

      memberSheet.getRange(1, 6).setValue("配慮事項");
      memberSheet.getRange("F1").setBackground("#f1f5f9").setFontWeight("bold");
      memberSheet.deleteColumn(oldColIdx); // 旧列の物理削除
    }
  }

  // ステータス列（7列目: G列）のブーリアン移行とチェックボックスマイグレーション
  if (memberSheet) {
    const lastRow = memberSheet.getLastRow();
    if (lastRow > 1) {
      const statusRange = memberSheet.getRange(2, 7, lastRow - 1, 1);
      const statusValues = statusRange.getValues();
      let dataChanged = false;
      
      for (let i = 0; i < statusValues.length; i++) {
        const val = statusValues[i][0];
        if (typeof val === "boolean") continue; // すでにブーリアン変換済みの場合は無視
        
        if (val === "アクティブ" || val === "TRUE" || val === "true") {
          statusValues[i][0] = true;
          dataChanged = true;
        } else if (val === "非アクティブ" || val === "FALSE" || val === "false" || val === "") {
          statusValues[i][0] = false;
          dataChanged = true;
        }
      }
      
      if (dataChanged) {
        statusRange.setValues(statusValues);
      }
      statusRange.insertCheckboxes();
    }
  }

  // デモデータの自動挿入（シートが新規作成されたか空の場合）
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
      ["M016", "斎藤翼", "saito.t@example.com", "開発部", "自動テスト、バグハント。趣味はランニングと麻雀です。", "", true, false],
    ];

    demoMembers.forEach(member => memberSheet.appendRow(member));

    // チェックボックスの確実な挿入
    const lastRow = memberSheet.getLastRow();
    if (lastRow > 1) {
      memberSheet.getRange(2, 7, lastRow - 1, 1).insertCheckboxes();
      memberSheet.getRange(2, 8, lastRow - 1, 1).insertCheckboxes();
    }
    memberSheet.autoResizeColumns(1, 8);
  }

  // 4. 「マッチング履歴」シートの初期化
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
    historySheet.getRange("A1:F1").setBackground("#f1f5f9").setFontWeight("bold");

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

  // 5. 「チャットメッセージ」シートの初期化
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
      new Date(now.getTime() - 3600000).toISOString(),
    ]);
    chatSheet.appendRow([
      "MSG002",
      demoRoomId,
      "M003",
      "鈴木 健一",
      "suzuki.k@example.com",
      "開発部",
      "鈴木です！よろしくお願いします。僕はコーヒーの自家焙煎が趣味なので、コーヒーについて語りましょう！",
      new Date(now.getTime() - 1800000).toISOString(),
    ]);
    chatSheet.appendRow([
      "MSG003",
      demoRoomId,
      "M007",
      "伊藤 淳",
      "ito.j@example.com",
      "開発部",
      "デザイナーの伊藤です。よろしくお願いします！僕もサウナ大好きなので、おすすめのサウナ施設についてお話ししたいです！",
      new Date(now.getTime() - 600000).toISOString(),
    ]);

    chatSheet.autoResizeColumns(1, 8);
  }
}

/**
 * ポータルの起動に必要な初期データをまとめて取得する。
 * セキュリティ保護のため、非管理者に対してはAPIキーの文字をマスクする。
 * 
 * @return {Object} 初期データオブジェクト
 */
function getInitialData() {
  try {
    const userEmail = getCurrentUserEmail();
    const settings = getSettings();
    const members = getMembers();
    const history = getMatchingHistory();
    const departments = getDepartments();

    // 管理者判定
    const isAdmin = isAdminUser(userEmail, settings);

    // APIキーのセキュリティ保護
    if (!isAdmin) {
      settings.gemini_api_key = settings.gemini_api_key ? "●●●●●●●●" : "";
    }

    const activeCount = members.filter(m => m.status === true).length;
    const myProfile = userEmail ? members.find(m => m.email.toLowerCase() === userEmail.toLowerCase()) || null : null;

    return {
      success: true,
      members,
      settings,
      history,
      departments,
      totalCount: members.length,
      activeCount,
      hasApiKey: !!settings.gemini_api_key && settings.gemini_api_key !== "●●●●●●●●",
      isAdmin,
      currentUserEmail: userEmail,
      myProfile,
    };
  } catch (e) {
    Logger.log(`getInitialData エラー: ${e.toString()}`);
    return { success: false, error: "データの同期に失敗しました。" };
  }
}

/**
 * 部署一覧を「部署マスタ」シートから取得する。
 * 
 * @return {Object[]} 部署オブジェクトの配列（id, name）
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
 * 新しい部署を追加する (管理者専用)。
 * 重複チェックと自動ID採番を行う。
 * 
 * @param {string} deptName 追加する部署名
 * @return {Object} 処理結果オブジェクト
 */
function addDepartment(deptName) {
  try {
    checkAdminPermission();

    if (!deptName || deptName.trim() === "") {
      return { success: false, error: "部署名が入力されていません。部署名を入力してください。" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("部署マスタ");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("部署マスタ");
    }

    // 重複チェック
    const departments = getDepartments();
    const isDuplicate = departments.some(d => d.name === deptName.trim());
    if (isDuplicate) {
      return { success: false, error: "その部署名は既に登録されています。別の名前を入力してください。" };
    }

    // 次のID採番（D001, D002...）
    const newId = getNextId(sheet, "D", /^D(\d+)$/);
    sheet.appendRow([newId, deptName.trim()]);
    SpreadsheetApp.flush();

    return {
      success: true,
      department: { id: newId, name: deptName.trim() },
      departments: getDepartments()
    };
  } catch (e) {
    Logger.log(`addDepartment エラー: ${e.toString()}`);
    return { success: false, error: "部署の追加処理中にエラーが発生しました。" };
  }
}

/**
 * 部署を削除する (管理者専用)。
 * 
 * @param {string} deptId 削除対象の部署ID
 * @return {Object} 処理結果オブジェクト
 */
function deleteDepartment(deptId) {
  try {
    checkAdminPermission();

    if (!deptId) {
      return { success: false, error: "部署IDが指定されていません。" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("部署マスタ");
    if (!sheet) {
      return { success: false, error: "部署マスタシートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "削除できる部署データが存在しません。" };
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
    const rowIndex = ids.indexOf(deptId);

    if (rowIndex === -1) {
      return { success: false, error: "指定された部署IDが見つかりませんでした。" };
    }

    sheet.deleteRow(rowIndex + 2);
    SpreadsheetApp.flush();

    return {
      success: true,
      deletedId: deptId,
      departments: getDepartments()
    };
  } catch (e) {
    Logger.log(`deleteDepartment エラー: ${e.toString()}`);
    return { success: false, error: "部署の削除処理中にエラーが発生しました。" };
  }
}

/**
 * メンバー一覧を「メンバー一覧」シートから取得する。
 * カラムインデックス: 7列目(G列)=ステータス, 8列目(H列)=次回優先。
 * 
 * @return {Object[]} メンバーオブジェクトの配列
 */
function getMembers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("メンバー一覧");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const colCount = Math.max(lastCol, 8); // 8列目（次回優先）まで安全に取得する
  const data = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
 
  return data.map(row => ({
    id: row[0],
    name: row[1],
    email: row[2],
    department: row[3],
    interests: row[4],
    considerations: row[5] || "",
    status: row[6] === true || row[6] === "アクティブ", // 7列目 (G列)
    priority: !!row[7], // 8列目 (H列)
  }));
}

/**
 * 設定情報を「設定」シートからキー・値のマップ形式で取得する。
 * 
 * @return {Object} 設定キーと値のマップ
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
 * 設定情報を「設定」シートに一括保存する (管理者専用)。
 * マスクされたAPIキーが渡された場合は、既存キーを上書きしない。
 * 
 * @param {Object} settingsObj 保存対象の設定マップ
 * @return {Object} 処理結果オブジェクト
 */
function saveSettings(settingsObj) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("設定");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("設定");
    }

    const lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]) : [];

    for (const key in settingsObj) {
      const val = settingsObj[key];
      if (key === "gemini_api_key" && val === "●●●●●●●●") {
        continue; // マスク値が送られてきた場合は保存をスキップする
      }

      const index = keys.indexOf(key);
      if (index !== -1) {
        sheet.getRange(index + 2, 2).setValue(val);
      } else {
        sheet.appendRow([key, val, ""]);
      }
    }

    SpreadsheetApp.flush();

    const updatedSettings = getSettings();
    const userEmail = getCurrentUserEmail();
    const isAdmin = isAdminUser(userEmail, updatedSettings);

    return {
      success: true,
      settings: updatedSettings,
      hasApiKey: !!updatedSettings.gemini_api_key && updatedSettings.gemini_api_key !== "●●●●●●●●",
      isAdmin,
    };
  } catch (e) {
    Logger.log(`saveSettings エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング履歴を「マッチング履歴」シートから取得し、降順（新しい日付順）で返す。
 * メモ欄からシステム表示タグを除去する。
 * 
 * @return {Object[]} マッチング履歴オブジェクトの配列
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
 * 代理で新規メンバーを追加する (管理者専用)。
 * 
 * @param {Object} memberObj 追加するメンバー情報
 * @return {Object} 処理結果オブジェクト
 */
function addMember(memberObj) {
  try {
    checkAdminPermission();
    return addMemberToSheet(memberObj);
  } catch (e) {
    Logger.log(`addMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバー一覧シートにメンバー行を実際に追加する。
 * 
 * @param {Object} memberObj 追加するメンバー情報
 * @return {Object} 処理結果オブジェクト
 */
function addMemberToSheet(memberObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("メンバー一覧");
  if (!sheet) {
    return { success: false, error: "メンバー一覧シートが見つかりません。" };
  }

  const newId = getNextId(sheet, "M", /^M(\d+)$/);
  const statusVal = memberObj.status !== false;
  const priorityVal = !!memberObj.priority;

  const newRow = [
    newId,
    memberObj.name || "",
    memberObj.email || "",
    memberObj.department || "",
    memberObj.interests || "",
    memberObj.considerations || "",
    statusVal,   // 7列目
    priorityVal, // 8列目
  ];

  sheet.appendRow(newRow);

  // チェックボックスを正しく挿入して値を同期
  const targetRow = sheet.getLastRow();
  sheet.getRange(targetRow, 7).insertCheckboxes().setValue(statusVal);
  sheet.getRange(targetRow, 8).insertCheckboxes().setValue(priorityVal);

  sheet.autoResizeColumns(1, 8);

  return {
    success: true,
    member: getMembers().find(m => m.id === newId),
  };
}

/**
 * メンバー情報を更新する (管理者専用)。
 * 
 * @param {Object} memberObj 更新するメンバー情報
 * @return {Object} 処理結果オブジェクト
 */
function updateMember(memberObj) {
  try {
    checkAdminPermission();
    return updateMemberInSheet(memberObj);
  } catch (e) {
    Logger.log(`updateMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバー一覧シートの特定メンバー情報を上書き更新する。
 * 
 * @param {Object} memberObj 更新するメンバー情報
 * @return {Object} 処理結果オブジェクト
 */
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

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  const rowIndex = ids.indexOf(memberObj.id);

  if (rowIndex === -1) {
    return { success: false, error: `メンバーIDが見つかりません。ID: ${memberObj.id}` };
  }

  const rowNum = rowIndex + 2;
  const range = sheet.getRange(rowNum, 1, 1, 8); // 8列目まで更新
  range.setValues([[
    memberObj.id,
    memberObj.name || "",
    memberObj.email || "",
    memberObj.department || "",
    memberObj.interests || "",
    memberObj.considerations || "",
    memberObj.status !== false, // ステータス（7列目: G列）
    !!memberObj.priority,       // 次回優先（8列目: H列）
  ]]);

  return { success: true, member: memberObj };
}

/**
 * メンバーを削除する (管理者専用)。
 * 
 * @param {string} memberId 削除するメンバーID
 * @return {Object} 処理結果オブジェクト
 */
function deleteMember(memberId) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
    const rowIndex = ids.indexOf(memberId);

    if (rowIndex === -1) {
      return { success: false, error: `メンバーIDが見つかりません。ID: ${memberId}` };
    }

    sheet.deleteRow(rowIndex + 2);
    return { success: true, deletedId: memberId };
  } catch (e) {
    Logger.log(`deleteMember エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの参加ステータス（G列/7列目）を反転トグルする (管理者専用)。
 * 
 * @param {string} memberId メンバーID
 * @return {Object} 処理結果オブジェクト
 */
function toggleMemberStatus(memberId) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
    const rowIndex = ids.indexOf(memberId);

    if (rowIndex === -1) {
      return { success: false, error: `メンバーIDが見つかりません。ID: ${memberId}` };
    }

    const cell = sheet.getRange(rowIndex + 2, 7); // G列 (7列目)
    const currentStatus = cell.getValue() === true;
    const nextStatus = !currentStatus;
    cell.setValue(nextStatus);

    return { success: true, memberId, nextStatus };
  } catch (e) {
    Logger.log(`toggleMemberStatus エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * メンバーの次回優先ステータス（H列/8列目）を反転トグルする (管理者専用)。
 * 
 * @param {string} memberId メンバーID
 * @return {Object} 処理結果オブジェクト
 */
function toggleMemberPriority(memberId) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("メンバー一覧");
    if (!sheet) {
      return { success: false, error: "メンバー一覧シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: "メンバーデータが存在しません。" };
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
    const rowIndex = ids.indexOf(memberId);

    if (rowIndex === -1) {
      return { success: false, error: `メンバーIDが見つかりません。ID: ${memberId}` };
    }

    const cell = sheet.getRange(rowIndex + 2, 8); // H列 (8列目)
    const currentPriority = cell.getValue() === true;
    const nextPriority = !currentPriority;
    cell.setValue(nextPriority);

    return { success: true, memberId, nextPriority };
  } catch (e) {
    Logger.log(`toggleMemberPriority エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * マッチング結果履歴の確定保存と次回優先フラグの自動同期 (管理者専用)。
 * マッチングに選ばれたメンバーは次回優先フラグを解除し、漏れたアクティブなメンバーは次回優先に設定する。
 * 
 * @param {Object[]} groups マッチンググループの配列
 * @param {string} matchingMethod マッチング方式の文字列
 * @return {Object} 処理結果オブジェクト
 */
function saveMatchingHistory(groups, matchingMethod) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("マッチング履歴");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("マッチング履歴");
    }

    const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    const matchedMemberIds = [];

    // 各グループの履歴レコードを挿入
    groups.forEach(group => {
      if (!group.members || group.members.length === 0) return;

      const memberIds = group.members.map(m => m.id).join(",");
      const memberNames = group.members.map(m => m.name).join(", ");
      const cleanMemo = cleanMatchingMemo(group.memo);

      sheet.appendRow([
        todayStr,
        group.groupId,
        memberIds,
        memberNames,
        matchingMethod || "Gemini",
        cleanMemo,
      ]);

      group.members.forEach(m => matchedMemberIds.push(m.id));
    });

    SpreadsheetApp.flush();
    sheet.autoResizeColumns(1, 6);

    // --- 次回優先フラグ（8列目: H列）の自動更新マイグレーション ---
    const allMembers = getMembers();
    const activeMembers = allMembers.filter(m => m.status === true);
    const memberSheet = ss.getSheetByName("メンバー一覧");

    if (memberSheet && memberSheet.getLastRow() > 1) {
      const lastRow = memberSheet.getLastRow();
      const memberIdsInSheet = memberSheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
      const priorityRange = memberSheet.getRange(2, 8, lastRow - 1, 1); // 8列目 (H列) が「次回優先」列
      const priorities = priorityRange.getValues();

      for (let i = 0; i < memberIdsInSheet.length; i++) {
        const mId = memberIdsInSheet[i];
        if (matchedMemberIds.includes(mId)) {
          priorities[i][0] = false; // 今回選出されたメンバーは優先を解除
        } else {
          const isActive = activeMembers.some(m => m.id === mId);
          if (isActive) {
            priorities[i][0] = true; // 今回漏れたアクティブメンバーは自動で次回優先へ
          }
        }
      }
      
      priorityRange.setValues(priorities);
      SpreadsheetApp.flush();
    }

    // メール自動通知の送信（エラー発生時に全体がロールバックしないよう保護）
    try {
      sendMatchingEmails(groups, todayStr, matchingMethod);
    } catch (mailError) {
      Logger.log(`メール通知送信エラー: ${mailError.toString()}`);
    }

    return { success: true };
  } catch (e) {
    Logger.log(`saveMatchingHistory エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 確定したマッチング結果を各グループのメンバーに個別メール通知する。
 * 
 * @param {Object[]} groups マッチンググループの配列
 * @param {string} dateStr 開催予定日の日付文字列
 * @param {string} matchingMethod マッチング方式の文字列
 */
function sendMatchingEmails(groups, dateStr, matchingMethod) {
  const webAppUrl = getPortalUrl();

  groups.forEach(group => {
    const { members, groupId } = group;
    if (!members || members.length === 0) return;

    members.forEach(recipient => {
      if (!recipient.email) {
        Logger.log(`メールアドレス未登録のため通知スキップ: ${recipient.name}`);
        return;
      }

      const otherMembersText = members
        .filter(m => m.id !== recipient.id)
        .map(m => `・${m.name} さん (${m.department || "部署未設定"})`)
        .join("\n");

      const subject = `【ランチ交流会】マッチング確定のお知らせ（${dateStr}）`;
      let body = `${recipient.name} さん

お疲れ様です。ランチ交流会事務局です。
次回ランチ交流会のマッチングが確定しましたのでお知らせいたします。

■ 開催予定日
${dateStr}

■ あなたのグループ（${groupId}）のメンバー
・${recipient.name} さん (${recipient.department || "部署未設定"} ・あなた)
${otherMembersText}

■ ランチ交流会について
部署の重なりなどを考慮して選出されたグループです。メンバーの皆様で調整の上、ぜひランチ交流会をお楽しみください！

`;

      if (webAppUrl) {
        body += `■ ポータル画面（チャット・プロフィール確認など）\n${webAppUrl}\n\n`;
      }

      body += `※ 本メールはシステムより自動送信されています。\n何かご不明な点や不都合がございましたら、ランチ交流会事務局までご連絡ください。\n`;

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
 * Gemini API接続の疎通確認テストを行う (管理者専用)。
 * 
 * @param {string} apiKey テストするGemini APIキー
 * @return {Object} 接続可否のステータス結果
 */
function testGeminiConnection(apiKey) {
  try {
    checkAdminPermission();

    if (!apiKey) {
      return { success: false, error: "APIキーが入力されていません。" };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: 'Hello, this is a test. Reply with one word "OK" if you hear me.' }],
      }],
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
      const errorMsg = errorJson && errorJson.error && errorJson.error.message ? errorJson.error.message : `ステータスコード ${responseCode}`;
      return { success: false, error: `APIエラー: ${errorMsg}` };
    }
  } catch (e) {
    return { success: false, error: `接続エラー: ${e.toString()}` };
  }
}

/**
 * ログインユーザー自身のプロフィールを自己登録または更新する。
 * 
 * @param {Object} profileObj プロフィール入力データ
 * @return {Object} 処理結果オブジェクト
 */
function registerSelfProfile(profileObj) {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      return {
        success: false,
        error: "Googleアカウントにログインしていないか、メールアドレスが取得できません。ポータルのデプロイ設定をご確認ください。",
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
      // 既存のマイプロフィール情報の更新
      const updateObj = {
        id: myProfile.id,
        name: profileObj.name,
        email: userEmail,
        department: profileObj.department,
        interests: profileObj.interests || "",
        status: profileObj.status !== false,
        priority: myProfile.priority || false,
        considerations: profileObj.considerations || "",
      };
      result = updateMemberInSheet(updateObj);
    } else {
      // 新規自己登録
      const addObj = {
        name: profileObj.name,
        email: userEmail,
        department: profileObj.department,
        interests: profileObj.interests || "",
        status: profileObj.status !== false,
        priority: false,
        considerations: profileObj.considerations || "",
      };
      result = addMemberToSheet(addObj);
    }

    return result.success ? { success: true, myProfile: result.member } : { success: false, error: result.error };
  } catch (e) {
    Logger.log(`registerSelfProfile エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 指定のチャットルーム（グループ）に対するユーザーのアクセス権限を検証する。
 * 管理者は常時アクセス可能。一般ユーザーは該当グループ所属メンバーのみアクセス可能。
 * 
 * @param {string} userEmail 検証するユーザーのメールアドレス
 * @param {string} roomId ルームID（フォーマット: 日付_グループID）
 * @return {boolean} アクセス権がある場合はtrue
 */
function checkRoomAccess(userEmail, roomId) {
  if (!userEmail) return false;

  try {
    if (isAdminUser(userEmail)) {
      return true; // 管理者は全権限アクセス可能
    }
  } catch (e) {
    Logger.log(`checkRoomAccess 管理者判定エラー: ${e.toString()}`);
  }

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
  let targetRow = null;

  for (let i = 0; i < data.length; i++) {
    const val = data[i][0];
    const rowDate = val instanceof Date ? Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd") : val.toString();
    const rowGroupId = data[i][1];
    if (rowDate === dateStr && rowGroupId === groupId) {
      targetRow = data[i];
      break;
    }
  }

  if (!targetRow) return false;

  const memberIdsStr = targetRow[2] || "";
  const memberIds = memberIdsStr.split(",").map(id => id.trim());
  const members = getMembers();
  const currentUser = members.find(m => m.email.toLowerCase() === userEmail.toLowerCase());

  return currentUser ? memberIds.includes(currentUser.id) : false;
}

/**
 * 特定のチャットルームに属するメッセージ履歴を全件取得する。
 * 
 * @param {string} roomId ルームID
 * @return {Object} メッセージ配列を含む結果オブジェクト
 */
function getChatMessages(roomId) {
  try {
    const userEmail = getCurrentUserEmail();
    if (!userEmail) {
      return { success: false, error: "Googleアカウントにログインしていません。" };
    }

    if (!checkRoomAccess(userEmail, roomId)) {
      return { success: false, error: "このチャットルームへのアクセス権限がありません。" };
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

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { success: true, messages };
  } catch (e) {
    Logger.log(`getChatMessages エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 特定のチャットルームに新着メッセージを送信・保存する。
 * 
 * @param {string} roomId ルームID
 * @param {string} messageText メッセージ本文
 * @return {Object} 更新後のメッセージ一覧オブジェクト
 */
function sendChatMessage(roomId, messageText) {
  try {
    const userEmail = getCurrentUserEmail();
    if (!userEmail) {
      return { success: false, error: "Googleアカウントにログインしていません。" };
    }

    if (!messageText || messageText.trim() === "") {
      return { success: false, error: "メッセージ内容が空です。" };
    }

    if (!checkRoomAccess(userEmail, roomId)) {
      return { success: false, error: "このチャットルームへのアクセス権限がありません。" };
    }

    const members = getMembers();
    const currentUser = members.find(m => m.email.toLowerCase() === userEmail.toLowerCase());
    if (!currentUser) {
      return { success: false, error: "メンバーとして登録されていません。プロフィールを設定してください。" };
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
    SpreadsheetApp.flush();

    return getChatMessages(roomId);
  } catch (e) {
    Logger.log(`sendChatMessage エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * 過去のマッチング履歴およびチャットメッセージを全件物理削除クリアする (管理者専用)。
 * 同時に全メンバーの「次回優先」フラグ（8列目: H列）をすべてクリア（false）する。
 * 
 * @return {Object} 処理結果オブジェクト
 */
function clearMatchingHistory() {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const historySheet = ss.getSheetByName("マッチング履歴");
    if (historySheet && historySheet.getLastRow() > 1) {
      historySheet.deleteRows(2, historySheet.getLastRow() - 1);
    }

    const chatSheet = ss.getSheetByName("チャットメッセージ");
    if (chatSheet && chatSheet.getLastRow() > 1) {
      chatSheet.deleteRows(2, chatSheet.getLastRow() - 1);
    }

    // 全メンバーの「次回優先」フラグ（8列目: H列）のリセット
    const memberSheet = ss.getSheetByName("メンバー一覧");
    if (memberSheet && memberSheet.getLastRow() > 1) {
      const lastRow = memberSheet.getLastRow();
      const priorityRange = memberSheet.getRange(2, 8, lastRow - 1, 1);
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
 * 指定された日付およびIDに該当するマッチンググループのみ履歴から物理削除する (管理者専用)。
 * 同時に、チャットメッセージシートから該当ルームに関連するログデータも削除する。
 * 
 * @param {string} dateStr 開催日付
 * @param {string} groupId グループID
 * @return {Object} 処理結果オブジェクト
 */
function deleteMatchingGroup(dateStr, groupId) {
  try {
    checkAdminPermission();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("マッチング履歴");
    if (!sheet) {
      return { success: false, error: "マッチング履歴シートが見つかりません。" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: "履歴が存在しません。" };

    const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    let rowIndexToDelete = -1;

    for (let i = 0; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "Asia/Tokyo", "yyyy-MM-dd") : data[i][0].toString();
      const rowGroupId = data[i][1];

      if (rowDate === dateStr && rowGroupId === groupId) {
        rowIndexToDelete = i + 2;
        break;
      }
    }

    if (rowIndexToDelete === -1) {
      return { success: false, error: `指定されたグループが見つかりません。日付: ${dateStr}, グループID: ${groupId}` };
    }

    sheet.deleteRow(rowIndexToDelete);

    // 関連するチャット履歴の安全クリーンアップ
    const chatSheet = ss.getSheetByName("チャットメッセージ");
    if (chatSheet) {
      const chatLastRow = chatSheet.getLastRow();
      if (chatLastRow > 1) {
        const roomId = `${dateStr}_${groupId}`;
        const chatData = chatSheet.getRange(2, 2, chatLastRow - 1, 1).getValues();
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

/**
 * フロントエンドからの実行要求に基づいて、マッチングロジックを展開するエントリーポイント (管理者専用)。
 * 優先枠の考慮、メンバー選出、API有無に応じたロジックフォールバック等を自動制御する。
 * 
 * @param {Object} params 各種パラメータ（groupSize, groupCount, mode, additionalPrompt）
 * @return {Object} 処理結果オブジェクト
 */
function runMatching(params) {
  try {
    checkAdminPermission();

    const settings = getSettings();
    const groupSize = parseInt(params.groupSize || settings.default_group_size || 4, 10);
    let groupCount = parseInt(params.groupCount || settings.default_group_count || 4, 10);
    const mode = params.mode || "gemini";
    const additionalPrompt = params.additionalPrompt || "";

    const allMembers = getMembers();
    const activeMembers = allMembers.filter(m => m.status === true);

    if (activeMembers.length < 2) {
      return { success: false, error: "アクティブなメンバーが少なすぎます（最低2名必要です）。" };
    }

    const maxParticipants = groupSize * groupCount;
    let selectedMembers = [];
    let unmatchedMembers = [];

    // 優先枠（次回優先メンバー）と通常枠の選出シャッフル
    let priorityMembers = activeMembers.filter(m => !!m.priority);
    let regularMembers = activeMembers.filter(m => !m.priority);

    priorityMembers = arrayShuffle(priorityMembers);
    regularMembers = arrayShuffle(regularMembers);

    selectedMembers = selectedMembers.concat(priorityMembers);

    if (selectedMembers.length >= maxParticipants) {
      unmatchedMembers = selectedMembers.slice(maxParticipants);
      selectedMembers = selectedMembers.slice(0, maxParticipants);
      unmatchedMembers = unmatchedMembers.concat(regularMembers);
    } else {
      const neededCount = maxParticipants - selectedMembers.length;
      const additionals = regularMembers.slice(0, neededCount);
      selectedMembers = selectedMembers.concat(additionals);
      unmatchedMembers = regularMembers.slice(neededCount);
    }

    // 目標のグループ組数が参加者数を上回る場合のサイズ補正
    if (selectedMembers.length < groupCount) {
      groupCount = selectedMembers.length;
    }

    const history = getMatchingHistory();
    let result;
    let finalMethod = mode;
    const apiKey = settings.gemini_api_key;

    // マッチング実行（APIキーの有無によって適宜フォールバック）
    if (mode === "gemini") {
      if (!apiKey) {
        Logger.log("APIキー未設定のため、独自プログラムロジックにフォールバックします。");
        result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
        finalMethod = "logic_fallback";
      } else {
        result = runGeminiMatching(selectedMembers, history, groupSize, groupCount, apiKey, additionalPrompt);
        if (!result.success) {
          Logger.log(`Gemini APIエラーのため、独自プログラムロジックにフォールバックします。エラー: ${result.error}`);
          result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
          finalMethod = "logic_fallback";
        }
      }
    } else {
      result = runLogicMatching(selectedMembers, history, groupSize, groupCount);
      finalMethod = "logic";
    }

    // グループIDの採番（過去の最大連番を考慮して重複防止）
    if (result && result.success && result.groups) {
      let maxGroupIdNum = 0;
      history.forEach(h => {
        const match = h.groupId.match(/^G-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxGroupIdNum) maxGroupIdNum = num;
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
      unmatched: unmatchedMembers,
    };
  } catch (e) {
    Logger.log(`runMatching エラー: ${e.toString()}`);
    return { success: false, error: e.toString() };
  }
}

/**
 * Engine A: Gemini API 連携によるインテリジェントマッチング。
 * 配慮事項を可能な限り尊重しつつ、AIメモ自体には配慮詳細を含めないように設計。
 * 
 * @param {Object[]} members 選出されたメンバーの配列
 * @param {Object[]} history 過去のマッチング履歴の配列
 * @param {number} groupSize 1グループあたりの目標人数
 * @param {number} groupCount 目標グループ組数
 * @param {string} apiKey Gemini APIキー
 * @param {string} additionalPrompt 管理者による追加指示
 * @return {Object} 処理結果オブジェクト
 */
function runGeminiMatching(members, history, groupSize, groupCount, apiKey, additionalPrompt) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const membersData = members.map(m => ({
      id: m.id,
      name: m.name,
      dept: m.department,
      interests: m.interests,
      considerations: m.considerations || "",
    }));

    const compactHistory = history.slice(0, 8).map(h => ({
      date: h.date,
      groups: h.memberIds,
    }));

    const systemInstruction = `あなたは優秀な社内交流ファシリテーターです。提示されたメンバーのリストから、ランチ交流会のグループ分けを決定してください。
【制約ルール】
1. グループ数は【厳密に ${groupCount} 組】（groupIdは "G-1" から "G-${groupCount}"）作成してください。提示されたメンバー全員（総勢 ${members.length} 名）を、いずれかのグループに漏れなく割り当ててください。
2. 1グループあたりの目標人数は ${groupSize} 名ですが、総人数が少ない場合は各グループが均等な人数（サイズ差が最大1以内）になるように美しく均してください。
3. 異なる部署・チームのメンバーが極力同じグループになるように「部署の多様性」を最優先してください。
4. 趣味、自己紹介などを考慮し、共通点がある人同士を組み合わせると会話が弾みやすいので、適度に「趣味・関心の合致」を考慮してください。
5. 過去のマッチング履歴（ compactHistory ）を確認し、直近で同じグループになった人同士ができるだけ被らないように配慮してください。
6. メンバーに「配慮事項 (considerations)」が記載されている場合は、アレルギーや時間制限などの要望を極力尊重し、可能な限り配慮が満たされるような組み合わせを行ってください。ただし、アレルギー、健康状態、時間制限などの配慮事項に関する具体的な内容は、生成するAIコメント（memo）には絶対に含めないでください。
7. 出力フォーマットは指定された厳密なJSONスキーマのみとし、余計な説明文やMarkdown of JSONブロックを含めず、純粋なJSON文字列として返してください。`;

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
      "memo": "（日本語で1〜2文）なぜこの組み合わせにしたのか、共通の話題やおすすめの雑談テーマなど。※注意：メンバーの配慮事項に関する内容は絶対に含めないでください。"
    }
  ]
}

では、グループ分けを実行し、上記のJSONフォーマットに従って返答してください。`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
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
      return { success: false, error: `Gemini APIエラー (ステータス: ${responseCode})` };
    }

    const jsonResult = JSON.parse(responseBody);
    const generatedText = jsonResult.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(generatedText.trim());

    if (!parsedData.groups || !Array.isArray(parsedData.groups)) {
      return { success: false, error: "Geminiの返却データ構造が正しくありません。" };
    }

    const finalGroups = parsedData.groups.map((g, idx) => {
      const matchedMembers = g.members
        .map(id => members.find(m => m.id === id))
        .filter(Boolean);

      return {
        groupId: `G-${idx + 1}`,
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
 * Engine B: 山登り法（ローカルサーチ）による独自ロジックマッチング。
 * 過去の重複ペナルティや部署重複ペナルティをスコアリングして反復改善を行う。
 * 
 * @param {Object[]} members 選出されたメンバーの配列
 * @param {Object[]} history 過去のマッチング履歴の配列
 * @param {number} targetSize 1グループあたりの目標人数
 * @param {number} targetCount 目標グループ組数
 * @return {Object} 処理結果オブジェクト
 */
function runLogicMatching(members, history, targetSize, targetCount) {
  const totalMembers = members.length;
  const numGroups = targetCount || Math.max(1, Math.round(totalMembers / targetSize));
  const actualTargetSize = Math.ceil(totalMembers / numGroups);

  const penaltyMap = {};
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

  let shuffledIds = members.map(m => m.id);
  shuffledIds = arrayShuffle(shuffledIds);

  const groups = Array.from({ length: numGroups }, () => []);
  for (let i = 0; i < shuffledIds.length; i++) {
    groups[i % numGroups].push(shuffledIds[i]);
  }

  // スコア計算クロージャ
  const calculateTotalPenalty = (currentGroups) => {
    let totalPenalty = 0;

    currentGroups.forEach(group => {
      for (let i = 0; i < group.length; i++) {
        const m1 = members.find(m => m.id === group[i]);
        if (!m1) continue;

        for (let j = i + 1; j < group.length; j++) {
          const m2 = members.find(m => m.id === group[j]);
          if (!m2) continue;

          // 過去の重複ペナルティ
          const key = `${m1.id}-${m2.id}`;
          totalPenalty += (penaltyMap[key] || 0) * 100;

          // 同一部署ペナルティ
          if (m1.department === m2.department) {
            totalPenalty += 40;
          }

          // 共通趣味ボーナス
          const commonWord = findCommonWord(m1.interests || "", m2.interests || "");
          if (commonWord) {
            totalPenalty -= 10;
          }
        }
      }
      const sizeDiff = Math.abs(group.length - actualTargetSize);
      totalPenalty += sizeDiff * 20;
    });

    return totalPenalty;
  };

  let currentScore = calculateTotalPenalty(groups);
  const maxIterations = 2500;

  for (let iter = 0; iter < maxIterations; iter++) {
    const g1Idx = Math.floor(Math.random() * numGroups);
    const g2Idx = Math.floor(Math.random() * numGroups);

    if (g1Idx === g2Idx || groups[g1Idx].length === 0 || groups[g2Idx].length === 0) {
      continue;
    }

    const p1Idx = Math.floor(Math.random() * groups[g1Idx].length);
    const p2Idx = Math.floor(Math.random() * groups[g2Idx].length);

    // 要素のスワップ
    const temp = groups[g1Idx][p1Idx];
    groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
    groups[g2Idx][p2Idx] = temp;

    const newScore = calculateTotalPenalty(groups);
    if (newScore < currentScore) {
      currentScore = newScore;
    } else {
      // スコアが悪化したため元の配置に戻す
      const tempBack = groups[g1Idx][p1Idx];
      groups[g1Idx][p1Idx] = groups[g2Idx][p2Idx];
      groups[g2Idx][p2Idx] = tempBack;
    }
  }

  const finalGroups = groups.map((grpIds, idx) => {
    const matchedMembers = grpIds.map(id => members.find(m => m.id === id)).filter(Boolean);
    const depts = matchedMembers.map(m => m.department);
    const uniqueDepts = [...new Set(depts)];

    let memo = "過去の履歴を考慮し、重複を極力回避して最適化しました。";
    if (uniqueDepts.length === matchedMembers.length) {
      memo += `全員が異なる部署（${uniqueDepts.join(", ")}）から選出された多様性重視のグループです。`;
    } else {
      memo += `一部同部署が含まれますが、過去の被り回数を最小限に抑えています。`;
    }

    return {
      groupId: `G-${idx + 1}`,
      members: matchedMembers,
      memo,
    };
  });

  return { success: true, groups: finalGroups };
}

/**
 * フィッシャー–イェーツのアルゴリズムに基づき、配列をインプレースでランダムシャッフルする。
 * 
 * @param {Array} array シャッフル対象の配列
 * @return {Array} シャッフル後の配列
 */
function arrayShuffle(array) {
  let currentIndex = array.length;
  while (currentIndex !== 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

/**
 * 二つの紹介文字列から、共通する趣味・関心キーワードを検出する。
 * 
 * @param {string} str1 メンバー1の趣味・紹介文
 * @param {string} str2 メンバー2の趣味・紹介文
 * @return {string|null} 共通キーワード（無ければnull）
 */
function findCommonWord(str1, str2) {
  if (!str1 || !str2) return null;
  
  const keywords = [
    "サウナ", "カフェ", "ゴルフ", "テニス", "旅行", "キャンプ",
    "料理", "カレー", "読書", "映画", "ゲーム", "デザイン",
    "カメラ", "コーヒー", "ピラティス", "ヨガ", "筋トレ"
  ];
  
  for (const kw of keywords) {
    if (str1.includes(kw) && str2.includes(kw)) {
      return kw;
    }
  }
  return null;
}

/**
 * 履歴用のメモ文字列から、システム判定用の表示用タグ（括弧を含む）をクリーンアップする。
 * 
 * @param {string} memo 加工前のメモ文字列
 * @return {string} クリーンアップ後のメモ文字列
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
 * スプレッドシート内の特定の列から、次の採番IDを重複なくインクリメンタル生成する。
 * 
 * @param {Sheet} sheet 対象のシートオブジェクト
 * @param {string} prefix 接頭辞（例: 'M', 'D', 'MSG'）
 * @param {RegExp} regexPattern 数値部分を取り出すための正規表現パターン（例: /^M(\d+)$/）
 * @return {string} 新しいID
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
