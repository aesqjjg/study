const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function corsHeaders(origin, env) {
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const local = origin && (/^http:\/\/localhost(?::\d+)?$/.test(origin) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin));
  const allowed = !origin || local || configured.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (origin || "*") : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;,]+)?;base64,([\s\S]+)$/.exec(dataUrl || "");
  if (!match) throw new Error("첨부 파일 데이터 형식이 올바르지 않습니다.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType: match[1] || "application/octet-stream", bytes };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (headers["Access-Control-Allow-Origin"] === "null") return json({ error: "허용되지 않은 웹사이트에서 요청했습니다. ALLOWED_ORIGINS 설정을 확인하세요." }, 403, headers);
    if (request.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405, headers);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) return json({ error: "요청이 너무 큽니다. 첨부 파일 수나 크기를 줄여 주세요." }, 413, headers);

    try {
      const body = await request.json();
      const task = String(body.task || "");
      const prompt = String(body.prompt || "").slice(0, 18000);
      const files = Array.isArray(body.files) ? body.files : [];
      if (!["quiz", "analysis", "grading"].includes(task)) return json({ error: "지원하지 않는 작업입니다." }, 400, headers);
      if (!prompt.trim()) return json({ error: "AI 요청 내용이 비어 있습니다." }, 400, headers);
      if (files.length > MAX_FILES) return json({ error: `파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.` }, 400, headers);

      const content = [{ type: "text", text: prompt }];
      for (const file of files) {
        if (!file || typeof file.dataUrl !== "string") continue;
        const decoded = dataUrlToBytes(file.dataUrl);
        if (decoded.bytes.byteLength > MAX_FILE_BYTES) return json({ error: `${file.name || "첨부 파일"}: 파일은 8MB 이하로 선택해 주세요.` }, 413, headers);
        const name = String(file.name || "attachment").slice(0, 120);
        if (decoded.mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
          const converted = await env.AI.toMarkdown({ name, blob: new Blob([decoded.bytes], { type: "application/pdf" }) }, { conversionOptions: { output: { format: "markdown" } } });
          if (converted.format === "error" || !converted.data) {
            return json({ error: `${name} PDF 변환에 실패했습니다. PDF를 이미지로 저장해 다시 올려 주세요.` }, 422, headers);
          }
          content.push({ type: "text", text: `\n\n[PDF 자료: ${name}]\n${converted.data.slice(0, 45000)}` });
        } else if (decoded.mimeType.startsWith("image/")) {
          // The model accepts OpenAI-compatible image_url content parts with data URIs.
          content.push({ type: "image_url", image_url: { url: file.dataUrl } });
          content.push({ type: "text", text: `[첨부 이미지: ${name}]` });
        } else {
          return json({ error: `${name}: 이미지 또는 PDF 파일만 지원합니다.` }, 415, headers);
        }
      }

      const result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: "너는 StudyMate의 한국어 학습 도우미다. 자료에 없는 사실을 지어내지 말고, 읽을 수 없는 글자나 불확실한 정답은 불확실하다고 말한다. 설명은 학생이 이해하기 쉽게 작성한다." },
          { role: "user", content }
        ],
        max_tokens: task === "quiz" ? 5000 : 3500,
        temperature: task === "quiz" ? 0.25 : 0.2,
        chat_template_kwargs: { enable_thinking: false }
      });
      const text = result?.response ?? result?.choices?.[0]?.message?.content ?? result;
      return json({ ok: true, result: text, model: MODEL }, 200, headers);
    } catch (error) {
      const message = String(error?.message || error || "AI 요청 처리에 실패했습니다.");
      const status = /limit|quota|neurons|rate|capacity|busy/i.test(message) ? 429 : 500;
      return json({ error: status === 429 ? "AI 무료 사용량 또는 처리 용량 한도에 도달했어요. 사용량을 확인하고 잠시 후 다시 시도해 주세요." : `AI 요청 처리에 실패했습니다: ${message.slice(0, 280)}` }, status, headers);
    }
  }
};
