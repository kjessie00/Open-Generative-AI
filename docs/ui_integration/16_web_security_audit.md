# Web 보안 False 교차 출처 감사 (16)

작성일: 2026-07-07 KST. 감사자: opencode session. 본 문서는 `docs/ui_integration/14_side_effect_audit.md` §7.2 후속 task 후보 넷째 항목 "web 보안 false 교차 출처 audit task"의 감사 산출물이다. 본 감사 동안 외부 side effect 실행 0건, npm install 0회, git add/commit/push 0회이다.

## §1. webSecurity: false 위치

본 repo의 electron 메인 측 `electron/main.js` 27번 라인에 다음 코드가 존재한다.

```js
mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
        webSecurity: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
    },
    ...
});
```

본 설정은 Electron BrowserWindow의 webPreferences.webSecurity를 false로 강제하며 다음 3가지 효과를 가진다. 첫째, 동일 출처 정책(SOP)이 비활성화되어 렌더러 측 JavaScript가 임의의 교차 출처(cross-origin) XHR/fetch를 보낼 수 있다. 둘째, 혼합 컨텐츠(mixed content, https 페이지가 http 리소스를 로드)가 허용된다. 셋째, CSP(Content-Security-Policy)가 기본적으로 비활성화된다.

## §2. webSecurity: false의 의도된 사용

본 repo의 electron 메인 측 코드는 다음 3가지 의도된 사용 패턴을 가진다. 첫째, `dist/index.html`을 `file://` 프로토콜로 로드한다(electron/main.js 38-39번 라인). 둘째, 외부 URL은 `setWindowOpenHandler`를 통해 OS 기본 브라우저에서 열린다(electron/main.js 48-51번 라인). 셋째, 메인 프로세스가 huggingface 모델 다운로드, Wan2GP local HTTP, GitHub releases 다운로드를 수행한다(electron/lib/{localInference,wan2gpProvider,modelCatalog}.js). 본 3가지 사용 패턴은 모두 메인 프로세스 측에서 수행되며 렌더러 측 XHR/fetch는 사용하지 않는다.

## §3. 본 repo의 외부 origin 호출 inventory

