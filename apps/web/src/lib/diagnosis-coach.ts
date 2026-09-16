import "server-only";
import { resolveDiagnosisModel } from "@gongmoa/core/server";

// 맞춤 극복법(AI)의 프롬프트·JSON 스키마·max_tokens·응답 파싱 — **정본은 core**
// (`packages/core/src/diagnosis-coach.ts`). 여기는 기존 import 경로를 지키는 어댑터다.
//
// 왜 옮겼나: 이제 배치를 제출하는 경로가 셋이다(웹 서버 액션·웹 크론·Edge
// `diagnosis-request`). 프롬프트·모델·effort·max_tokens 가 웹에만 있으면 Edge 는 사본을
// 갖게 되는데, **사본이 어긋난 것은 요금이 나간 뒤에야 안다** — 저 값들은 전부 곧바로
// 청구서에 닿는다. 문구를 고칠 일이 있으면 core 파일만 고칠 것.
export {
  buildCoachingParams,
  maxTokensFor,
  parseCoachingItems,
  DIAGNOSIS_MODEL_DEFAULT,
  resolveDiagnosisModel,
  type CoachInput,
  type DiagnosisMessageParams,
  type WrongQuestionSample,
} from "@gongmoa/core/server";

// 운영 중 모델을 갈아 끼우는 탈출구. **Edge(Supabase secret)에도 같은 값을 넣을 것** —
// 한쪽에만 넣으면 같은 진단이 어느 경로로 제출됐느냐에 따라 다른 모델로 만들어진다.
// 비어 있으면 core 기본값(DIAGNOSIS_MODEL_DEFAULT) 하나뿐이다.
export const DIAGNOSIS_MODEL = resolveDiagnosisModel(process.env.ANTHROPIC_DIAGNOSIS_MODEL);
