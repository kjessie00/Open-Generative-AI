# 오프라인 dependency 감사

검증일: 2026-07-13 (Asia/Seoul)

## 결론

외부 네트워크를 OS 수준에서 차단한 상태로 현재 lockfile과 설치 트리를 확인했다. production dependency tree는 로컬에서 정상 해석되었고, lockfile의 HTTPS resolved entry는 모두 integrity 값을 가진다. `npm audit --offline --omit=dev`는 취약점 0건을 반환했다.

그러나 OSV scanner는 `package-lock.json`에서 1,097개 패키지를 식별한 뒤 npm 생태계의 로컬 offline database가 없다고 명시적으로 보고했다. 따라서 npm offline audit의 0건을 “알려진 취약점이 없다”는 확정 증거로 사용하지 않는다. 현재 판정은 `OSV_OFFLINE_DB_GAP` 유지다.

## 실행 결과

모든 네트워크 접근은 macOS `sandbox-exec`의 `(deny network*)`로 차단했다.

```text
npm audit --offline --omit=dev --json
exit 0
reported vulnerabilities: 0
production dependencies: 250
total dependency records: 1,168

osv-scanner scan source . --format json --offline --offline-vulnerabilities
package-lock packages found: 1,097
result: no offline version of the OSV database is available

npm ls --omit=dev --depth=0
exit 0
```

Lockfile provenance aggregate:

```text
package entries: 1,169
HTTPS resolved entries: 1,158
git resolved entries: 0
file resolved entries: 0
HTTPS entries missing integrity: 0
```

## 판정 경계

- PASS: 현재 설치된 production dependency tree가 해석 가능하다.
- PASS: lockfile의 HTTPS artifact entry에 integrity 누락이 없다.
- SUPPLEMENTAL ONLY: npm offline audit 0건은 로컬 cache 범위 결과다.
- GAP: OSV의 npm offline vulnerability database가 없다.

외부 네트워크를 허용하지 않고 이 gap을 닫으려면, 별도로 신뢰 가능한 시점에 생성된 OSV npm offline database bundle을 로컬에 제공해야 한다. 그 전에는 취약점 부재를 주장하지 않는다.