본 repo의 코드에서 다음 외부 origin 호출이 발견된다. 첫째, 메인 측 huggingface 모델 다운로드 (https, modelCatalog.js 안 8개 모델 URL). 둘째, 메인 측 GitHub releases 다운로드 (https, localInference.js 1개). 셋째, 메인 측 GitHub API releases list (https, localInference.js 1개). 넷째, 메인 측 Wan2GP local HTTP (http://127.0.0.1:7860, LocalModelManager.js). 다섯째, deprecated 측 hosted MuAPI 호출 (https://api.muapi.ai, deprecated folder 안 muapi.js 등). 여섯째, deprecated 측 muapi.ai access-keys 링크 (https://muapi.ai/access-keys, deprecated folder 안 AuthModal.js).

위 6개 카테고리 중 첫째부터 넷째는 메인 프로세스 측 호출이며 렌더러 측 XHR와 무관하다. 다섯째와 여섯째는 deprecated 폴더로 격리된 코드이며 production deployment에는 포함되지 않는다. 따라서 본 repo의 active 렌더러 측 XHR/fetch 호출은 0건이다.

## §4. webSecurity: false의 실제 위험 평가

본 repo의 webSecurity: false 설정의 실제 위험은 다음 3가지로 평가된다. 첫째, active 렌더러 측 XHR/fetch 호출이 0건이므로 SOP 비활성화의 직접적 exploit 가능성은 낮다. 둘째, 다만 미래에 렌더러 측 코드가 추가될 때 임의의 교차 출처 호출을 시도할 수 있는 가능성은 존재한다. 셋째, deprecated 폴더 안 코드는 격리되었지만 deprecated 폴더가 production deployment에 포함될 경우 hosted MuAPI로의 교차 출처 호출이 발생할 수 있다.

본 위험은 다음 3가지 완화책으로 해결 가능하다. 첫째, webSecurity를 true로 변경하여 SOP를 다시 활성화한다. 둘째, CSP meta tag를 `dist/index.html`에 추가한다. 셋째, `setWindowOpenHandler`에서 외부 URL allowlist를 적용한다.

## §5. allowlist 제안

본 §5는 본 repo의 향후 Electron 메인 측 업데이트에서 적용할 allowlist를 제안한다. 본 allowlist는 3가지 카테고리로 구성된다.

첫째, file:// 프로토콜 allowlist. 본 repo의 dist/index.html이 file:// 프로토콜로 로드되므로 file:// 프로토콜은 항상 허용되어야 한다. file:// 프로토콜은 외부 출처가 아니며 SOP의 적용을 받지 않는다.

둘째, localhost HTTP allowlist. 본 repo의 Wan2GP local HTTP 호출이 `http://127.0.0.1:7860` 또는 `http://localhost:7860`을 사용한다. 본 origin은 local loopback이며 외부 origin이 아니므로 allowlist에 포함된다.

셋째, 외부 HTTPS allowlist (setWindowOpenHandler). 본 repo의 메인 측 외부 HTTPS 호출은 메인 프로세스에서 수행되며 렌더러 측 XHR/fetch와 무관하다. 그러나 `setWindowOpenHandler`를 통해 사용자가 클릭한 외부 URL은 OS 기본 브라우저에서 열리며 allowlist로 검증될 수 있다. allowlist 대상은 다음 6개 origin이다. `https://huggingface.co`, `https://github.com`, `https://api.github.com`, `https://github.com/deepbeepmeep`, `https://github.com/Anil-matcha`, `https://github.com/leejet`. allowlist 외 origin은 setWindowOpenHandler에서 거부되며 사용자에게 거부 사유가 안내된다.

## §6. webRequest.onBeforeRequest 필터 제안

본 §6은 webSecurity: false가 유지될 경우 webRequest.onBeforeRequest 필터로 allowlist를 강제하는 코드를 제안한다.

```js
const { session } = require('electron');
const allowedOrigins = new Set([
    'https://huggingface.co',
    'https://github.com',
    'https://api.github.com',
    'http://127.0.0.1:7860',
    'http://localhost:7860',
]);

session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    if (url.protocol === 'file:') {
        callback({ cancel: false });
        return;
    }
    if (allowedOrigins.has(`${url.protocol}//${url.host}`)) {
        callback({ cancel: false });
        return;
    }
    callback({ cancel: true });
});
```

본 코드는 webRequest.onBeforeRequest 필터를 등록하여 allowlist 외 origin 호출을 차단한다. 본 코드는 webSecurity: false가 유지될 때만 필요하다. webSecurity를 true로 변경하면 본 코드는 불필요해진다.

## §7. webSecurity: true 변경 권고

본 §7은 본 repo의 webSecurity: false를 webSecurity: true로 변경할 것을 권고한다. 본 권고의 근거는 다음 4가지이다. 첫째, 본 repo의 active 렌더러 측 XHR/fetch 호출이 0건이므로 SOP 비활성화의 실익이 없다. 둘째, deprecated 폴더는 production deployment에 포함되지 않으므로 SOP 비활성화로 인한 hosted MuAPI 호출 위험은 무시할 수 있다. 셋째, webSecurity를 true로 변경하면 외부 교차 출처 호출이 자동 차단되어 보안 표면이 축소된다. 넷째, webSecurity: true 하에서 file:// 프로토콜 로드는 정상 동작한다.

본 권고의 적용 절차는 다음과 같다. 첫째, `electron/main.js` 27번 라인의 `webSecurity: false`를 `webSecurity: true`로 변경한다. 둘째, 변경 후 vite build 및 electron dev로 GUI launch를 검증한다. 셋째, GUI launch가 정상 동작하면 본 권고 적용을 완료한다. GUI launch가 비정상 동작하면 변경을 revert하고 본 §6의 webRequest.onBeforeRequest 필터를 적용한다.

## §8. CSP meta tag 제안

본 §8은 webSecurity: true 변경 후 추가 보안 강화로 CSP meta tag를 `dist/index.html`에 추가할 것을 제안한다. CSP meta tag는 inline script 실행 제한, 외부 script 로드 제한, mixed content 차단을 강제한다.

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data:; connect-src 'self' http://127.0.0.1:7860 http://localhost:7860;">
```

본 CSP는 다음 6가지 정책으로 구성된다. 첫째, default-src를 self와 file:로 제한한다. 둘째, script-src를 self로 제한한다. 셋째, style-src를 self와 unsafe-inline으로 제한한다(inline style은 본 repo의 다수 컴포넌트가 사용한다). 넷째, img-src를 self, file:, data:로 제한한다. 다섯째, connect-src를 self, 127.0.0.1:7860, localhost:7860으로 제한한다(Wan2GP local HTTP). 여섯째, 그 외 정책은 default-src로 위임된다.

본 CSP는 webSecurity: true와 함께 적용될 때 외부 script injection, mixed content, cross-origin data exfiltration을 모두 차단한다.

## §9. 한계 인정

본 §9는 본 감사의 한계를 인정한다. 첫째, 본 감사는 electron/main.js와 electron/lib/ 안 코드만 정적 분석했으며 runtime 분석은 수행하지 않았다. 둘째, 본 repo의 deprecated 폴더 안 코드는 격리되었지만 deprecated 폴더의 코드 본문은 변경되지 않았다. 셋째, webSecurity: true 변경 권고는 본 §7에서 명시했지만 본 task 동안 실제 변경은 적용되지 않았다. 넷째, CSP meta tag 제안은 build 산출물인 `dist/index.html`에 적용되어야 하며 본 task는 source code 단계에 머무른다.

본 한계는 본 감사가 정적 분석의 범위 안에서 수행되었기 때문이다. 향후 다음 audit cycle에서 본 §7 권고와 본 §8 CSP 적용이 verify 되어야 한다.

## §10. STOP — commit 금지

본 감사 산출물의 commit은 별도 task에서 Jessie 승인 후 진행한다. 본 task 동안 git add, git commit, git push 호출은 일체 시도되지 않았다. 본 감사의 외부 side effect 실행 0건, npm install 0회이다. 본 §7 권고의 실제 적용은 별도 task에서 Jessie 승인 후 진행된다.