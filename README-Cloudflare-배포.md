# StudyMate AI 연결 및 배포 안내

이 폴더는 기존 StudyMate 화면을 유지하면서 Cloudflare Workers AI를 연결하도록 수정한 버전입니다. Gemini API 키는 필요하지 않습니다.

## 중요한 점
- Cloudflare Workers AI 무료 플랜은 하루 10,000 Neurons 무료 할당량을 제공합니다. 모델과 이미지 수/크기에 따라 사용량이 달라지며, 한도 초과 시 요청이 실패할 수 있습니다.
- 이 프로젝트는 `@cf/google/gemma-4-26b-a4b-it` 모델을 사용합니다. 이 모델은 이미지 입력을 지원하지만, 필기나 흐릿한 사진을 항상 정확하게 읽는 것은 아닙니다.
- AI 채점은 참고용입니다. 중요한 시험 점수는 직접 확인하세요.
- API 서버 주소는 `config.js`에 입력합니다. 비밀 API 키를 프런트엔드에 저장하지 않습니다.

## A. Cloudflare Worker 만들기 (대시보드 이용)
1. https://dash.cloudflare.com/ 에 로그인합니다.
2. Workers & Pages에서 새 Worker를 만듭니다. 이름은 `studymate-ai`로 설정합니다.
3. Worker의 코드 편집 화면에서 `cloudflare-worker/index.js`의 내용을 붙여넣고 배포합니다.
4. Worker 설정의 AI binding 항목에서 binding name을 `AI`로 설정하고 Workers AI를 연결합니다. `wrangler.jsonc`를 사용하는 CLI 배포에서는 이미 설정되어 있습니다.
5. Worker 설정 → Variables and Secrets에서 `ALLOWED_ORIGINS` 변수를 추가합니다. GitHub Pages에 배포할 예정이면 예를 들어 `https://사용자이름.github.io`를 넣고, 여러 주소는 쉼표로 구분합니다. 실제 사이트 주소를 모르면 배포 후 주소를 확인해 입력합니다.
6. Worker를 다시 배포합니다. `workers.dev` 주소를 복사합니다.

## B. 프런트엔드에 Worker 주소 연결
1. `config.js`를 엽니다.
2. `https://YOUR-WORKER-URL.workers.dev`를 실제 Worker 주소로 바꿉니다. 예: `https://studymate-ai.내계정.workers.dev`
3. 파일을 저장합니다.

## C. GitHub Pages에 배포
1. GitHub에서 새 저장소를 만듭니다.
2. `index.html`, `style.css`, `script.js`, `config.js`를 저장소 루트에 올립니다.
3. 저장소 Settings → Pages → Deploy from a branch → `main` / `/(root)`를 선택해 저장합니다.
4. 생성된 Pages 주소를 Worker의 `ALLOWED_ORIGINS`에 추가합니다. Worker를 다시 배포합니다.
5. StudyMate 페이지를 새로고침하고 사진 1장, 5문제 설정으로 먼저 테스트합니다.

## D. 로컬 테스트
`config.js`에 Worker 주소를 입력하고, 로컬 웹 서버(예: VS Code Live Server)로 `index.html`을 엽니다. `file://`로 직접 열기보다는 웹 서버를 권장합니다. localhost 포트가 5500이 아니라면 `ALLOWED_ORIGINS`에 해당 주소를 추가하세요.

## 주의 / 제한
- CORS 허용 주소는 브라우저에서의 접근을 제한하는 설정이지, 인증이나 완전한 남용 방지 기능은 아닙니다. 공개 서비스로 확장할 때는 로그인/사용자별 제한을 추가해야 합니다.
- 무료 사용량은 Cloudflare 계정의 Workers AI 전체 사용량과 공유됩니다. 이 앱은 한도 초과 시 유료로 자동 전환하지 않습니다.
- PDF는 Cloudflare AI의 문서 변환을 거쳐 텍스트/마크다운으로 처리하고, 이미지 파일은 비전 모델로 전달합니다.
- 업로드 자료는 AI 서비스로 전송되므로 개인 정보나 민감한 자료는 올리지 마세요.
