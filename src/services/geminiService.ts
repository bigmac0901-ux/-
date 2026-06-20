import { GoogleGenAI, Type } from "@google/genai";

export interface ExternalEvent {
  id?: string;
  date: string;
  title: string;
  type: 'v-varen' | 'velca' | 'live';
  location?: string;
}

export async function fetchSportsSchedules(): Promise<ExternalEvent[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "undefined") {
    console.error("GEMINI_API_KEY is not set");
    throw new Error("APIキーが設定されていません。Vercelの環境変数またはAI StudioのSecretsにGEMINI_API_KEYを設定してください。");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const nextYear = currentYear + 1;
    const currentMonth = now.getMonth() + 1;
    
    // ステップ1: Google検索を使用して最新のイベント情報をテキストで取得
    const searchResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `長崎県内の以下の施設の最新イベント日程（${currentYear}年${currentMonth}月〜${nextYear}年末）を教えてください。
1. V・ファーレン長崎のホームゲーム（Jリーグ、ピーススタジアム）
2. 長崎ヴェルカのホームゲーム（Bリーグ、ハピネスアリーナ）
3. 長崎ブリックホールのライブ・コンサート・イベント
4. 長崎スタジアムシティ（ピーススタジアム、ハピネスアリーナ）で開催されるライブ・イベント
5. その他、長崎市内の主要な大型ライブ・コンサート

※注意：「THE CLUB NAGASAKI」に関連するイベントは含めないでください。

回答形式：各イベントについて、具体的な日付（YYYY-MM-DD）、イベント名（対戦カード）、場所を欠かさずリストアップしてください。`,
      config: {
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true }
      }
    });

    const rawText = searchResponse.text;
    if (!rawText) {
      console.warn("No content returned from search model");
      return [];
    }

    // ステップ2: 取得したテキスト情報をJSON形式に整形
    const formatResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `以下のテキストから「日付」「イベント名」「場所」を抽出し、指定されたJSON形式の配列で返してください。
「THE CLUB NAGASAKI」に関連するイベントは必ず除外してください。

※重要：
1. 「date」は必ず [YYYY-MM-DD] 形式（例：2026-06-15）で格納してください。
2. もし日付が特定できない、または不明なイベントは、JSON配列に含めず必ず除外してください。
3. すべての格納するオブジェクトには「date」プロパティを正確に入力してください。

各要素は以下のプロパティを持ってください：
- date: YYYY-MM-DD形式の日付（必ず指定。不明な場合は含めない、つまりその要素自体を除外する）
- title: イベント名
- type: 'v-varen', 'velca', 'live' のいずれか（V・ファーレンは 'v-varen'、ヴェルカは 'velca'、その他は 'live'）
- location: 開催場所

テキスト：
${rawText}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              title: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['v-varen', 'velca', 'live'] },
              location: { type: Type.STRING }
            },
            required: ["date", "title", "type"]
          }
        }
      }
    });

    const jsonText = formatResponse.text;
    if (!jsonText) {
      console.warn("No JSON text returned from format model");
      return [];
    }
    
    console.log("Gemini Sync Results (raw):", jsonText);
    
    const events = JSON.parse(jsonText.trim()) as ExternalEvent[];
    console.log(`Parsed ${events.length} events from Gemini`);
    //念のため、タイトルや場所に「THE CLUB NAGASAKI」が含まれるものをフィルタリング
    return events.filter(event => {
      const title = event.title.toUpperCase();
      const location = (event.location || '').toUpperCase();
      const excludeTerm = "THE CLUB NAGASAKI";
      return !title.includes(excludeTerm) && !location.includes(excludeTerm);
    });
  } catch (error: any) {
    console.error("Detailed Error fetching sports schedules:", error);
    
    // 429エラー（レート制限）のハンドリング
    if (error.message?.includes('429') || (error.status && error.status === 429)) {
      throw new Error("AIの利用制限に達しました。リクエストが多すぎるため、数分待ってから再度お試しください。");
    }
    
    throw new Error(error.message || "同期中にエラーが発生しました。");
  }
}
