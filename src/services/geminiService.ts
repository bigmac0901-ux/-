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
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;
    
    // ステップ1: Google検索を使用して最新のイベント情報をテキストで取得
    const searchResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `長崎県内の以下の施設の最新イベント日程（${currentYear}年〜${nextYear}年）を教えてください。
1. V・ファーレン長崎のホームゲーム
2. 長崎ヴェルカのホームゲーム
3. 長崎ブリックホールのライブ・コンサート
4. 長崎スタジアムシティで開催されるライブ・イベント

※注意：「THE CLUB NAGASAKI」のイベントは含めないでください。

日付（YYYY-MM-DD）、イベント名、場所を含めてください。`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const rawText = searchResponse.text;
    if (!rawText) {
      return [];
    }

    // ステップ2: 取得したテキスト情報をJSON形式に整形
    const formatResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `以下のテキストからイベント日程を抽出し、JSON形式の配列で返してください。
「THE CLUB NAGASAKI」に関連するイベントは除外してください。

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
              date: { type: Type.STRING },
              title: { type: Type.STRING },
              type: { type: Type.STRING },
              location: { type: Type.STRING }
            },
            required: ["date", "title", "type"]
          }
        }
      }
    });

    const jsonText = formatResponse.text;
    if (!jsonText) {
      return [];
    }
    
    const events = JSON.parse(jsonText.trim()) as ExternalEvent[];
    //念のため、タイトルや場所に「THE CLUB NAGASAKI」が含まれるものをフィルタリング
    return events.filter(event => {
      const title = event.title.toUpperCase();
      const location = (event.location || '').toUpperCase();
      const excludeTerm = "THE CLUB NAGASAKI";
      return !title.includes(excludeTerm) && !location.includes(excludeTerm);
    });
  } catch (error: any) {
    console.error("Detailed Error fetching sports schedules:", error);
    throw new Error(error.message || "同期中にエラーが発生しました。");
  }
}
