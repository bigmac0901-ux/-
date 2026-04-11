import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ExternalEvent {
  id?: string;
  date: string;
  title: string;
  type: 'v-varen' | 'velca' | 'live';
  location?: string;
}

export async function fetchSportsSchedules(): Promise<ExternalEvent[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set");
    throw new Error("APIキーが設定されていません。設定を確認してください。");
  }

  try {
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;
    
    console.log("Starting Step 1: Search events with gemini-3-flash-preview...");
    // ステップ1: Google検索を使用して最新のイベント情報をテキストで取得
    const searchResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `長崎県内の以下の施設の最新イベント日程（${currentYear}年〜${nextYear}年）を教えてください。
1. V・ファーレン長崎のホームゲーム
2. 長崎ヴェルカのホームゲーム
3. 長崎ブリックホールのライブ・コンサート
4. 長崎スタジアムシティで開催されるライブ・イベント

日付（YYYY-MM-DD）、イベント名、場所を含めてください。`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const rawText = searchResponse.text;
    if (!rawText) {
      console.warn("No text returned from search step");
      return [];
    }
    console.log("Step 1 completed. Raw text length:", rawText.length);

    console.log("Starting Step 2: Format to JSON with gemini-3-flash-preview...");
    // ステップ2: 取得したテキスト情報をJSON形式に整形
    const formatResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `以下のテキストからイベント日程を抽出し、JSON形式の配列で返してください。
各要素は以下のプロパティを持ってください：
- date: YYYY-MM-DD形式の日付
- title: イベント名
- type: 'v-varen', 'velca', 'live' のいずれか（スポーツ以外は 'live'）
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
              date: { type: Type.STRING, description: "YYYY-MM-DD形式の日付" },
              title: { type: Type.STRING, description: "イベント名" },
              type: { type: Type.STRING, description: "v-varen, velca, live" },
              location: { type: Type.STRING, description: "開催場所" }
            },
            required: ["date", "title", "type"]
          }
        }
      }
    });

    const jsonText = formatResponse.text;
    if (!jsonText) {
      console.warn("No JSON text returned from format step");
      return [];
    }
    console.log("Step 2 completed. JSON text length:", jsonText.length);
    
    try {
      return JSON.parse(jsonText) as ExternalEvent[];
    } catch (parseError) {
      console.error("Failed to parse JSON response:", jsonText);
      throw new Error("データの解析に失敗しました。");
    }
  } catch (error: any) {
    console.error("Detailed Error fetching sports schedules:", error);
    // エラーオブジェクトの詳細を文字列化して表示
    const errorDetail = error?.message || JSON.stringify(error);
    throw new Error(`同期中にエラーが発生しました: ${errorDetail}`);
  }
}
