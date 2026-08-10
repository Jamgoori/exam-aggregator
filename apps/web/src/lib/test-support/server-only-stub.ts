// server-only 패키지의 테스트용 대체 모듈.
//
// 진짜 server-only 는 import 되기만 해도 던진다(클라이언트 번들에 서버 코드가
// 섞이는 걸 막는 장치). node --test 는 클라이언트가 아니지만 그 조건을 만족시킬
// 방법이 없어서, 테스트 전용 tsconfig(tsconfig.test.json)에서만 이 파일로 바꿔치기
// 한다. 앱 빌드는 tsconfig.json 을 쓰므로 실제 가드는 그대로 살아 있다.
export {};
