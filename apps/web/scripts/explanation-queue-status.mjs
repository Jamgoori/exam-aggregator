// 사용법: node --env-file=.env.local scripts/explanation-queue-status.mjs
//
// 해설 배치 큐(explanation_batch_priority) 현황 감사 도구 (읽기 전용, 소유자 전용 —
// service role 키 필요). 우선순위 순서대로 그룹별 전체/완료/잔여 문항 수를 집계하고,
// 큐에 등록되지 않은 (exam_type_id, level) 그룹이 있으면 경고한다.
//
// 순방향 루틴은 이 목록의 앞에서, 역방향 루틴은 뒤에서 좁혀오므로 "최후순위"로
// 미루고 싶은 그룹(현재 5급)은 잔여량 기준 정중앙(수렴 지점)에 있어야 한다.
// 새 직렬·시험지를 업로드했다면 이 스크립트로 미등록 그룹을 확인한 뒤
// explanation_batch_priority에 행을 추가할 것 (테이블에 없는 그룹은 영원히 처리 안 됨).
// 앞/뒤 잔여 균형이 크게 무너졌으면 priority 번호를 조정해 수렴 지점을 되돌린다.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function pageAll(table, select) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(select.split(",")[0].trim())
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table} 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const [examTypes, priorities, excluded, papers, questions, expl] = [
  await pageAll("exam_types", "id, name"),
  await pageAll("explanation_batch_priority", "priority, exam_type_id, level"),
  await pageAll("explanation_excluded_subjects", "subject_id"),
  await pageAll("exam_papers", "id, exam_type_id, level, subject_id"),
  await pageAll("questions", "id, paper_id"),
  await pageAll("question_explanations", "question_id"),
];

const typeName = new Map(examTypes.map((t) => [t.id, t.name]));
const excludedIds = new Set(excluded.map((e) => e.subject_id));
const groupKey = (examTypeId, level) => `${examTypeId}|${level ?? ""}`;

// 문제지 → 그룹 매핑 (제외 과목 문제지는 큐가 건너뛰므로 집계에서도 제외)
const paperGroup = new Map();
const papersByGroup = new Map();
for (const p of papers) {
  if (excludedIds.has(p.subject_id)) continue;
  const key = groupKey(p.exam_type_id, p.level);
  paperGroup.set(p.id, key);
  papersByGroup.set(key, (papersByGroup.get(key) ?? 0) + 1);
}

const qGroup = new Map();
const totalByGroup = new Map();
for (const q of questions) {
  const key = paperGroup.get(q.paper_id);
  if (!key) continue;
  qGroup.set(q.id, key);
  totalByGroup.set(key, (totalByGroup.get(key) ?? 0) + 1);
}
const doneByGroup = new Map();
for (const e of expl) {
  const key = qGroup.get(e.question_id);
  if (!key) continue;
  doneByGroup.set(key, (doneByGroup.get(key) ?? 0) + 1);
}

priorities.sort((a, b) => a.priority - b.priority);
console.log("=== 해설 배치 큐 (priority 순 — 순방향은 위에서, 역방향은 아래에서 진행) ===");
let totalPending = 0;
const rows = priorities.map((p) => {
  const key = groupKey(p.exam_type_id, p.level);
  const total = totalByGroup.get(key) ?? 0;
  const done = doneByGroup.get(key) ?? 0;
  const pending = total - done;
  totalPending += pending;
  return { ...p, key, total, done, pending };
});
for (const r of rows) {
  console.log(
    `${String(r.priority).padStart(3)}  ${(typeName.get(r.exam_type_id) ?? r.exam_type_id).padEnd(5, "　")} ${(r.level ?? "-").padEnd(3)}  전체 ${String(r.total).padStart(6)}  완료 ${String(r.done).padStart(6)}  잔여 ${String(r.pending).padStart(6)}${r.total === 0 ? "  (크롭된 문항 없음)" : ""}`,
  );
}
console.log(`\n큐 전체 잔여: ${totalPending}문항`);

// 5급 블록(있다면)을 기준으로 앞/뒤 잔여 균형 표시 — 수렴 지점 점검용
const firstG5 = rows.findIndex((r) => r.level === "5급");
const lastG5 = rows.findLastIndex((r) => r.level === "5급");
if (firstG5 !== -1) {
  const front = rows.slice(0, firstG5).reduce((s, r) => s + r.pending, 0);
  const mid = rows.slice(firstG5, lastG5 + 1).reduce((s, r) => s + r.pending, 0);
  const back = rows.slice(lastG5 + 1).reduce((s, r) => s + r.pending, 0);
  console.log(`5급 블록 기준 균형 — 앞(순방향 몫) ${front} / 5급 ${mid} / 뒤(역방향 몫) ${back}`);
}

// 큐 미등록 그룹 경고
const registered = new Set(rows.map((r) => r.key));
const missing = [...papersByGroup.keys()].filter((k) => !registered.has(k));
if (missing.length > 0) {
  console.log("\n⚠ 큐에 등록되지 않은 그룹 (explanation_batch_priority에 행 추가 필요):");
  for (const key of missing) {
    const [etid, level] = key.split("|");
    console.log(
      `  ${typeName.get(etid) ?? etid} | ${level || "(급수 없음)"} | 문제지 ${papersByGroup.get(key)}장, 문항 ${totalByGroup.get(key) ?? 0}개`,
    );
  }
} else {
  console.log("\n모든 그룹이 큐에 등록되어 있음");
}
