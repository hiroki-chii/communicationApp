/**
 * 社内ランチ交流会マッチングシステム - マッチングエンジン（Gemini / 独自ロジック）
 */

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
      "6. 出力フォーマットは指定された厳密なJSONスキーマのみとし、余計な説明文やMarkdownのコードブロック（```json など）は含めず、純粋なJSON文字列として返してください。";

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
    var finalGroups = parsedData.groups.map(function(g) {
      var matchedMembers = g.members.map(function(id) {
        return members.find(function(m) { return m.id === id; });
      }).filter(Boolean); // nullやundefinedを除外
      
      return {
        groupId: g.groupId,
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
  
  // 山登り法による最適化ループ (2000回試行)
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
