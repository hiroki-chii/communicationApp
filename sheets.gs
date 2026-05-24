/**
 * 社内ランチ交流会マッチングシステム - データベース操作ロジック
 */

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
  
  // デプロイした本人のメールアドレスも自動的に管理者に含める (権限エラーの自動フォールバック)
  var ownerEmail = Session.getEffectiveUser().getEmail();
  if (ownerEmail && adminEmails.indexOf(ownerEmail.toLowerCase()) === -1) {
    adminEmails.push(ownerEmail.toLowerCase());
  }
  
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
    
    // 実行オーナーのメールも管理者に自動的に含める
    var ownerEmail = Session.getEffectiveUser().getEmail();
    if (ownerEmail && adminEmails.indexOf(ownerEmail.toLowerCase()) === -1) {
      adminEmails.push(ownerEmail.toLowerCase());
    }
    
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
    var ownerEmail = Session.getEffectiveUser().getEmail();
    if (ownerEmail && adminEmails.indexOf(ownerEmail.toLowerCase()) === -1) {
      adminEmails.push(ownerEmail.toLowerCase());
    }
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
    var rowDate = Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd');
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
